# GitHub Copilot Auftrag — CODEE Runtime Routing & Abort Hardening

Repository:

`devdbzemusic/dbzs-codee-project`

## Ziel

Stabilisiere den aktuellen `main`-Stand gezielt.

Kein Architekturumbau.
Keine neue UI.
Keine zusätzlichen großen Module.
Keine pauschalen Aussagen wie „Production Ready“, solange die unten genannten Nachweise fehlen.

Der Fokus dieses Pull Requests liegt ausschließlich auf:

1. request-spezifischer Fallback-Policy
2. sauberer AbortSignal-Komposition
3. echtem Request-Cancel
4. reproduzierbaren Tests
5. verlässlichem Cleanup

---

# 1. Request-spezifische Fallback-Policy

Prüfe den vollständigen Datenfluss:

```text
runtimeChatStore
→ modelSelectionBroker
→ runtimeChatAgentRunner
→ backendClient
→ Electron Preload
→ Electron Main
→ FastAPI Runtime API
→ RuntimeService.resolve_chat_target()
```

Die Broker-Entscheidung muss pro User-Turn genau einmal erzeugt und unverändert weitergereicht werden.

Mindestens diese Felder müssen konsistent bleiben:

```ts
{
  decision_id: string;
  model_id: string | null;
  slot_id: string | null;
  provider: string;
  fallback_policy: FallbackPolicy;
  routing_reason: string;
}
```

## Erlaubte Policies

Definiere zentral einen typisierten Contract:

```text
strict
allow_local_fallback
allow_cloud_fallback
allow_any_fallback
```

Keine frei verteilten String-Literale in Frontend und Backend.

Geeignete Umsetzung:

- TypeScript: Union Type oder Enum im Shared Package
- Python: `Enum` oder `Literal`
- API-Schema validiert unbekannte Werte
- fehlende Policy verwendet nur einen klar dokumentierten Default

## Prioritätsregel

Die Request-Policy hat Vorrang vor der globalen Service-Policy.

Beispiel:

```python
effective_policy = chat_request.fallback_policy or self.default_fallback_policy
```

`RuntimeService.resolve_chat_target()` darf nicht ausschließlich `self.fallback_policy` auswerten.

## Erwartetes Verhalten

### `strict`

- kein stiller Wechsel auf einen anderen Slot
- kein anderes Modell
- kein Cloud-Fallback
- eindeutiger Fehler

### `allow_local_fallback`

- nur andere lokale Slots erlaubt
- tatsächlich verwendeter Slot und Modell werden zurückgemeldet
- `fallback_reason` muss gesetzt sein

### `allow_cloud_fallback`

- lokaler Slot darf nicht still auf einen anderen lokalen Slot wechseln
- Cloud-Fallback nur über den bestehenden kontrollierten Cloud-Pfad
- keine neue Cloud-Architektur bauen

### `allow_any_fallback`

- vorhandene lokale Fallbacks zuerst
- danach bestehender Cloud-Fallback
- Entscheidung und Ursache vollständig protokollieren

---

# 2. AbortSignal-Komposition

Entferne direkte, ungeschützte Verwendungen von:

```ts
AbortSignal.any(...)
```

Erstelle eine zentrale Utility, beispielsweise:

```ts
export interface CombinedAbortSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

export function combineAbortSignals(
  signals: Array<AbortSignal | undefined>,
): CombinedAbortSignal
```

## Anforderungen

Die Utility muss:

- bereits abgebrochene Eingangssignale erkennen
- einen eigenen `AbortController` verwenden
- mit und ohne `AbortSignal.any()` funktionieren
- Event Listener in `cleanup()` entfernen
- mehrfaches Abort sicher behandeln
- keine fremden Signale über `dispatchEvent()` manipulieren
- keine Listener-Leaks verursachen

Nicht verwenden:

```ts
(signal as any).dispatchEvent(new Event("abort"))
```

## Tests

Erstelle Tests für:

1. erstes Signal bricht ab
2. zweites Signal bricht ab
3. Signal ist bereits vor Kombination abgebrochen
4. `cleanup()` entfernt Listener
5. kein `AbortSignal.any()` verfügbar
6. mehrfacher Abort verursacht keinen Fehler

---

# 3. Runtime Slot Validator härten

Datei prüfen:

```text
apps/desktop/src/services/runtimeSlotValidator.ts
```

## Anforderungen

- zentrale `combineAbortSignals()`-Utility verwenden
- Timeout immer in `finally` löschen
- Cleanup der kombinierten Signale immer in `finally`
- Abort darf nicht als normaler Slot-Fehler verschleiert werden
- Timeout und externer Abort müssen unterscheidbar bleiben, soweit bestehende Contracts dies erlauben
- kein Listener darf nach Request-Ende bestehen bleiben

Geeignete Struktur:

```ts
const timeoutController = new AbortController();
const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

const combined = combineAbortSignals([
  timeoutController.signal,
  externalSignal,
]);

try {
  return await fetch(...);
} finally {
  clearTimeout(timeoutId);
  combined.cleanup();
}
```

---

# 4. Non-Streaming Request Cancel verifizieren

Prüfe den vollständigen Pfad:

```text
backendClient.sendRuntimeChat()
→ preload.sendRuntimeChat(request, requestId)
→ ipcMain handler
→ Map<requestId, AbortController>
→ requestBackend(..., signal)
```

## Anforderungen

- jede Anfrage hat eine eindeutige `requestId`
- `requestId` wird vollständig durchgereicht
- Electron Main speichert genau einen Controller pro aktiver Request-ID
- `cancelRuntimeChat(requestId)` bricht nur diesen Request ab
- Eintrag wird in jedem Fall entfernt
- Cleanup erfolgt in `finally`
- unbekannte Request-ID liefert kontrollierten Status
- doppelte Request-ID überschreibt keinen aktiven Request unbemerkt
- abgebrochene Antwort darf nicht nachträglich in den Chat-Store geschrieben werden

