# Verbindlicher Repairplan für `dbzs-codee-v4`

Dieser Plan ist als **ausführbare technische Arbeitsanweisung** formuliert. Es gibt keine Interpretationsfreiheit bei Reihenfolge, Zuständen, Abhängigkeiten oder Abnahmekriterien.

---

# 0. Zielzustand

Der Desktop-Start muss exakt so funktionieren:

```text
1. Electron startet
2. Splash-Fenster wird sichtbar
3. Hauptfenster bleibt unsichtbar
4. Boot-Orchestrator startet
5. Jede Bootphase wird strikt sequenziell ausgeführt
6. Keine Phase startet vor Abschluss der vorherigen Phase
7. Backend-Liveness und Backend-Readiness werden getrennt geprüft
8. Laufende Backend-Aufgaben werden als pending/waiting behandelt
9. Echte Fehler werden als failed behandelt
10. Polling und Retry werden getrennt gezählt
11. Das Hauptfenster wird erst nach vollständigem Boot freigegeben
12. Erstes Rendering des Hauptfensters wird abgewartet
13. Hauptfenster wird angezeigt
14. Splash-Fenster wird geschlossen
```

Eine Phase darf nur grün werden, wenn die von ihr behauptete Invariante tatsächlich geprüft und erfüllt wurde.

---

# 1. Arbeitsbranch anlegen

Erstelle einen separaten Branch:

```bash
git checkout main
git pull
git checkout -b repair/boot-orchestrator-deterministic
```

Keine Änderungen direkt auf `main`.

---

# 2. Bestehenden Zustand sichern

Vor jeder Änderung:

```bash
npm install
npm run typecheck
npm run test
npm run build
```

Backend:

```bash
cd backend
uv sync
uv run pytest
cd ..
```

Ergebnisse in folgender Datei dokumentieren:

```text
docs/repair/BOOT_REPAIR_BASELINE.md
```

Inhalt:

```md
# Boot Repair Baseline

## Commit

<aktueller SHA>

## Desktop

- install:
- typecheck:
- tests:
- build:

## Backend

- dependency sync:
- tests:

## Bereits bekannte Fehler

- ...
```

Abbruchbedingung:

```text
Falls der aktuelle Stand nicht baut:
Fehler dokumentieren.
Nicht nebenbei reparieren.
Nur Fehler beheben, die den Boot-Repair blockieren.
```

---

# 3. Boot-Domain-Modell korrigieren

## Betroffene Dateien

Mindestens:

```text
packages/shared/src/...
apps/desktop/electron/boot/bootOrchestrator.ts
apps/desktop/electron/boot/bootPhaseDefinitions.ts
apps/desktop/electron/boot/phaseRunners.ts
```

Der Orchestrator kennt derzeit als Runner-Ergebnisse nur:

```ts
"success" | "warning" | "failed"
```

Dadurch werden normale Wartezustände als Fehler missbraucht.

## 3.1 Neue Result-Typen definieren

Ersetze:

```ts
export type PhaseRunnerOutcome =
  | "success"
  | "warning"
  | "failed";
```

durch:

```ts
export type PhaseRunnerOutcome =
  | "success"
  | "warning"
  | "pending"
  | "failed"
  | "skipped";
```

Erweitere das Ergebnis:

```ts
export interface PhaseRunnerResult {
  outcome: PhaseRunnerOutcome;
  message: string;
  progress?: number;
  pollAfterMs?: number;
  error?: Partial<BootError>;
  metadata?: Record<string, unknown>;
}
```

## 3.2 BootPhase erweitern

`BootPhase` muss mindestens enthalten:

```ts
export interface BootPhase {
  id: string;
  label: string;
  description?: string;

  state:
    | "pending"
    | "waiting"
    | "running"
    | "success"
    | "warning"
    | "failed"
    | "retrying"
    | "blocked"
    | "skipped";

  progress: number;
  message: string;

  dependencies: string[];

  optional: boolean;
  blocksWindowRelease: boolean;

  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;

  pollCount: number;
  retryCount: number;

  error?: BootError;
  metadata?: Record<string, unknown>;

  details: BootLogEntry[];
}
```

## 3.3 Timeout-Policy ersetzen

Ersetze die bisherige kombinierte Policy durch:

```ts
export interface BootPhasePolicy {
  softTimeoutMs: number;
  hardTimeoutMs: number;

  pollIntervalMs: number;

  maxRetries: number;
  retryDelayMs: number;

  extendDeadlineOnProgress: boolean;
  maxDeadlineExtensionMs: number;
}
```

