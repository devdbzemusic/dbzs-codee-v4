# COPILOT-AUFTRAG
# Runtime Chat Freeze Repair — echter Abbruch, Timeouts und Fast Path

## Projekt

Repository:

`devdbzemusic/dbzs-codee-project`

Projekt:

`Division By Zeros (DBZS) Codee`

## Ziel

Repariere den Runtime Chat so, dass eine einfache Nachricht wie `Hallo` zuverlässig beantwortet wird, ein hängender llama.cpp-Request wirklich abgebrochen werden kann und die Oberfläche jederzeit sichtbar zeigt, in welchem Schritt sich die Anfrage befindet.

Der aktuelle Fehlerzustand zeigt:

- Runtime wird als `llama.cpp aktiv` angezeigt.
- Nach dem Senden erscheint `Stopp`.
- Die Eingabe bleibt sichtbar.
- Es erscheint keine Antwort.
- Die Anfrage kann im Hintergrund weiterlaufen.
- `Auto + Full + Kontext` startet für eine triviale Nachricht unnötig den kompletten Agenten- und Kontextpfad.

Keine neue Chatarchitektur bauen. Die vorhandenen Runtime-, Streaming-, Agent-Turn- und Electron-IPC-Pfade gezielt reparieren.

---

# 1. Sourcecode-Audit

Vor Änderungen mindestens prüfen:

```text
apps/desktop/src/components/RuntimeChatTab.tsx
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/services/agentRunService.ts
apps/desktop/src/services/runtimeChatStreamClient.ts
apps/desktop/src/services/runtimeChatAgentConfig.ts
apps/desktop/src/services/runtimeChatAgentRunner.ts
apps/desktop/src/runtime/agent/agentTurnEngine.ts
apps/desktop/src/services/runtimeChatContext.ts
apps/desktop/src/services/modelRegistryService.ts
apps/desktop/src/services/modelProviders.ts
apps/desktop/src/services/backendClient.ts
apps/desktop/electron/preload.ts
apps/desktop/electron/main.ts
apps/desktop/electron/runtimeChatStream.ts
backend/app/api/runtime.py
backend/app/runtime/service.py
backend/app/runtime/chat_stream.py
```

Erstelle:

```text
docs/RUNTIME_CHAT_FREEZE_AUDIT.md
```

Das Audit muss konkret beantworten:

1. Wann wird `isSending` gesetzt?
2. Wann wird die User-Nachricht in den Chat eingefügt?
3. Welche Schritte laufen vor dem eigentlichen Modellrequest?
4. Wo wird `AbortSignal` nicht weitergereicht?
5. Welche Timeouts existieren tatsächlich?
6. Wann wird der Agent-Turn-Loop aktiviert?
7. Warum aktiviert `Full` auch im Auto-Modus den kompletten Agentenloop?
8. Wie wird Runtime-Readiness derzeit bestimmt?
9. Welche Stelle kann minutenlang blockieren?
10. Welche Tests fehlen?

---

# 2. User-Nachricht sofort sichtbar machen

Aktuell wird die User-Nachricht erst nach mehreren Vorstufen eingefügt.

Ändere den Ablauf so, dass unmittelbar nach Validierung der Eingabe:

1. die User-Nachricht in `messages` eingefügt wird,
2. das Eingabefeld geleert wird,
3. das Activity Panel geöffnet wird,
4. `isSending = true` gesetzt wird,
5. anschließend Runtime-Check, Routing, Kontext und Modellrequest beginnen.

Die Eingabe darf nicht bis zum vollständigen Abschluss der Anfrage sichtbar bleiben.

Bei Fehler bleibt die gesendete User-Nachricht im Chat erhalten.

---

# 3. Aktivitätsanzeige sofort öffnen

`showPanels` darf nicht erst nach erfolgreichem `sendMessage()` gesetzt werden.

Beim Absenden sofort:

```text
showPanels = true
```

Die UI muss während der Anfrage sichtbar anzeigen:

```text
Runtime prüfen
Modell routen
Kontext vorbereiten
Workspace-Dateien lesen
Modellrequest senden
Streaming
Tool Call
Abgebrochen
Timeout
Fehler
```

Der Nutzer darf nicht nur einen unbestimmten Spinner sehen.

---

# 4. Fast Path für triviale Chatnachrichten

Implementiere eine kleine, deterministische Fast-Path-Erkennung.

Beispiele für triviale Chatnachrichten:

```text
Hallo
Hi
Guten Morgen
Bist du da?
Wie geht es dir?
```

Für solche Nachrichten im Modus `Auto`:

- kein Workspace-Kontext
- keine Orchestrierung
- keine Project Memory Suche
- kein Code Index
- keine Tools
- kein Agent-Turn-Loop
- direkter einfacher Runtime-Chat

Der Fast Path darf nicht bei Coding-, Analyse-, Review- oder Datei-Anfragen greifen.

Beispiele, die nicht trivial sind:

```text
Prüfe den Sourcecode.
Analysiere das Projekt.
Finde den Fehler in App.tsx.
Erstelle einen Implementierungsplan.
```

Erstelle eine klar testbare Funktion, beispielsweise:

```typescript
isTrivialConversationMessage(text: string): boolean
```

Keine LLM-Anfrage für die Klassifikation verwenden.

---

# 5. Agent-Loop-Aktivierung korrigieren

`Full` darf im Modus `Auto` nicht automatisch jede Nachricht in den Agentenloop zwingen.

Überarbeite:

```text
shouldUseAgentTurnLoop(...)
```

Zielregeln:

```text
Agent-Modus:
  Agentenloop aktiv

Auto + Ask:
  normaler Chat

Auto + Agent:
  Agentenloop nur bei Coding-/Tool-Intent

Auto + Full:
  Agentenloop nur bei Coding-/Tool-Intent
  nicht bei trivialem Gespräch

Coder/Debugger-Zielagent:
  Agentenloop aktiv
```

Erstelle eine testbare Intent-Hilfsfunktion.

Keine komplexe KI-Klassifikation; einfache konservative Heuristik reicht.

---

# 6. AbortSignal vollständig durchreichen

Der Stopp-Button muss den realen laufenden Request abbrechen.

Das Signal muss durchgehend weitergereicht werden:

```text
RuntimeChatTab
→ runtimeChatStore
→ agentRunService.sendChatStream
→ streamRuntimeChat
→ backendClient.streamRuntimeChat
→ preload
→ Electron main IPC
→ streamRuntimeChatViaBackend
→ fetch
```

Erweitere die Signaturen dort, wo nötig.

Beispiel:

```typescript
streamRuntimeChat(
  request,
  callbacks,
  signal
)
```

In Electron muss pro Streaming-Request ein eigener `AbortController` oder ein requestbezogener Cancel-Mechanismus existieren.

Ein Renderer-`AbortSignal` kann nicht direkt über IPC serialisiert werden. Implementiere daher einen eindeutigen Request-Identifier:

```text
requestId
```

Verbindlicher Ablauf:

```text
Renderer erzeugt requestId
→ IPC stream start(requestId, request)
→ Electron speichert AbortController zu requestId
→ Renderer sendet cancel(requestId)
→ Electron abort()
→ Backend-fetch wird beendet
→ IPC Promise endet mit AbortError
→ UI zeigt "Abgebrochen"
```

Neue IPCs beispielsweise:

```text
dbzs:runtime:chat-stream
dbzs:runtime:chat-stream-cancel
```

Nach Abschluss oder Fehler muss der Controller aus der Map entfernt werden.

Keine Memory Leaks.

---

# 7. Backend-Streaming abbrechbar machen

Der Electron-Fetch zu:

```text
/runtime/chat/stream
```

muss ein `AbortSignal` erhalten.

Erweitere:

```typescript
streamRuntimeChatViaBackend(
  backendUrl,
  request,
  onChunk,
  signal
)
```

Bei Abbruch:

- Reader abbrechen
- Fetch abbrechen
- keine Fallback-Anfrage starten
- keine Safe-Response erzeugen
- Fehler als `AbortError` weitergeben

