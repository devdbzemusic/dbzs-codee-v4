# DBZS Codee – Backend-/Bridge-Kommunikationsreview

Stand: 01.08.2026
Repository: `devdbzemusic/dbzs-codee-project`
Geprüfter GitHub-Stand: Commit `6b56ee03025272e6f5726167a3664631ffe4b61f`

## Zielarchitektur

```text
Frontend
  ↓ ausschließlich typisierter Application Client
Electron Preload Bridge
  ↓ ausschließlich versionierte IPC Contracts
Electron Main / IPC Router
  ↓ ausschließlich zentraler Backend Transport
Backend HTTP/SSE API
```

Rückweg:

```text
Backend Event/Response
  → Electron Main
  → normalisiertes IPC Result / Event
  → Preload Bridge
  → Frontend Client
  → Store/UI
```

## Gesamturteil

Die Kommunikation funktioniert grundsätzlich, ist aber derzeit nicht konsistent genug für Produktionsreife.

Hauptproblem ist nicht ein einzelner Fehler, sondern Contract-Drift:

1. Bridge-Typen werden mehrfach manuell definiert.
2. Preload-Implementierung, `global.d.ts` und `backendClient.ts` können auseinanderlaufen.
3. Viele produktiv vorhandene Methoden sind im Frontend optional.
4. Timeout-Verantwortung ist zwischen Frontend und Electron Main nicht eindeutig.
5. Fehler werden überwiegend als freie `Error`-Strings transportiert.
6. IPC-Kanäle sind String-Literale ohne zentrale Registry.
7. Backend-Requests sind in der großen Electron-Main-Datei mit UI-, Workspace-, Git- und Runtime-Logik vermischt.
8. `unknown` wird für Orchestrierungsverträge verwendet.
9. Cancellation ist nicht über alle Schichten requestbezogen.
10. `main.ts` ist gleichzeitig Bootstrap, IPC-Router, Backend-Transport und Domain-Orchestrator.

## P0-Befunde

### P0.1 Drei konkurrierende Bridge-Verträge

Betroffene Dateien:

- `apps/desktop/electron/preload.ts`
- `apps/desktop/src/types/global.d.ts`
- `apps/desktop/src/services/backendClient.ts`

Alle drei beschreiben dieselbe Oberfläche erneut. Dadurch kann TypeScript nur jede Datei für sich prüfen, nicht aber garantieren, dass Renderer, Preload und Main denselben Vertrag implementieren.

Konkretes Symptom:

- `preload.ts` stellt Methoden real bereit.
- `global.d.ts` markiert einen großen Teil davon optional.
- `backendClient.ts` prüft diese Methoden erneut zur Laufzeit und erzeugt Fehler wie `"method is unavailable"`.

Das verschiebt Integrationsfehler von Build-Zeit auf Laufzeit.

### P0.2 Timeout-Widerspruch beim Runtime-Chat

In `electron/main.ts` steht sinngemäß:

- Chat-Endpunkte sollen keinen Electron-Backend-Timeout erhalten.
- Das Frontend soll über `AbortSignal` zuständig sein.

In `backendClient.ts` wird jedoch zusätzlich ein fester Chat-Timeout von `60_000 ms` erzeugt.

Folgen:

- Lange lokale Inferenz kann nach 60 Sekunden abgebrochen werden.
- Der Renderer kann abbrechen, während Electron oder Backend weiterarbeiten.
- Timeout-Fehler, Benutzerabbruch und Backend-Ausfall sind nicht sicher unterscheidbar.
- Ein Modellstart oder Cold Start kann fälschlich als Chatfehler erscheinen.

### P0.3 Cancellation nicht vollständig requestbezogen

Es existieren unterschiedliche Muster:

- Request-ID bei nicht gestreamtem Chat
- global wirkendes `cancelRuntimeChatStream`
- Callback-basierter Stream
- `AbortSignal` nur im Renderer-Client

Produktionsreif wäre:

```ts
start(request, { requestId, signal })
cancel(requestId)
subscribe(requestId, listener)
```

Jeder Request muss über alle Schichten dieselbe `requestId` behalten.

### P0.4 Unstrukturierte Fehlergrenze

Die Bridge liefert überwiegend erfolgreiche DTOs oder wirft normale JavaScript-Errors. Es fehlt ein gemeinsames Fehlerformat, zum Beispiel:

```ts
interface CodeeError {
  code: CodeeErrorCode;
  message: string;
  layer: "frontend" | "preload" | "electron" | "backend";
  operation: string;
  retryable: boolean;
  requestId?: string;
  status?: number;
  details?: unknown;
  causeCode?: string;
}
```

Ohne Fehlercodes muss die UI Texte analysieren oder pauschal reagieren.

### P0.5 IPC-Kanäle als verteilte String-Literale

Beispiele:

- `dbzs:backend-health`
- `dbzs:runtime:*`
- `dbzs:workspace:*`
- `dbzs:git:*`

Die Strings stehen in Preload und Main separat. Tippfehler und Umbenennungen sind nicht statisch abgesichert.

## P1-Befunde

### P1.1 `main.ts` hat zu viele Verantwortlichkeiten

`apps/desktop/electron/main.ts` enthält unter anderem:

- Electron Bootstrap
- Fensterverwaltung
- Backend-Prozessstart
- Cleanup
- Timeout-Auswahl
- HTTP-Kommunikation
- IPC-Handler
- Workspace
- Runtime Chat
- Git
- Settings
- Skills
- Restore Points
- Research

Das erschwert Tests, Refactoring und Fehlerisolation.

### P1.2 `unknown` in produktiven Orchestrierungsverträgen

In `BackendBridge`:

```ts
listOrchestrationTools?: () => Promise<unknown>;
prepareOrchestrationContext?: (request: unknown) => Promise<unknown>;
executeOrchestrationTool?: (request: unknown) => Promise<unknown>;
```

Diese Funktionen liegen genau an einer sicherheitskritischen Tool-Grenze und benötigen besonders strikte Typen.

### P1.3 Optionale Kernfunktionen

Viele Methoden sind mit `?` markiert, obwohl die Desktop-App ohne sie nicht vollständig funktionsfähig ist.

Empfehlung:

- `DesktopBridgeV1`: alle verpflichtenden Desktop-Funktionen
- `BridgeCapabilities`: echte optionale Features
- Feature-Erkennung nur anhand expliziter Capabilities, nicht anhand `if (method)`.

### P1.4 Typduplikat in `global.d.ts`

`AgentPatchProposal` wird in der Importliste doppelt importiert. Das ist klein, zeigt aber, dass diese große manuelle Deklaration bereits driftet.

### P1.5 Inkonsistente Null-Semantik

Beispiel:

- Preload `readProjectFile`: `Promise<WorkspaceFile>`
- andere Typdefinition: `Promise<WorkspaceFile | null>`

Eine solche Abweichung zwingt Verbraucher zu unnötigen oder fehlenden Nullprüfungen.

## Empfohlener Refactor

## Phase 1 – Zentrale Contracts

Neue Struktur:

```text
packages/shared/src/bridge/
  channels.ts
  contract.ts
  errors.ts
  envelope.ts
  timeouts.ts
  capabilities.ts
```

### `channels.ts`

```ts
export const IPC = {
  appInfo: "dbzs:app-info",
  backendHealth: "dbzs:backend-health",
  runtimeChatSend: "dbzs:runtime:chat:send",
  runtimeChatCancel: "dbzs:runtime:chat:cancel",
} as const;
```

### `contract.ts`

Eine einzige kanonische Schnittstelle:

```ts
export interface DesktopBridgeV1 {
  readonly version: 1;
  readonly capabilities: BridgeCapabilities;

  getAppInfo(): Promise<AppInfo>;
  getBackendHealth(): Promise<BackendHealth>;
  sendRuntimeChat(request: RuntimeChatBridgeRequest): Promise<RuntimeChatResponse>;
  cancelRuntimeChat(requestId: string): Promise<CancelResult>;
}
```