Wichtig:

```text
pollCount zählt normale Zustandsabfragen.
retryCount zählt nur Wiederholungen nach echten Fehlern.
```

## Abnahmekriterium

Ein Backend-Komponentenstatus `running` darf:

```text
nicht
→ retrying
nicht
→ failed
```

erzeugen.

Er muss erzeugen:

```text
waiting
```

---

# 4. Boot-Graph validieren

Der Konstruktor des `BootOrchestrator` muss vor dem Start die gesamte Konfiguration prüfen.

## Neue Datei

```text
apps/desktop/electron/boot/validateBootGraph.ts
```

## Implementiere exakt diese Prüfungen

```ts
export interface BootGraphValidationResult {
  valid: boolean;
  errors: string[];
}
```

Prüfungen:

```text
1. Jede Phase-ID ist eindeutig.
2. Jede Abhängigkeit verweist auf eine existierende Phase.
3. Für jede Phase existiert genau ein Runner.
4. Kein Runner existiert ohne Phase.
5. Der Graph enthält keinen Zyklus.
6. Jede Phase ist vom Startknoten aus erreichbar.
7. Jede Timeout-Zahl ist endlich und >= 0.
8. hardTimeoutMs ist größer als softTimeoutMs.
9. pollIntervalMs ist größer als 0.
10. maxRetries ist eine ganze Zahl >= 0.
11. blocksWindowRelease ist explizit gesetzt.
12. Es existiert genau eine Release-Phase.
13. Die Release-Phase ist nicht optional.
```

## Konstruktorverhalten

Im Konstruktor:

```ts
const validation = validateBootGraph(phaseDefinitions, runners);

if (!validation.valid) {
  throw new Error(
    `Invalid boot graph:\n${validation.errors.join("\n")}`
  );
}
```

## Abnahmekriterium

Ein zyklischer Graph muss sofort mit eindeutiger Meldung abbrechen:

```text
Boot graph cycle detected:
backend-ready -> database-init -> backend-ready
```

Der Boot darf niemals einfach hängen bleiben.

---

# 5. Boot strikt sequenziell machen

Der aktuelle Scheduler startet alle gleichzeitig ausführbaren Phasen. Das ist zu ersetzen.

## 5.1 Scheduler ersetzen

Entferne:

```ts
const runnable = ...
for (const phase of runnable) {
  ...
}
```

Implementiere:

```ts
private pump(): void {
  this.applyBlocking();

  if (this.active.size > 0) {
    this.publish();
    return;
  }

  const next = this.findNextRunnablePhase();

  if (next) {
    const promise = this.executePhase(next.id).finally(() => {
      this.active.delete(next.id);
      this.pump();
    });

    this.active.set(next.id, promise);
    this.publish();
    return;
  }

  this.publish();

  if (this.isFullyTerminal()) {
    this.resolveRun?.();
    this.resolveRun = null;
  }
}
```

Implementiere:

```ts
private findNextRunnablePhase(): BootPhase | undefined {
  return this.state.phases.find(
    phase =>
      phase.state === "pending" &&
      !this.active.has(phase.id) &&
      this.dependenciesSatisfied(phase)
  );
}
```

## Verbindliche Regel

```text
Es darf zu jedem Zeitpunkt exakt null oder eine aktive Bootphase geben.
```

## Test

```ts
expect(maximumObservedConcurrentPhases).toBe(1);
```

---

# 6. Readiness-Architektur korrigieren

## 6.1 Endpunkte

Behalte:

```text
GET /health/live
```

Füge hinzu:

```text
GET /health/startup
```

Behalte:

```text
GET /health/ready
```

## 6.2 Semantik

### `/health/live`

Nur:

```json
{
  "status": "ok",
  "pid": 1234,
  "uptimeMs": 2845,
  "instanceId": "uuid",
  "bootNonce": "..."
}
```

Keine Datenbankabfrage.

Keine Modellabfrage.

Keine Runtime-Abfrage.

### `/health/startup`

Liefert den aktuellen Komponentenstatus:

```json
{
  "status": "starting",
  "ready": false,
  "progress": 42,
  "instanceId": "uuid",
  "components": {
    "database": {
      "state": "success",
      "progress": 100,
      "message": "Datenbank bereit"
    },
    "modelRegistry": {
      "state": "running",
      "progress": 438,
      "total": 2098,
      "message": "Modelle werden indexiert"
    },
    "runtimeManager": {
      "state": "waiting",
      "progress": 0
    },
    "residentModel": {
      "state": "waiting",
      "progress": 0
    }
  }
}
```