Ein Benutzerabbruch ist kein Runtime-Fehler.

---

# 8. Timeouts tatsächlich durchsetzen

Definiere zentrale Timeouts:

```text
runtimeStatusTimeoutMs = 5000
modelRoutingTimeoutMs = 10000
runtimeContextTimeoutMs = 10000
orchestrationTimeoutMs = 10000
workspaceContextTimeoutMs = 15000
firstTokenTimeoutMs = 45000
chatRequestTimeoutMs = 120000
agentRunTimeoutMs = 120000
```

Erstelle eine gemeinsame Hilfsfunktion:

```typescript
withTimeout(promise, timeoutMs, label, signal?)
```

Anforderungen:

- unterstützt AbortSignal
- räumt Timer auf
- erzeugt klare Fehlermeldung
- unterscheidet Timeout und Benutzerabbruch

`maxRuntimeMs` aus `DEFAULT_AGENT_POLICY` muss im Agent-Turn-Loop real geprüft werden.

Aktuell dürfen nicht nur Turn- und Toolanzahl begrenzen.

Bei Überschreitung:

```text
trajectory.status = timeout
```

oder ein vorhandener gleichwertiger Status.

---

# 9. First-Token-Timeout

Ein Prozess kann laufen, ohne Tokens zu liefern.

Implementiere für Streaming einen First-Token-Timeout:

- beginnt beim Start des Modellrequests
- wird beim ersten Delta gelöscht
- bei Ablauf Request abbrechen
- UI-Fehler:

```text
Das Modell hat innerhalb von 45 Sekunden kein erstes Token geliefert.
Runtime-Prozess läuft, antwortet aber nicht.
```

Dieser Fehler muss sich von einem allgemeinen Gesamt-Timeout unterscheiden.

---

# 10. Runtime-Readiness ehrlich anzeigen

`state === "running"` reicht nicht als vollständige Chat-Bereitschaft.

Ergänze einen echten, leichten Readiness-Check.

Möglichkeiten:

1. vorhandenen Runtime-Probe-Service verwenden,
2. llama-server Health-/Models-Endpunkt prüfen,
3. sehr kurzen Probe-Request mit kleinem Tokenlimit.

Nicht bei jedem UI-Render prüfen.

Empfohlener Ablauf:

- beim Runtime-Start
- vor erstem Chatrequest
- nach Transportfehler
- mit kurzem Cache, zum Beispiel 10 Sekunden

UI-Status unterscheiden:

```text
Prozess läuft
Endpoint erreichbar
Chat bereit
Antwortet nicht
```

Nicht pauschal `llama.cpp aktiv` anzeigen, wenn nur der Prozess existiert.

---

# 11. Modellrouting vereinfachen

Für die bereits aktive lokale llama.cpp-Runtime darf ein einfaches Chatgespräch nicht erst alle Provider vollständig scannen.

Aktuell kann `resolveRouting()` beim ersten Aufruf alle Provider prüfen und Modelle auflisten.

Optimierung:

1. Wenn `RuntimeStatus` eine laufende lokale Runtime mit Modell enthält, diese für `runtime_chat` bevorzugen.
2. Provider-Registry im Hintergrund aktualisieren.
3. Kein Cloud-/Ollama-Healthscan auf dem kritischen Pfad einer einfachen lokalen Chatnachricht.
4. Routing mit Timeout absichern.

---

# 12. Kontextvorbereitung abbrechbar machen

`buildWorkspaceContext()` liest Dateien sequenziell.

Erweitere um:

```typescript
signal?: AbortSignal
```

Vor jeder Datei und nach jedem Await:

```typescript
if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
```

Das Gleiche für:

- Runtime Context
- Orchestration
- Memory
- Code Index, soweit asynchron
- Workspace-Dateilesen

Der Stopp-Button muss auch die Vorverarbeitung abbrechen, nicht nur den Modellstream.

---

# 13. Keine stummen Fallbacks bei allgemeinem Fehler

