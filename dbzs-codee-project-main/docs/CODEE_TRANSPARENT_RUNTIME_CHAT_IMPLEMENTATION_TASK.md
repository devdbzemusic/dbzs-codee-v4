# IMPLEMENTIERUNGSAUFTRAG
# Division By Zeros (DBZS) Codee
## Transparenter Runtime-Chat mit dauerhaftem Run-Verlauf, echtem Abbruch und ehrlicher Fehleranzeige

## Ziel

Der Runtime-Chat von Codee soll zu einer transparenten Arbeitskonsole werden.

Nicht nur die endgültige Modellantwort soll sichtbar sein, sondern der vollständige, nachvollziehbare Ablauf:

```text
User-Nachricht
→ Runtime-Prüfung
→ Modell-Routing
→ Kontextaufbau
→ Modellturn
→ Tool Call
→ Tool Result
→ Dateiänderung
→ Command/Test
→ Fehler oder Abschluss
```

Der aktuelle Stand enthält bereits:

- `RuntimeChatRun`
- `RuntimeChatEvent`
- `RuntimeChatTurn`
- `RuntimeChatToolCall`
- `RuntimeChatFileChange`
- `RuntimeChatCommand`
- `RuntimeChatError`
- `CodeeRunLiveBlock`
- `activeRun`
- `historicalRuns`
- einen ersten Cancel-IPC
- einen Electron-`AbortController`

Diese vorhandenen Bausteine müssen korrigiert und geschlossen werden.

Keine zweite Chatarchitektur bauen.

---

# 1. Zuerst Sourcecode prüfen

Vor Änderungen mindestens lesen:

```text
packages/shared/src/index.ts
apps/desktop/src/components/RuntimeChatTab.tsx
apps/desktop/src/components/chat/CodeeRunLiveBlock.tsx
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/services/runtimeChatRunHelpers.ts
apps/desktop/src/services/runtimeChatAgentConfig.ts
apps/desktop/src/services/runtimeChatStreamClient.ts
apps/desktop/src/services/agentRunService.ts
apps/desktop/src/services/backendClient.ts
apps/desktop/src/runtime/agent/agentTurnEngine.ts
apps/desktop/electron/preload.ts
apps/desktop/electron/main.ts
apps/desktop/electron/runtimeChatStream.ts
```

Erstelle zuerst:

```text
docs/RUNTIME_CHAT_TRANSPARENT_RUNS_AUDIT.md
```

Das Audit muss konkrete Dateien und Funktionen nennen und mindestens beantworten:

1. Welche TypeScript-Fehler existieren im aktuellen `createChatRun()`-Aufruf?
2. Warum verschwindet der Run-Block nach Abschluss?
3. Wie sind User-Nachricht, Run und Assistant-Nachricht aktuell verbunden?
4. Warum werden `turns` und `commands` nicht befüllt?
5. Warum zeigt jedes Event ein grünes Häkchen?
6. Warum ist die Diff-Darstellung kein echter Diff?
7. Warum ist der aktuelle Abbruch nicht requestbezogen?
8. Warum kann ein echter Abbruch als normaler Fehler erscheinen?
9. Welche Timeouts fehlen?
10. Wo werden Transportfehler als künstliche Assistant-Antwort ausgegeben?

Keine Implementierung beginnen, bevor dieses Audit vorliegt.

---

# 2. Aktuelle TypeScript-Fehler zuerst beheben

Im `createChatRun()`-Aufruf dürfen keine undefinierten Variablen verwendet werden.

Insbesondere prüfen und korrigieren:

```text
useSettingsStore
includeWorkspaceContext
```

Der Run muss seine Daten aus den bereits vorhandenen Optionen und Store-Werten erhalten.

Beispiel:

```typescript
const profile =
  sendOptions?.toolProfile ??
  get().toolProfile ??
  loadToolProfile();

const initialRun = createChatRun(
  userMessageId,
  sendOptions?.agentMode ?? "auto",
  profile,
  sendOptions?.includeWorkspaceContext ?? false,
  sendOptions?.workspaceRoot ?? undefined,
  activeFile?.path
);
```