### `/health/ready`

Liefert nur den finalen Betriebsstatus:

```json
{
  "status": "ready",
  "ready": true,
  "instanceId": "uuid",
  "requiredComponents": {
    "database": "success",
    "modelRegistry": "success",
    "runtimeManager": "success"
  },
  "optionalComponents": {
    "residentModel": "success"
  }
}
```

Wenn nicht vollständig ready:

```http
HTTP 503
```

Body:

```json
{
  "status": "starting",
  "ready": false,
  "instanceId": "uuid"
}
```

---

# 7. Boot-Reihenfolge neu definieren

Ersetze die aktuellen Definitionen vollständig durch diese Reihenfolge:

```text
01 desktop-process
02 local-config
03 filesystem-check
04 backend-spawn
05 backend-live
06 backend-startup-api
07 database-init
08 model-index
09 runtime-manager-init
10 resident-model
11 backend-ready
12 frontend-bridge
13 frontend-config-sync
14 workspace-restore
15 agents-roles-models
16 main-window-rendered
17 main-app-released
```

## Exakte Abhängigkeiten

```ts
const BOOT_PHASE_DEFINITIONS = [
  {
    id: "desktop-process",
    dependencies: []
  },
  {
    id: "local-config",
    dependencies: ["desktop-process"]
  },
  {
    id: "filesystem-check",
    dependencies: ["local-config"]
  },
  {
    id: "backend-spawn",
    dependencies: ["filesystem-check"]
  },
  {
    id: "backend-live",
    dependencies: ["backend-spawn"]
  },
  {
    id: "backend-startup-api",
    dependencies: ["backend-live"]
  },
  {
    id: "database-init",
    dependencies: ["backend-startup-api"]
  },
  {
    id: "model-index",
    dependencies: ["database-init"]
  },
  {
    id: "runtime-manager-init",
    dependencies: ["model-index"]
  },
  {
    id: "resident-model",
    dependencies: ["runtime-manager-init"]
  },
  {
    id: "backend-ready",
    dependencies: ["runtime-manager-init", "resident-model"]
  },
  {
    id: "frontend-bridge",
    dependencies: ["backend-ready"]
  },
  {
    id: "frontend-config-sync",
    dependencies: ["frontend-bridge"]
  },
  {
    id: "workspace-restore",
    dependencies: ["frontend-config-sync"]
  },
  {
    id: "agents-roles-models",
    dependencies: ["workspace-restore"]
  },
  {
    id: "main-window-rendered",
    dependencies: ["agents-roles-models"]
  },
  {
    id: "main-app-released",
    dependencies: ["main-window-rendered"]
  }
];
```

## Residentes Modell

Das residente Modell darf exakt drei terminale Ergebnisse haben:

```text
success
warning
skipped
```

Es darf nicht endlos blockieren.

Regeln:

```text
Autostart aktiv + Modell startet:
success

Autostart aktiv + Primärmodell scheitert + Fallback startet:
warning

Autostart deaktiviert:
skipped

Autostart aktiv + kein Primärmodell + kein Fallback:
failed
```

Für die aktuelle Vorgabe gilt:

```text
resident-model.blocksWindowRelease = true
```

Damit bleibt der Splashscreen sichtbar, bis die Phase terminal ist.

---

# 8. PhaseRunner-Protokoll korrigieren

## 8.1 `componentResult()` ersetzen

Ersetze die Funktion vollständig:

```ts
function componentResult(
  component: BootReadinessComponent | undefined,
  reportProgress: (progress: number, message?: string) => void,
  readyLabel: string
): PhaseRunnerResult {
  if (!component) {
    return {
      outcome: "pending",
      message: "Backend hat noch keinen Komponentenstatus gemeldet.",
      pollAfterMs: 500
    };
  }

  const progress = normalizeProgress(
    component.progress,
    component.total
  );

  reportProgress(progress, component.message);

  switch (component.state) {
    case "success":
      return {
        outcome: "success",
        message: component.message ?? readyLabel,
        metadata: component.data
      };

    case "warning":
      return {
        outcome: "warning",
        message: component.message ?? readyLabel,
        metadata: component.data
      };

    case "skipped":
      return {
        outcome: "skipped",
        message: component.message ?? "Übersprungen.",
        metadata: component.data
      };

    case "failed":
      return {
        outcome: "failed",
        message: component.message ?? "Komponente fehlgeschlagen.",
        error: {
          code: component.error?.code ?? "component-failed",
          message:
            component.message ??
            "Komponente fehlgeschlagen.",
          technicalDetail:
            component.error?.technicalDetail,
          exitCode:
            component.error?.exitCode,
          stderrTail:
            component.error?.stderrTail
        },
        metadata: component.data
      };

    case "pending":
    case "waiting":
    case "running":
      return {
        outcome: "pending",
        message:
          component.message ??
          "Komponente wird initialisiert.",
        progress,
        pollAfterMs: 500,
        metadata: component.data
      };

    default:
      return {
        outcome: "failed",
        message:
          `Unbekannter Komponentenstatus: ${String(
            component.state
          )}`,
        error: {
          code: "unknown-component-state",
          message:
            `Unbekannter Komponentenstatus: ${String(
              component.state
            )}`
        }
      };
  }
}
```