In Electron wird bei Nicht-400-Fehlern derzeit eine künstliche Safe-Response erzeugt:

```text
Runtime antwortet aktuell nicht stabil.
```

Damit wird ein echter Fehler in eine scheinbare Assistant-Antwort umgewandelt.

Ändere den Streaming-Pfad:

- AbortError weiterreichen
- Timeout weiterreichen
- Netzwerkfehler weiterreichen
- Runtimefehler weiterreichen
- nur der explizite 400-Tool-Payload-Fallback darf einen zweiten Versuch ohne Tools machen
- nach dessen Fehlschlag echten Fehler liefern

Keine künstliche Assistant-Antwort bei Transportfehlern.

---

# 14. Retry-Verhalten korrigieren

Derzeit kann eine Anfrage mehrfach wiederholt werden.

Regeln:

- kein Retry bei Abort
- kein Retry bei Timeout
- kein Retry nach erstem bereits empfangenem Token
- maximal ein Retry bei klar transientem Verbindungsfehler vor dem ersten Token
- kein dreifacher kompletter Agentenloop
- Retry in Activity Stream anzeigen

---

# 15. UI-Zustände

Im Composer beziehungsweise Activity Panel sichtbar machen:

```text
Vorbereitung
Kontext wird geladen
Warte auf erstes Token
Streaming
Tool wird ausgeführt
Abbruch wird verarbeitet
Timeout
Fehler
Fertig
```

Der Stopp-Button muss nach Klick sofort:

```text
Abbruch wird verarbeitet …
```

anzeigen und erst nach tatsächlichem Abschluss in den Idle-Zustand wechseln.

Nicht sofort nur lokale Flags zurücksetzen, während der Request weiterläuft.

---

# 16. Diagnoseinformationen

Bei einem Hänger oder Fehler protokollieren:

```text
requestId
provider
modelId
endpoint
chatMode
toolProfile
workspaceContextEnabled
agentLoopEnabled
currentStage
startedAt
firstTokenAt
finishedAt
durationMs
abortReason
timeoutStage
retryCount
```

Keine Prompt-Inhalte oder Secrets vollständig in Logs schreiben.

Ergänze einen kleinen Diagnoseblock im Activity Panel oder Diagnosepanel.

---

# 17. Tests

Mindestens neue beziehungsweise erweiterte Tests:

```text
RuntimeChatTab.test.ts
runtimeChatStore.test.ts
runtimeChatAgentConfig.test.ts
runtimeChatStreamClient.test.ts
runtimeChatStream.test.ts
agentTurnEngine.test.ts
```

## Testfälle

### Sofortige Nachrichtendarstellung

Nach Submit:

- User-Nachricht sofort in `messages`
- Draft sofort leer
- `isSending = true`
- Activity sichtbar

### Fast Path

`Hallo` bei `Auto + Full`:

- kein Agent-Turn-Loop
- kein Workspace-Kontext
- direkter Chatrequest

Coding-Anfrage:

- Agent-Turn-Loop aktiv

### Abort während Vorbereitung

- Kontextlesen hängt
- Stopp
- Promise wird abgebrochen
- UI wird idle
- keine Modellanfrage

### Abort während llama.cpp-Stream

- ein Delta empfangen
- Stopp
- Electron-Fetch wird abgebrochen
- kein Retry
- keine weiteren Chunks
- UI zeigt Abbruch

### First-Token-Timeout

- Stream öffnet
- keine Chunks
- Timeout
- Fetch abort
- klare Fehlermeldung

### Gesamt-Timeout Agent Loop

- Modell liefert wiederholt Tool Calls
- `maxRuntimeMs` erreicht
- Loop endet kontrolliert

### Routing Timeout

- Provider-Refresh hängt
- Chat endet mit verständlichem Routing-Timeout

### Kein Safe-Response-Fake

- Backend-Stream wirft Netzwerkfehler
- Fehler erscheint als Fehler
- keine Assistant-Nachricht mit künstlichem Text

---

# 18. Manuelle Abnahme