Danach sofort ausführen:

```powershell
pnpm typecheck
```

Erst bei grünem Typecheck weiterarbeiten.

---

# 3. Stabile IDs für Nachrichten und Runs

`RuntimeChatMessage` benötigt eine stabile ID.

Erweitere den Contract minimal-invasiv:

```typescript
export interface RuntimeChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  runId?: string;
  toolCalls?: RuntimeChatToolCallRecord[];
  meta?: RuntimeChatMessageMeta;
}
```

Für jede Anfrage:

```text
userMessage.id
run.id
assistantMessage.id
```

erzeugen und gegenseitig referenzieren:

```text
RuntimeChatRun.userMessageId
RuntimeChatRun.assistantMessageId
RuntimeChatMessage.runId
```

Keine Zuordnung über Array-Index.

Keine React-Keys aus:

```text
role + index
```

verwenden.

---

# 4. Run direkt im Nachrichtenverlauf rendern

Der Run-Block darf nicht nur global unterhalb aller Nachrichten erscheinen.

Zielstruktur:

```text
User Message
Run Block
Assistant Message
```

Der Chat rendert anhand der Run-ID:

```text
User-Nachricht
→ zugehöriger RuntimeChatRun
→ zugehörige Assistant-Nachricht
```

Abgeschlossene Runs müssen dauerhaft sichtbar bleiben.

`historicalRuns` darf nicht nur gespeichert, sondern muss im Chatverlauf gerendert werden.

Empfohlene Datenstruktur:

```typescript
runsById: Record<string, RuntimeChatRun>
runOrder: string[]
```

oder eine gleichwertige klare Zuordnung.

Der `activeRun` kann als Convenience-Feld erhalten bleiben, darf aber nicht die einzige Renderquelle sein.

---

# 5. Run-Zustandsmaschine schließen

Erlaubte Status:

```text
preparing
routing
waiting_first_token
streaming
running_tools
waiting_review
running_command
completed
cancelled
timeout
failed
```

Falls `waiting_review` und `running_command` noch nicht im Contract stehen, ergänzen.

Verbindliche Übergänge:

```text
preparing → routing
routing → waiting_first_token
waiting_first_token → streaming
streaming → running_tools
running_tools → waiting_review
waiting_review → running_command
running_command → streaming
streaming → completed
jeder aktive Zustand → cancelled
jeder aktive Zustand → timeout
jeder aktive Zustand → failed
```

Keine direkte Umschaltung auf `completed`, solange noch Tools, Reviews oder Commands offen sind.

---

# 6. Eventdarstellung ehrlich machen

Nicht jedes Event bekommt ein grünes Häkchen.

Mapping:

```text
started / waiting    → ●
completed            → ✓
warning              → !
failed               → ✗
cancelled            → ■
timeout              → ⏱
```

Der Status muss aus Eventtyp und Runstatus abgeleitet werden.

Beispiel:

```typescript
function getEventVisual(event: RuntimeChatEvent, run: RuntimeChatRun) {
  ...
}
```

`activeEvent` entweder wirklich verwenden oder entfernen.

Laufende Events dürfen nicht als abgeschlossen dargestellt werden.

---

# 7. Modellturns wirklich befüllen

`RuntimeChatRun.turns` darf nicht leer bleiben.

Bei jedem Agenten- oder Modellturn speichern:

```text
id
turnNumber
promptSummary
responseSummary
startedAt
finishedAt
durationMs
status
```

Keine private Chain-of-Thought speichern oder anzeigen.

Anzeigen nur:

- kurze Begründung
- Aktion
- Ergebnis
- nächster Schritt

Beispiel:

```text
Turn 1
Aktion: Projektdateien auflisten
Ergebnis: 43 Dateien gefunden
Dauer: 1,2 s
```

Der Live-Block benötigt einen aufklappbaren Bereich:

```text
Modellturns
```

---

# 8. Tool Calls vollständig darstellen

Tool Calls müssen an den Run gebunden werden.

Mindestens speichern:

```text
id
toolCallId
name
status
arguments
resultSummary
filePath
lineRange
startedAt
finishedAt
durationMs
error
```

UI-Karte:

```text
DATEI LESEN
src/stores/runtimeChatStore.ts
Zeilen 400–760
Status: erfolgreich
Dauer: 84 ms
```

Für laufende Tools:

```text
Status: läuft
```

Für Fehler:

```text
Status: fehlgeschlagen
Fehler: ...
```

Tool Calls nicht bei jedem Stream-Update vollständig neu aus unvollständigen Daten rekonstruieren.

Stabile Tool-Call-IDs verwenden und inkrementell aktualisieren.

---

# 9. Commands und Tests im Run darstellen

`RuntimeChatRun.commands` muss real befüllt werden.

Mindestens:

```text
id
command
status
exitCode
stdout
stderr
durationMs
timestamp
```

UI:

```text
COMMAND
pnpm typecheck
Exit Code: 1
Dauer: 8,3 s
```

`stdout` und `stderr` aufklappbar anzeigen.

Keine ungebremsten riesigen Logs rendern.

Ausgaben begrenzen und sichtbar als gekürzt markieren.

---

# 10. Dateiänderungen als echte Diffs

Aktuell dürfen nicht einfach alle Zeilen des neuen Inhalts als `additions` gezählt werden.

Verwende den vorhandenen Diff-/Patch-Service oder eine vorhandene Diff-Hilfsfunktion.

Erforderlich:

```text
echte Additions
echte Deletions
Unified Diff
Before Hash
After Hash
Status
```

`Diff anzeigen` muss den echten Diff-Editor öffnen, nicht nur die Datei.

Buttons:

```text
Diff anzeigen
Im Editor öffnen
Übernehmen
Ablehnen
```

Keine Datei direkt anwenden, ohne den vorhandenen Review-/Restore-Point-Pfad zu verwenden.

---

# 11. Echter requestbezogener Abbruch

Ein globaler einzelner Electron-Controller reicht nicht.

Jeder Chat-Run erhält:

```text
requestId
```

IPC-Schnittstellen:

```text
dbzs:runtime:chat-stream
dbzs:runtime:chat-stream:cancel
```

müssen die Request-ID verwenden.

Ablauf:

```text
Renderer erzeugt requestId
→ Preload startet requestId
→ Electron speichert AbortController in Map<requestId, AbortController>
→ Cancel sendet requestId
→ exakt dieser Request wird abgebrochen
→ Controller wird entfernt
```

Kein neuer Request darf still einen anderen Request abbrechen.

Hauptfenster und detached Chatfenster müssen unabhängig arbeiten können.

---

# 12. AbortError korrekt behandeln

Electron darf bei Abbruch nicht:

```typescript
throw new Error("aborted")
```

verwenden, wenn der Store nur `AbortError` erkennt.

Entweder:

```typescript
throw new DOMException("Aborted", "AbortError")
```

oder einen eigenen typisierten Fehler:

```typescript
class RuntimeChatAbortError extends Error {
  name = "AbortError";
}
```

Der Store muss Benutzerabbruch eindeutig behandeln:

```text
Run status = cancelled
kein Chat-Fehler
kein Retry
keine künstliche Assistant-Antwort
```

---

# 13. First-Token- und Gesamt-Timeout

Implementiere technisch wirksame Timeouts.

Empfohlene Werte:

```text
runtimeStatusTimeoutMs = 5000
routingTimeoutMs = 10000
contextTimeoutMs = 15000
firstTokenTimeoutMs = 45000
chatTotalTimeoutMs = 120000
```

Vor Modellstart:

```text
status = waiting_first_token
```

Beim ersten Delta:

```text
firstTokenAt setzen
status = streaming
First-Token-Timer löschen
```

Bei First-Token-Timeout:

```text
Request abbrechen
Run status = timeout
Event chat.timeout
Fehlerkarte anzeigen
```

Bei Gesamt-Timeout:

```text
Request abbrechen
Run status = timeout
```