## 8.2 Fortschritt normalisieren

Neue Funktion:

```ts
function normalizeProgress(
  progress?: number | null,
  total?: number | null
): number {
  if (
    typeof progress === "number" &&
    typeof total === "number" &&
    Number.isFinite(progress) &&
    Number.isFinite(total) &&
    total > 0
  ) {
    return Math.min(
      100,
      Math.max(0, Math.round((progress / total) * 100))
    );
  }

  if (
    typeof progress === "number" &&
    Number.isFinite(progress)
  ) {
    return Math.min(100, Math.max(0, progress));
  }

  return 0;
}
```

---

# 9. Orchestrator-Ausführung korrigieren

## 9.1 Pending-Behandlung

Im `executePhase()`:

```ts
if (result.outcome === "pending") {
  phase.pollCount += 1;
  phase.state = "waiting";
  phase.message = result.message;

  if (typeof result.progress === "number") {
    phase.progress = clampProgress(result.progress);
  }

  if (
    def.policy.extendDeadlineOnProgress &&
    phase.progress > previousProgress
  ) {
    deadline = Math.min(
      originalDeadline +
        def.policy.maxDeadlineExtensionMs,
      deadline + def.policy.pollIntervalMs
    );
  }

  this.publish();

  await this.clock.sleep(
    result.pollAfterMs ??
      def.policy.pollIntervalMs
  );

  phase.state = "running";
  this.publish();

  continue;
}
```

## 9.2 Failed-Behandlung

Nur bei echtem `failed`:

```ts
const canRetry =
  phase.retryCount < def.policy.maxRetries;
```

Dann:

```ts
phase.retryCount += 1;
phase.state = "retrying";
```

## 9.3 Warning und skipped

```ts
if (result.outcome === "warning") {
  finalizePhase("warning");
  return;
}

if (result.outcome === "skipped") {
  finalizePhase("skipped");
  return;
}
```

## 9.4 Hard-Timeout

Beim Hard-Timeout:

```text
phase.state = failed
error.code = hard-timeout
error.timeoutMs = hardTimeoutMs
```

Abhängige Phasen:

```text
blocked
```

---

# 10. Backend-Prozess-Ownership korrigieren

## 10.1 Neues Modell

```ts
export type BackendProcessOwnership =
  | "spawned-by-desktop"
  | "preexisting-local"
  | "unknown";

export interface BackendProcessInfo {
  ownership: BackendProcessOwnership;
  pid: number | null;
  port: number;
  instanceId: string | null;
}
```

## 10.2 Startlogik

Reihenfolge:

```text
1. /health/live abfragen
2. Antwortet gültige DBZS-Instanz:
   ownership = preexisting-local
   Backend nicht neu starten
3. Antwortet nicht:
   Backend spawnen
   ownership = spawned-by-desktop
4. /health/live pollen
5. PID und instanceId übernehmen
```

## 10.3 Stopplogik

Beim App-Ende:

```ts
if (ownership === "spawned-by-desktop") {
  stopBackend();
}
```

Ein bereits laufendes externes Backend darf nicht beendet werden.

---

# 11. Boot-Nonce und Instanzprüfung einbauen

## Desktop

Beim Start:

```ts
const bootNonce = randomUUID();
```

An Backend-Prozess übergeben:

```text
DBZS_BOOT_NONCE=<nonce>
DBZS_DESKTOP_INSTANCE_ID=<uuid>
```

## Backend `/health/live`

Antwort:

```json
{
  "status": "ok",
  "pid": 1234,
  "instanceId": "...",
  "bootNonce": "..."
}
```

## Desktop-Prüfung

```ts
if (
  response.bootNonce !== expectedBootNonce &&
  ownership === "spawned-by-desktop"
) {
  return failed("backend-instance-mismatch");
}
```