## Test A — einfacher Chat

Einstellungen:

```text
Auto
Full
Kontext AN
```

Nachricht:

```text
Hallo
```

Erwartung:

- User-Nachricht sofort sichtbar
- Fast Path
- Antwort innerhalb sinnvoller Zeit
- kein Workspace-Scan
- kein Agentenloop

## Test B — Coding-Anfrage

```text
Analysiere die aktuell geöffnete Datei und nenne den wahrscheinlichsten Fehler.
```

Erwartung:

- Kontext und Agentenloop sichtbar
- Activity zeigt jeden Schritt
- Tokens erscheinen
- keine unsichtbare Wartephase

## Test C — echter Abbruch

Während Streaming `Stopp` drücken.

Erwartung:

- Anzeige `Abbruch wird verarbeitet`
- Backend-/Electron-Fetch endet
- llama.cpp-Request läuft nicht weiter
- UI kehrt sauber zurück

## Test D — nicht antwortendes Modell

Modellprozess erreichbar, aber keine Tokens.

Erwartung:

- First-Token-Timeout
- klare Fehlermeldung
- kein fünfminütiges Hängen

---

# 19. Qualitätsgates

```powershell
pnpm typecheck
pnpm --filter @dbzs/desktop test
pnpm build
```

Backendtests, falls Backenddateien verändert werden:

```powershell
cd backend
uv run pytest tests/test_runtime_*.py -q
```

Nicht ausgeführte Tests als `NOT RUN` angeben.

---

# 20. Commit-Reihenfolge

Keine Mammutänderung.

```text
fix(runtime-chat): show message and activity before preprocessing
fix(runtime-chat): add trivial-message fast path
fix(runtime-chat): correct auto full agent-loop routing
fix(runtime-chat): propagate request cancellation through electron and backend
fix(runtime-chat): enforce stage first-token and total timeouts
fix(runtime-chat): remove synthetic safe responses for transport failures
test(runtime-chat): cover fast path abort and timeout behavior
docs(runtime-chat): document freeze diagnosis and acceptance
```

---

# 21. Definition of Done

Der Auftrag ist erst abgeschlossen, wenn:

- [ ] `Hallo` bei `Auto + Full + Kontext` den Fast Path verwendet.
- [ ] Die User-Nachricht sofort im Chat erscheint.
- [ ] Das Eingabefeld sofort geleert wird.
- [ ] Das Activity Panel sofort sichtbar ist.
- [ ] Jede Vorstufe einen sichtbaren Status besitzt.
- [ ] Der Stopp-Button Vorverarbeitung abbrechen kann.
- [ ] Der Stopp-Button den echten llama.cpp-Stream abbrechen kann.
- [ ] AbortSignal beziehungsweise requestId bis zum Electron-Fetch reicht.
- [ ] Keine künstliche Assistant-Antwort echte Transportfehler verdeckt.
- [ ] First-Token-Timeout funktioniert.
- [ ] Gesamt-Timeout funktioniert.
- [ ] `maxRuntimeMs` im Agent-Turn-Loop wirklich durchgesetzt wird.
- [ ] Routing und Kontext eigene Timeouts besitzen.
- [ ] Laufender Prozess und echte Chat-Bereitschaft unterschieden werden.
- [ ] Tests und Build grün sind.
- [ ] Manueller Test A bis D mit PASS, FAIL oder NOT RUN dokumentiert ist.

---

# 22. Abschlussbericht

Am Ende liefern:

```text
1. Gefundene primäre Ursache
2. Geänderte Dateien
3. Fast-Path-Regeln
4. Agent-Loop-Routing
5. Abbruchkette
6. Timeoutkonzept
7. Runtime-Readiness
8. Entfernte stille Fallbacks
9. Testresultate
10. Manueller Test A: PASS / FAIL / NOT RUN
11. Manueller Test B: PASS / FAIL / NOT RUN
12. Manueller Test C: PASS / FAIL / NOT RUN
13. Manueller Test D: PASS / FAIL / NOT RUN
14. Bekannte Restprobleme
```