Die bisherige 20-Sekunden-Warnung darf als Hinweis bleiben, ersetzt aber keinen Timeout.

---

# 14. Transportfehler nicht als Assistant-Antwort maskieren

Entferne bei allgemeinen Transportfehlern:

```text
buildRuntimeChatSafeResponse(...)
```

Ein Netzwerk-, Timeout- oder Runtimefehler ist keine Modellantwort.

Zulässig bleibt nur:

- expliziter 400-Tool-Payload-Fallback
- danach echter Fehler

Bei Fehler:

```text
Run.error setzen
Run.status = failed
Fehlerkarte rendern
```

Fehlerkarte zeigt:

```text
Phase
Provider
Modell
Endpoint
Request-ID
Fehlermeldung
```

Buttons:

```text
Erneut versuchen
Runtime stoppen
Logs öffnen
Diagnose exportieren
```

---

# 15. Run-Abschluss korrekt persistieren

Beim Abschluss zuerst den finalen Run erzeugen, dann speichern.

Nicht:

```text
updateActiveRun(...)
direkt danach get().activeRun
```

wenn dadurch möglicherweise ein veralteter Zustand gelesen wird.

Verwende eine atomare Store-Aktualisierung:

```typescript
set((state) => {
  if (!state.activeRun) return state;

  const finalRun = updateRunStatus(
    appendRunEvent(state.activeRun, "chat.completed", "..."),
    "completed"
  );

  return {
    activeRun: null,
    historicalRuns: {
      ...state.historicalRuns,
      [finalRun.id]: finalRun
    }
  };
});
```

Dasselbe für:

- cancelled
- timeout
- failed

---

# 16. Analyseprotokoll nicht mehr als Systemnachricht

Das bisherige Analyseprotokoll soll nicht den normalen Chatverlauf mit technischen Systemnachrichten vermischen.

Stattdessen in den jeweiligen `RuntimeChatRun` integrieren:

```text
Dauer
Agent
Modell
Verlauf
Kontextnachrichten
Workspace
aktive Datei
Antwortlänge
Patch-Erkennung
```

Als aufklappbarer Bereich:

```text
Run-Zusammenfassung
```

---

# 17. Diagnoseexport

Der JSON-Export soll enthalten:

```text
Run
Events
Turns
Tool Calls
File Changes
Commands
Error
Provider
Modell
Endpoint
Request-ID
Zeitpunkte
```

Keine vollständigen Secrets oder API-Keys exportieren.

Promptinhalte optional kürzen oder redigieren.

---

# 18. Tests

Mindestens:

```text
RuntimeChatTab.test.tsx
CodeeRunLiveBlock.test.tsx
runtimeChatStore.test.ts
runtimeChatRunHelpers.test.ts
runtimeChatStream.test.ts
```

Testfälle:

## Typecheck

- keine undefinierten Variablen
- keine fehlenden Imports

## Double Submit

- zweiter Send-Versuch während `isSending` wird abgewiesen
- nur eine User-Nachricht
- nur ein Run

## Run-Zuordnung

- User Message, Run und Assistant Message korrekt verbunden
- Run bleibt nach Abschluss sichtbar

## Events

- started nicht grün
- completed grün
- failed rot
- cancelled neutral
- timeout als Timeout

## Abbruch

- Request A abbrechen
- Request B bleibt unberührt
- AbortError wird als cancelled behandelt
- kein Retry
- kein Chat-Fehler

## First Token Timeout

- kein Delta
- Timeout
- Request wird abgebrochen
- Run wird `timeout`

## Gesamt-Timeout

- Stream liefert endlos
- Gesamt-Timeout beendet Run

## Transportfehler

- Fehlerkarte
- keine künstliche Assistant-Nachricht

## Turns und Tools

- Turn wird angelegt
- Tool Call wird aktualisiert
- Ergebnis wird angezeigt

## Diff

- Additions und Deletions stimmen
- echter Unified Diff vorhanden

---

# 19. Manuelle Abnahme

## Test A — normaler Chat

```text
Auto
Ask
Kontext AUS
Hallo
```