Bei einem bereits laufenden Backend:

```text
Es muss App-Name, Protokollversion und API-Version prüfen.
```

Nicht nur HTTP 200.

---

# 12. API-Schema validieren

## Shared Schema

Erstelle:

```text
packages/shared/src/boot/bootReadinessSchema.ts
```

Mit Zod oder vorhandener Validierungsbibliothek:

```ts
export const BootComponentStateSchema = z.enum([
  "pending",
  "waiting",
  "running",
  "success",
  "warning",
  "failed",
  "skipped"
]);

export const BootReadinessComponentSchema = z.object({
  state: BootComponentStateSchema,
  progress: z.number().optional(),
  total: z.number().optional(),
  message: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      technicalDetail: z.string().optional(),
      exitCode: z.number().nullable().optional(),
      stderrTail: z.string().optional()
    })
    .optional()
});
```

Startup-Schema:

```ts
export const BootStartupResponseSchema = z.object({
  status: z.enum(["starting", "ready", "degraded", "failed"]),
  ready: z.boolean(),
  progress: z.number(),
  instanceId: z.string(),
  components: z.object({
    database: BootReadinessComponentSchema,
    modelRegistry: BootReadinessComponentSchema,
    runtimeManager: BootReadinessComponentSchema,
    residentModel: BootReadinessComponentSchema
  })
});
```

## Probe

Nie blind casten:

```ts
const parsed =
  BootStartupResponseSchema.safeParse(payload);

if (!parsed.success) {
  throw new BootProtocolError(
    "Ungültige Backend-Startup-Antwort",
    parsed.error.message
  );
}
```

---

# 13. Dateisystemprüfung vollständig machen

Die Phase muss exakt diese Prüfungen ausführen:

```text
1. userDataDir existiert oder wird angelegt
2. userDataDir ist beschreibbar
3. logDir existiert oder wird angelegt
4. tempDir existiert oder wird angelegt
5. databaseDir existiert oder wird angelegt
6. konfigurierte Modellpfade existieren
7. konfigurierte Modellpfade sind lesbar
8. Backend-Arbeitsverzeichnis existiert
9. Backend-Executable oder uv/python ist verfügbar
10. Runtime-Executable ist auffindbar
11. mindestens 500 MB freier Speicherplatz im userData-Laufwerk
12. Pfade enthalten keine ungültigen oder nicht normalisierbaren Werte
```

## Ergebnis

```ts
interface FilesystemCheckResult {
  userDataWritable: boolean;
  logDirWritable: boolean;
  databaseDirWritable: boolean;
  modelRoots: Array<{
    path: string;
    exists: boolean;
    readable: boolean;
  }>;
  backendLaunchAvailable: boolean;
  runtimeExecutableAvailable: boolean;
  freeSpaceBytes: number;
}
```

## Verhalten

Fehlender optionaler Modellpfad:

```text
warning
```

Nicht beschreibbares Datenbankverzeichnis:

```text
failed
```

Fehlendes Runtime-Executable:

```text
failed
```

---

# 14. Modellindex robust machen

## Backend-Regeln

Der Modellindex muss:

```text
1. inkrementell arbeiten
2. Cache verwenden
3. beschädigte Einzeldateien isolieren
4. Fortschritt regelmäßig melden
5. Dateizahl und gültige Modellzahl getrennt melden
6. niemals den Health-Endpunkt blockieren
7. bei Abbruch sauber stoppen
```

## Komponentendaten

```json
{
  "state": "running",
  "progress": 438,
  "total": 2098,
  "message": "438 von 2098 Dateien geprüft",
  "data": {
    "scannedFileCount": 438,
    "candidateCount": 32,
    "validModelCount": 29,
    "invalidModelCount": 3,
    "cachedModelCount": 25
  }
}
```

## Fehler pro Modell

```json
{
  "path": "D:\\Models\\broken.gguf",
  "code": "invalid-gguf-header",
  "message": "Ungültiger GGUF-Header"
}
```

Ein beschädigtes Modell darf nicht den gesamten Start abbrechen.

Nur wenn der komplette Modellindex nicht initialisierbar ist:

```text
failed
```

---

# 15. Residentes Modell korrekt modellieren

## Backend-Antwort

```json
{
  "state": "success",
  "progress": 100,
  "message": "Phi-3 Mini bereit",
  "data": {
    "modelId": "model-123",
    "modelName": "Phi-3-mini-4k-instruct-q4",
    "slotId": "resident",
    "provider": "llama-cpp",
    "pid": 22740,
    "port": 8081
  }
}
```