Dann:

```ts
// preload.ts
const api = { ... } satisfies DesktopBridgeV1;

// global.d.ts
interface Window {
  dbzs: DesktopBridgeV1;
}

// backendClient.ts
function bridge(): DesktopBridgeV1 { ... }
```

Keine dreifache manuelle Definition mehr.

## Phase 2 – Result Envelope und Fehlercodes

```ts
export type BridgeResult<T> =
  | { ok: true; data: T; meta: OperationMeta }
  | { ok: false; error: CodeeError; meta: OperationMeta };
```

Empfohlene Codes:

```ts
type CodeeErrorCode =
  | "BACKEND_UNAVAILABLE"
  | "BACKEND_START_TIMEOUT"
  | "REQUEST_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "IPC_HANDLER_MISSING"
  | "MODEL_NOT_READY"
  | "MODEL_START_FAILED"
  | "WORKSPACE_ACCESS_DENIED"
  | "INTERNAL_ERROR";
```

## Phase 3 – Zentraler Backend Transport

Aus `main.ts` extrahieren:

```text
apps/desktop/electron/backend/
  backendTransport.ts
  backendProcessManager.ts
  backendErrorMapper.ts
  backendRoutes.ts
  timeoutPolicy.ts
```

API:

```ts
interface BackendTransport {
  request<TRequest, TResponse>(
    operation: BackendOperation<TRequest, TResponse>,
    request: TRequest,
    context: RequestContext
  ): Promise<TResponse>;
}
```

Der Transport übernimmt zentral:

- URL-Aufbau
- JSON
- Statusprüfung
- Schema-Validierung
- Retry nur bei erlaubten idempotenten Operationen
- Timeout
- Abort
- Request-ID
- Logging
- Fehlernormalisierung

## Phase 4 – IPC Router zerlegen

```text
apps/desktop/electron/ipc/
  registerAppIpc.ts
  registerBackendIpc.ts
  registerRuntimeIpc.ts
  registerWorkspaceIpc.ts
  registerGitIpc.ts
  registerSettingsIpc.ts
  registerSkillsIpc.ts
  registerTerminalIpc.ts
```

Jeder Handler wird über einen typisierten Wrapper registriert:

```ts
registerIpcHandler(IPC.runtimeChatSend, async (ctx, request) => {
  return runtimeService.sendChat(request, ctx);
});
```

## Phase 5 – Frontend Application Client

`backendClient.ts` sollte keine zweite Bridge-Schnittstelle enthalten.

Neue Aufteilung:

```text
apps/desktop/src/infrastructure/
  desktopBridge.ts
  codeeClient.ts
  errorPresenter.ts
```

Stores greifen nur auf fachliche Clients zu:

```ts
runtimeClient.sendChat(...)
workspaceClient.readFile(...)
gitClient.getStatus(...)
```

Kein Store kennt IPC-Kanäle oder Electron-spezifische Details.

## Timeout-Policy

Timeouts müssen nach Operation und nicht nach URL-Substring definiert werden.

```ts
export const TIMEOUTS = {
  health: 5_000,
  metadata: 10_000,
  backendStartup: 60_000,
  runtimeStart: 180_000,
  runtimeStop: 30_000,
  runtimeDoctor: 120_000,
  modelScan: 10 * 60_000,
  benchmark: 30 * 60_000,
  download: 0,
  chat: 0,
  stream: 0,
} as const;
```

`0` bedeutet kein künstlicher Wall-Clock-Timeout; Abbruch erfolgt explizit per Benutzer, Shutdown oder fachlicher Idle-Policy.

Für Streaming getrennt:

- connect timeout
- first-token timeout
- idle timeout
- optional total timeout

Beispiel:

```ts
interface StreamTimeoutPolicy {
  connectMs: number;
  firstEventMs: number;
  idleMs: number;
  totalMs?: number;
}
```

Empfehlung für lokale Modelle:

```ts
{
  connectMs: 15_000,
  firstEventMs: 180_000,
  idleMs: 120_000
}
```

Ein globaler 60-Sekunden-Chat-Timeout ist für lokale Modelle ungeeignet.

## Typprüfung und Laufzeitvalidierung

TypeScript-Typen schützen nicht vor fehlerhaften Backend-JSON-Antworten.

Deshalb an der Electron/Backend-Grenze Schema-Validierung einführen, bevorzugt mit bereits projektverträglicher Schema-Lösung oder Zod.

```ts
const RuntimeStatusSchema = z.object({
  state: z.enum(["stopped", "starting", "running", "error"]),
  model_id: z.string().nullable(),
});
```

Nur validierte Daten dürfen über die Preload-Bridge gelangen.

## Testplan

### Contract Tests

- Preload erfüllt `DesktopBridgeV1`
- alle IPC-Kanäle besitzen genau einen Handler
- kein Handler ist nur im Preload oder nur im Main vorhanden
- keine doppelten IPC-Kanäle

### Timeout Tests

- Health bricht korrekt ab
- Chat besitzt keinen festen 60-s-Total-Timeout
- First-token timeout ist getrennt
- Benutzerabbruch ergibt `REQUEST_CANCELLED`
- Timeout ergibt `REQUEST_TIMEOUT`
- Backend-Neustart ergibt `BACKEND_UNAVAILABLE` oder definierten Retry

### Type Tests

- `tsc --noEmit`
- `satisfies DesktopBridgeV1`
- `tsd` oder `expectTypeOf`
- kein `unknown` in öffentlichen Bridge-Methoden
- keine optionalen Pflichtmethoden

### Integration Tests

```text
Frontend Client
→ fake Preload
→ IPC handler
→ mock BackendTransport
→ validierter Response
```

### Failure Injection

- Backend nicht gestartet
- Port belegt
- ungültiges JSON
- HTTP 500
- Verbindung bricht im Stream ab
- Modell startet länger als 60 Sekunden
- Renderer wird während Request geschlossen
- Backend wird während Request neu gestartet

## Priorisierung

### P0

1. Gemeinsamen `DesktopBridgeV1`-Contract erstellen.
2. `global.d.ts` und `backendClient.ts` auf diesen Contract umstellen.
3. IPC-Channel-Registry erstellen.
4. festen 60-s-Chat-Timeout entfernen.
5. requestbezogene Cancellation durch alle Schichten führen.
6. strukturierte Fehlercodes einführen.

### P1

7. Backend-Transport aus `main.ts` extrahieren.
8. IPC-Handler modularisieren.
9. Backend-Antworten zur Laufzeit validieren.
10. Orchestrierungs-`unknown` durch DTOs ersetzen.
11. Contract- und Timeout-Tests ergänzen.

### P2

12. Telemetrie pro Operation: Dauer, Retry, Timeout, Cancel, Backendstatus.
13. Circuit Breaker für wiederholte Backend-Ausfälle.
14. Bridge-Versionierung und Capability Negotiation.
15. SSE/Streaming auf ein einheitliches Event-Protokoll umstellen.

## Definition of Done

- Nur eine Bridge-Definition.
- Kein IPC-String außerhalb der Channel-Registry.
- Kein `unknown` in öffentlichen Kommunikationsverträgen.
- Keine optionale Methode für verpflichtende Desktop-Funktionen.
- Jeder Request besitzt `requestId`, `operation`, `startedAt`.
- Timeout und Cancel sind unterscheidbar.
- Backend-Antworten werden validiert.
- `main.ts` enthält nur Bootstrap und Modulregistrierung.
- Contract-, Timeout- und Failure-Tests laufen in CI.
- Stores und UI kennen weder `ipcRenderer` noch Backend-URLs.