## Integrationstest

Erstelle einen Test mit einem absichtlich verzögerten Backend-Request:

1. Request starten
2. aktive Request-ID bestätigen
3. Cancel auslösen
4. HTTP-Request muss wirklich abbrechen
5. Controller-Map muss leer sein
6. kein Response-Text wird gespeichert
7. Fehler wird als Abort klassifiziert, nicht als normaler Backend-Fehler

---

# 5. Streaming Cancel prüfen

Prüfe:

- genau ein aktiver Stream-Controller
- vorheriger Stream wird vor Start eines neuen Streams sauber beendet
- Abort stoppt Reader, Stream und Backend-Verbindung
- keine Chunks nach Abort
- Listener werden im `finally` entfernt
- Controller wird im `finally` zurückgesetzt
- keine doppelte Abschlussmeldung

Erstelle mindestens einen Integrationstest für einen abgebrochenen Stream.

---

# 6. Broker-Entscheidung als Single Source of Truth

Innerhalb eines User-Turns darf keine zweite Routing-Entscheidung entstehen.

Prüfe besonders:

```text
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/services/runtimeChatAgentRunner.ts
apps/desktop/src/services/agentRunService.ts
backend/app/runtime/service.py
```

## Anforderungen

- `decision_id` bleibt über alle Agent-Schritte gleich
- Agent Loop verwendet dieselbe Modell-/Slot-Auswahl
- Retry darf nicht unbemerkt neu routen
- Diagnostics zeigen die tatsächlich verwendete Entscheidung
- Trajectory speichert dieselbe `decision_id`
- tatsächlicher Fallback wird als Ergebnis ergänzt, nicht als neue ursprüngliche Entscheidung ausgegeben

---

# 7. Tests

Erstelle oder erweitere Tests für folgende Fälle:

## Backend

1. `strict` + Slot nicht verfügbar → Fehler
2. `allow_local_fallback` + alternativer lokaler Slot verfügbar → Erfolg
3. `allow_local_fallback` + kein lokaler Slot verfügbar → Fehler
4. Request-Policy überschreibt Service-Default
5. unbekannte Policy → Validierungsfehler
6. Modell stimmt nicht mit Slot überein → Fehler
7. Fallback-Ergebnis enthält `fallback_reason`

## Desktop

1. AbortSignal-Utility mit und ohne `AbortSignal.any`
2. Timeout-Cleanup
3. externer Abort
4. Non-Streaming-Cancel
5. Streaming-Cancel
6. Broker-Entscheidung bleibt im Agent Loop identisch
7. kein Chat-Store-Update nach Abort

---

# 8. Dokumentation

Aktualisiere nur die verbindlichen Statusquellen:

```text
README.md
docs/STATUS_MATRIX.md
docs/ROADMAP.md
HANDOVER.md
```

Keine neue Completion-Report-Datei erzeugen.

Verwende ausschließlich folgende Statuswerte:

```text
REAL
PARTIAL
MOCK
BLOCKED
DEPRECATED
```

Dokumentiere:

- was implementiert wurde
- welche Tests tatsächlich gelaufen sind
- welche Einschränkungen bestehen
- welche Punkte noch offen sind

Keine Behauptung „Production Ready“, solange kein vollständiger CI- und Acceptance-Nachweis vorliegt.

---

# 9. Qualitäts-Gates

Vor Abschluss ausführen:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm doctor:all
pnpm smoke-test
pnpm test:capabilities
```

Zusätzlich die neu erstellten gezielten Tests ausführen.

Keinen fehlschlagenden Test deaktivieren oder überspringen.

Falls ein Gate nicht lokal ausführbar ist:

- Grund exakt dokumentieren
- ausgeführte Teiltests nennen
- keine erfolgreiche Gesamtverifikation behaupten

---

# 10. Commit-Struktur

Empfohlene Commits:

```text
fix(routing): enforce request-scoped fallback policy
fix(chat): add compatible abort signal composition
fix(runtime): harden non-stream request cancellation
test(runtime): cover routing and cancellation contracts
docs(status): align runtime hardening status
```

Keine Sammel-Commits mit unklaren Änderungen.

---

# Definition of Done

Der Pull Request ist erst fertig, wenn:

- Request-Policy im Backend tatsächlich verwendet wird
- alle vier Fallback-Policies zentral typisiert sind
- keine ungeschützte `AbortSignal.any()`-Verwendung verbleibt
- keine fremden AbortSignals über `dispatchEvent()` manipuliert werden
- Timeout- und Listener-Cleanup in `finally` erfolgt
- Non-Streaming-Cancel den realen HTTP-Request beendet
- Streaming-Cancel keine Chunks nach Abort zulässt
- Broker-Entscheidung über den gesamten Agent-Run stabil bleibt
- alle neuen Tests grün sind
- bestehende Qualitäts-Gates nicht verschlechtert wurden
- offene P0-/P1-Befunde dieses Bereichs geschlossen sind

## Abschlussbericht im Pull Request

Liefere am Ende:

1. Audit-Befunde
2. Root Causes
3. geänderte Dateien
4. Testresultate mit exakten Kommandos
5. nicht ausgeführte Tests mit Begründung
6. bekannte Restprobleme
7. offene Review-Threads
8. nächste sinnvolle Phase

Wichtig:

Nicht den vollständigen Coding Loop, keine Repository Map und keine neue Agentenarchitektur in diesem Pull Request umsetzen. Dieser PR muss klein, prüfbar und ausschließlich auf Runtime Routing und Abort Hardening begrenzt bleiben.