## Desktop

```ts
const data =
  ResidentModelDataSchema.parse(component.data);

deps.onResidentModel({
  id: data.modelId,
  name: data.modelName,
  slotId: data.slotId,
  provider: data.provider
});
```

Keine IDs aus Statusnachrichten extrahieren.

---

# 16. Frontend-Phasen deterministisch melden

Frontend-Phasen dürfen nicht verloren gehen, wenn die Meldung vor Registrierung des Desktop-Listeners erfolgt.

## Preload-API

```ts
reportBootPhaseState({
  phaseId,
  state,
  message,
  progress,
  metadata
});
```

## Desktop

Speichere den letzten Frontend-Status pro Phase:

```ts
const frontendPhaseStates =
  new Map<string, FrontendPhaseReport>();
```

`waitForFrontendPhase()` prüft zuerst:

```ts
const existing = frontendPhaseStates.get(phaseId);

if (existing?.state === "success") {
  return existing;
}
```

Erst danach Listener registrieren.

## Frontend-Reihenfolge

Exakt:

```text
frontend-bridge
frontend-config-sync
workspace-restore
agents-roles-models
main-window-rendered
```

Jede Meldung genau einmal terminal.

---

# 17. Hauptfensterfreigabe korrekt machen

## Fensterzustand

Beim Erstellen:

```ts
show: false
```

## Release-Reihenfolge

```ts
await waitForPhaseSuccess(
  "main-window-rendered"
);

mainWindow.show();

await waitForBrowserWindowShown(
  mainWindow
);

await waitForRendererPaintAck();

splashWindow.close();
```

## Renderer Paint Ack

Im Renderer:

```ts
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    window.dbzs.reportBootPhaseState({
      phaseId: "main-window-rendered",
      state: "success",
      message: "Hauptfenster vollständig gerendert."
    });
  });
});
```

## Verbindliche Regel

```text
Der Splashscreen wird niemals vor dem ersten bestätigten Rendering des Hauptfensters geschlossen.
```

---

# 18. Logging begrenzen und persistieren

## 18.1 In-Memory-Limit

```ts
const MAX_PHASE_LOG_ENTRIES = 500;
const MAX_GLOBAL_LOG_ENTRIES = 5_000;
```

Bei Überschreitung:

```ts
phase.details.splice(
  0,
  phase.details.length -
    MAX_PHASE_LOG_ENTRIES
);
```

## 18.2 Persistenz

Datei:

```text
<userData>/logs/boot/<runId>.jsonl
```

Jede Zeile:

```json
{
  "timestamp": 1784982631000,
  "level": "info",
  "source": "backend",
  "phaseId": "model-index",
  "event": "model.index.progress",
  "message": "438 von 2098 Dateien geprüft",
  "data": {}
}
```

## 18.3 Secret-Redaction

Vor Speicherung und Export entfernen:

```text
API_KEY
TOKEN
SECRET
PASSWORD
AUTHORIZATION
COOKIE
PRIVATE_KEY
BEARER
```

Regex-Redaction für:

```text
sk-...
ghp_...
github_pat_...
Bearer ...
```

---

# 19. Splashscreen-Zustände exakt definieren

## LED-Mapping

```ts
const LED_STATE_MAP = {
  pending: "gray",
  waiting: "gray-pulse",
  running: "cyan-pulse",
  retrying: "orange-pulse",
  success: "green",
  warning: "yellow",
  failed: "red",
  blocked: "red-muted",
  skipped: "gray-check"
};
```

## Zeile

Jede Phase zeigt:

```text
LED
Phasenname
Statusnachricht
Fortschritt
Dauer
Polls
Retries
```

## Gesamtfortschritt

Nicht einfacher Durchschnitt.

Gewichtete Phasen:

```ts
const PHASE_WEIGHTS = {
  "desktop-process": 1,
  "local-config": 2,
  "filesystem-check": 4,
  "backend-spawn": 5,
  "backend-live": 5,
  "backend-startup-api": 3,
  "database-init": 7,
  "model-index": 20,
  "runtime-manager-init": 10,
  "resident-model": 20,
  "backend-ready": 5,
  "frontend-bridge": 4,
  "frontend-config-sync": 3,
  "workspace-restore": 5,
  "agents-roles-models": 3,
  "main-window-rendered": 2,
  "main-app-released": 1
};
```

Gesamtfortschritt:

```ts
sum(
  phase.progress *
  phaseWeight
) / sum(allWeights);
```

---

# 20. Fehleraktionen exakt implementieren