Erwartung:

- eine User-Nachricht
- ein Run
- Statusschritte sichtbar
- Assistant-Antwort
- Run bleibt sichtbar

## Test B — transparenter Agentenlauf

```text
Auto
Full
Kontext AN
Prüfe den Runtime-Chat auf mögliche Fehler.
```

Erwartung:

- Kontextschritte sichtbar
- Modellturns sichtbar
- Tool Calls sichtbar
- keine unsichtbare Wartephase

## Test C — Abbruch

Während der Antwort Stopp drücken.

Erwartung:

- nur dieser Run wird abgebrochen
- Status `cancelled`
- kein Fehlertext als Assistant-Antwort

## Test D — Timeout

Nicht antwortende Runtime simulieren.

Erwartung:

- `waiting_first_token`
- danach Timeout
- Fehlerkarte
- Request beendet

## Test E — Dateiänderung

Patch-Vorschlag erzeugen.

Erwartung:

- echter Diff
- korrekte Additions/Deletions
- Apply/Ablehnen funktioniert
- Restore-Point-Pfad bleibt erhalten

---

# 20. Qualitätsgates

```powershell
pnpm typecheck
pnpm --filter @dbzs/desktop test
pnpm build
```

Nicht ausgeführte Tests als `NOT RUN` dokumentieren.

Keine Produktionsreife behaupten, wenn kein manueller End-to-End-Test stattgefunden hat.

---

# 21. Commit-Reihenfolge

Keine Mammutänderung.

```text
fix(runtime-chat): repair run creation and message ids
feat(runtime-chat): persist runs inside conversation history
fix(runtime-chat): add request scoped cancellation
feat(runtime-chat): enforce first token and total timeouts
fix(runtime-chat): expose transport errors honestly
feat(runtime-chat): render turns tools commands and truthful events
fix(runtime-chat): use real diff data and diff editor
test(runtime-chat): cover run lifecycle cancellation timeout and history
docs(runtime-chat): document transparent run workflow
```

---

# 22. Definition of Done

- [ ] Typecheck ist grün.
- [ ] Eine Nachricht erzeugt genau einen Run.
- [ ] Kein Doppel-Submit.
- [ ] User Message, Run und Assistant Message sind per IDs verbunden.
- [ ] Abgeschlossene Runs bleiben im Chat sichtbar.
- [ ] Events zeigen korrekte Statussymbole.
- [ ] Modellturns werden befüllt und angezeigt.
- [ ] Tool Calls werden stabil aktualisiert und angezeigt.
- [ ] Commands werden befüllt und angezeigt.
- [ ] Dateiänderungen verwenden echte Diffs.
- [ ] Abbruch ist requestbezogen.
- [ ] Abort wird als `cancelled` behandelt.
- [ ] First-Token-Timeout funktioniert.
- [ ] Gesamt-Timeout funktioniert.
- [ ] Transportfehler erscheinen als Fehlerkarte.
- [ ] Keine künstliche Assistant-Antwort verdeckt Fehler.
- [ ] Analyseprotokoll ist Teil des Runs, nicht Chat-Systemnachricht.
- [ ] Tests und Build sind grün.
- [ ] Manuelle Tests A–E sind als PASS, FAIL oder NOT RUN dokumentiert.

---

# Abschlussbericht

Am Ende liefern:

```text
1. Gefundene Defekte
2. Geänderte Dateien
3. Nachrichten-/Run-Zuordnung
4. Run-Persistenz
5. Abbruchmechanismus
6. Timeoutmechanismus
7. Event-/Turn-/Tool-/Command-Anzeige
8. Diff-Integration
9. Ausgeführte Tests
10. Manueller Test A: PASS / FAIL / NOT RUN
11. Manueller Test B: PASS / FAIL / NOT RUN
12. Manueller Test C: PASS / FAIL / NOT RUN
13. Manueller Test D: PASS / FAIL / NOT RUN
14. Manueller Test E: PASS / FAIL / NOT RUN
15. Bekannte Restprobleme
16. Ehrlicher Readiness-Status
```