Bei Fehler bleibt Splash offen.

## Buttons

### Diese Phase erneut versuchen

```text
Nur fehlgeschlagene Phase und blockierte abhängige Phasen zurücksetzen.
Erfolgreiche Vorgängerphasen bleiben erhalten.
```

### Backend neu starten

```text
1. Nur eigenes Backend beenden
2. Backendbezogene Phasen zurücksetzen
3. frontendbezogene abhängige Phasen zurücksetzen
4. Boot ab backend-spawn erneut ausführen
```

Zurückzusetzen:

```text
backend-spawn
backend-live
backend-startup-api
database-init
model-index
runtime-manager-init
resident-model
backend-ready
frontend-bridge
frontend-config-sync
workspace-restore
agents-roles-models
main-window-rendered
main-app-released
```

### Sicherer Modus

Safe Mode bedeutet exakt:

```text
Backend startet
Datenbank startet
Modellindex verwendet nur Cache
Kein residentes Modell
Keine automatische Workspace-Wiederherstellung
Keine Agent-Autostarts
Hauptfenster öffnet im Diagnosemodus
```

### App beenden

```text
1. Boot abbrechen
2. AbortController auslösen
3. Timer beenden
4. Listener entfernen
5. eigenes Backend stoppen
6. Logs flushen
7. Fenster schließen
8. Electron beenden
```

---

# 21. Tests zwingend ergänzen

## Unit-Tests Boot-Orchestrator

Datei:

```text
apps/desktop/electron/boot/bootOrchestrator.test.ts
```

Mindestens:

```text
1. exakt eine Phase gleichzeitig aktiv
2. Phasen laufen in definierter Reihenfolge
3. pending erzeugt waiting, nicht retrying
4. pending erhöht pollCount
5. failed erhöht retryCount
6. success beendet Phase
7. warning beendet Phase
8. skipped beendet Phase
9. Hard-Timeout erzeugt failed
10. Soft-Timeout erzeugt Warnlog
11. blockierte Phasen starten nicht
12. Retry setzt nur abhängige Phasen zurück
13. Fortschritt wird auf 0-100 begrenzt
14. NaN-Fortschritt wird ignoriert
15. doppelter run-Aufruf wird verhindert
16. Abort beendet laufende Phase
17. spätes Runner-Ergebnis nach Abort verändert State nicht
```

## Graph-Tests

```text
1. doppelte ID
2. fehlende Dependency
3. fehlender Runner
4. zusätzlicher Runner
5. direkter Zyklus
6. indirekter Zyklus
7. unerreichbare Phase
8. ungültiges Timeout
9. mehrere Release-Phasen
```

## Backend-Tests

```text
1. /health/live antwortet ohne DB-Zugriff
2. /health/startup liefert Komponenten
3. /health/ready liefert 503 während Startup
4. /health/ready liefert 200 bei vollständiger Readiness
5. residentModel warning blockiert ready nicht, sofern so spezifiziert
6. fehlerhafter Modellscan isoliert Einzelmodell
7. Modellindex meldet Fortschritt
8. Runtime-Fehler enthält Exit-Code und stderr
9. Boot-Nonce wird korrekt zurückgegeben
```

## Electron-Integrationstests

```text
1. Splash erscheint zuerst
2. Main Window bleibt hidden
3. Backend startet
4. Phasen werden nacheinander angezeigt
5. Main Window wird erst nach Render-Ack angezeigt
6. Splash schließt danach
7. Backend-Fehler hält Splash offen
8. Retry funktioniert
9. Safe Mode funktioniert
10. bereits laufendes Backend wird nicht beendet
```

---

# 22. Build- und Abnahmereihenfolge

Nach jeder Reparaturgruppe:

```bash
npm run typecheck
npm run test
```

Nach Backend-Änderungen:

```bash
cd backend
uv run pytest
cd ..
```

Nach Abschluss:

```bash
npm run typecheck
npm run test
npm run build
```

Dann Desktop-End-to-End-Test:

```bash
npm run dev
```

---

# 23. Manuelle Abnahmematrix

## Test A: Normaler Start

Erwartung:

```text
Alle Phasen laufen der Reihe nach.
Maximal eine Phase ist running.
Alle Pflichtphasen werden grün.
Splash schließt erst nach Main-Render.
```

## Test B: Langsamer Backend-Start

Backend künstlich 20 Sekunden verzögern.

Erwartung:

```text
backend-live bleibt waiting.
Keine Folgephase startet.
Kein retryCount-Anstieg.
Soft-Timeout-Warnung erscheint.
Nach erfolgreichem Start läuft Boot weiter.
```

## Test C: Datenbankfehler

Erwartung:

```text
database-init = failed
Folgephasen = blocked
Splash bleibt offen
Fehlerdetails sichtbar
```

## Test D: Beschädigte GGUF-Datei

Erwartung:

```text
Modellindex läuft weiter
invalidModelCount steigt
Boot endet mit success oder warning
Kein kompletter Startabbruch
```

## Test E: Residentes Modell startet nicht

Primärmodell scheitert, Fallback funktioniert.

Erwartung:

```text
resident-model = warning
Fallback-Modell wird angezeigt
Boot läuft weiter
```

Primärmodell und Fallback scheitern:

```text
resident-model = failed
Splash bleibt offen
```

## Test F: Frontend rendert nicht

Erwartung:

```text
main-window-rendered = failed oder timeout
Hauptfenster wird nicht angezeigt
Splash bleibt offen
```

## Test G: Externes Backend

Erwartung:

```text
Backend wird erkannt
nicht doppelt gestartet
ownership = preexisting-local
bei App-Ende nicht beendet
```

---

# 24. Abschlussdokumentation

Erstelle:

```text
docs/repair/BOOT_REPAIR_REPORT.md
```

Inhalt exakt:

```md
# Boot Repair Report

## Ausgangsproblem

## Root Causes

## Geänderte Architektur

## Neue Boot-Reihenfolge

## Zustandsmodell

## Polling-Verhalten

## Retry-Verhalten

## Timeout-Verhalten

## Backend-Endpunkte

## Prozess-Ownership

## Window Release Flow

## Logging

## Safe Mode

## Geänderte Dateien

## Neue Dateien

## Entfernte Logik

## Tests

## Build-Ergebnisse

## Manuelle Testmatrix

## Bekannte Restprobleme

## Produktionsfreigabe

- [ ] Typecheck erfolgreich
- [ ] Desktop-Tests erfolgreich
- [ ] Backend-Tests erfolgreich
- [ ] Desktop-Build erfolgreich
- [ ] Normalstart erfolgreich
- [ ] Fehlerstart erfolgreich geprüft
- [ ] Retry erfolgreich geprüft
- [ ] Safe Mode erfolgreich geprüft
- [ ] Keine parallelen Bootphasen
- [ ] Splash schließt erst nach Render-Ack
```

---

# 25. Definition of Done

Der Repair ist ausschließlich dann abgeschlossen, wenn alle folgenden Aussagen wahr sind:

```text
[ ] Der Boot-Graph ist validiert und zyklenfrei.
[ ] Es läuft maximal eine Bootphase gleichzeitig.
[ ] pending und failed sind technisch getrennt.
[ ] pollCount und retryCount sind getrennt.
[ ] /health/live prüft nur Liveness.
[ ] /health/startup liefert Komponentenstatus.
[ ] /health/ready wird erst nach Pflichtkomponenten true.
[ ] Es existiert keine Readiness-Zirkularität.
[ ] Das residente Modell erreicht einen terminalen Zustand.
[ ] Modell-ID wird strukturiert übertragen.
[ ] Externes Backend wird korrekt erkannt.
[ ] Nur eigenes Backend wird beendet.
[ ] Backend-Instanz wird per Nonce oder Instanz-ID verifiziert.
[ ] Fortschritt ist immer zwischen 0 und 100.
[ ] Logs sind speicherbegrenzt.
[ ] Vollständige Logs werden persistiert.
[ ] Secrets werden aus Logs entfernt.
[ ] Splash bleibt bei Fehler sichtbar.
[ ] Hauptfenster bleibt während Boot hidden.
[ ] Hauptfenster wird erst nach Render-Ack gezeigt.
[ ] Splash wird danach geschlossen.
[ ] Alle Unit-Tests laufen.
[ ] Alle Backend-Tests laufen.
[ ] Der Desktop-Build läuft.
[ ] Die manuelle Abnahmematrix wurde vollständig bestanden.
```

## Verbotene Abkürzungen

```text
Kein Status darf aufgrund eines HTTP-200 allein grün werden.

Kein laufender Task darf als Fehler behandelt werden.

Kein Retry darf als Polling missbraucht werden.

Kein Timeout darf einfach nur erhöht werden, um einen Logikfehler zu verdecken.

Keine Phase darf parallel starten.

Kein Main Window darf vor dem Render-Ack sichtbar werden.

Kein Splash darf vor vollständigem terminalem Bootstatus geschlossen werden.
```
