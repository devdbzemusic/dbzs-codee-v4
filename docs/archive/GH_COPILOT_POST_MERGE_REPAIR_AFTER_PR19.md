# GH COPILOT IMPLEMENTIERUNGSAUFTRAG
# Division By Zeros (DBZS) Codee
## Post-Merge Repair nach PR #19

## 0. Ausgangslage

PR #19 wurde bereits in `main` gemergt.

Aktueller Merge-Commit:

```text
734c246792d0989305d7c6b938f9652418eff661
```

Der Merge enthält wichtige Verbesserungen:

```text
- Brokerentscheidung im Runtime Chat Store
- alter modelRouterService aus dem Versandpfad entfernt
- model_id und slot_id im normalen Request
- Discovery-Service hinzugefügt
- Backend prüft Modell gegen Zielslot
- RoutingDiagnosticsCard eingebunden
```

Der Stand ist trotzdem nicht produktionsfähig.

Aktuell bestehen mindestens diese harten Fehler:

```text
1. TypeScript-Fehler durch sendOptions.taskType
2. requestAssistantResponse verwendet alte AgentRunService-Signaturen
3. Slotvalidierung schlägt immer fehl, weil chat_ready nie gesetzt wird
4. AbortSignal wird von der Preload-Bridge ignoriert
5. Non-Streaming-Chat besitzt keinen sicheren Timeout
6. Diagnosekarte zeigt teilweise erfundene oder globale Werte
7. Project Local Strict ist noch nicht vollständig strikt
8. Runtime Tool Registry sucht nicht ausschließlich projektlokal
```

Dieser Auftrag repariert ausschließlich diese Fehler.

Kein Feature-Ausbau.

Nicht bearbeiten:

```text
Icons
Packaging
weitere Agenten
Cloudprovider
neue Modelle
Embedding
Reranker
Quantisierung
neue UI-Themes
```

---

# 1. P0 – TypeScript-Build reparieren

## 1.1 `taskType`-Fehler beheben

Datei:

```text
apps/desktop/src/stores/runtimeChatStore.ts
```

Aktuell:

```typescript
selectTimeoutProfile(
  sendOptions?.taskType ?? undefined,
  ...
)
```

`RuntimeChatSendOptions` besitzt kein `taskType`.

## Verbindliche Lösung

Der Task Type wird ohnehin später durch `classifyTaskType()` erzeugt.

Berechne ihn einmal frühzeitig und verwende ihn durchgehend:

```typescript
const taskType = classifyTaskType(
  trimmedContent,
  effectiveAgent !== "runtime_chat",
  Boolean(activeFile?.content)
);

const timeoutManager = new TimeoutManager(
  selectTimeoutProfile(
    taskType,
    (buildFileContext(activeFile)?.content?.length ?? 0)
      + (workspaceContext?.rootPath?.length ?? 0)
  )
);
```

Später beim Broker denselben `taskType` wiederverwenden.

Nicht erneut klassifizieren.

---

## 1.2 `requestAssistantResponse()` auf neue Signaturen umstellen

Aktuell besitzt `AgentRunService`:

```typescript
sendChat(
  request: RuntimeChatRequest,
  signal?: AbortSignal
)

sendChatStream(
  request: RuntimeChatRequest,
  callbacks: RuntimeChatStreamCallbacks,
  signal?: AbortSignal
)
```

Der Store verwendet weiterhin die alte Form:

```typescript
sendChatStream(
  targetAgent,
  request,
  callbacks,
  signal
)

sendChat(
  targetAgent,
  request
)
```

## Zwingende Korrektur

```typescript
async function requestAssistantResponse(
  request: Parameters<typeof agentRunService.sendChatStream>[0],
  onDelta: (delta: string, totalLength: number) => void,
  signal?: AbortSignal
) {
```

Streaming:

```typescript
const streamed = await agentRunService.sendChatStream(
  request,
  { onDelta },
  signal
);
```

Non-Streaming-Fallback:

```typescript
const fallback = await agentRunService.sendChat(
  request,
  signal
);
```

`targetAgent` aus dieser Funktion entfernen.

Alle Aufrufer entsprechend aktualisieren.

---

## 1.3 Legacy-Imports entfernen

Datei:

```text
apps/desktop/src/services/agentRunService.ts
```

Nach der Vereinfachung werden wahrscheinlich nicht mehr benötigt:

```typescript
modelRegistryService
streamOllamaChat
useSettingsStore
useRuntimeStore
normalizeBaseUrl
```

Entferne nur tatsächlich unbenutzte Imports und Funktionen.

Kein `any`, kein `@ts-ignore`, kein Umgehen des Typechecks.

---

# 2. P0 – `chat_ready` im Backend wirklich setzen

Das Schema enthält bereits:

```python
chat_ready: bool = False
```

Der API-Endpunkt übergibt aber keinen Wert.

Dadurch bleibt `chat_ready` immer `False`.

Der Frontend-Validator blockiert deshalb jeden Chat.

## Zentrale Readiness-Funktion

Datei:

```text
backend/app/runtime/service.py
```

Erstelle:

```python
def is_slot_chat_ready(self, slot_id: str) -> bool:
    status = self.status_for_slot(slot_id)

    if status.state != "running":
        return False

    if not status.endpoint:
        return False

    return self._endpoint_checker(status.endpoint)
```

## API-Endpunkte aktualisieren

Datei:

```text
backend/app/api/runtime.py
```

Bei jedem `RuntimeSlotStatus`:

```python
chat_ready=service.is_slot_chat_ready(slot_id)
```

Das gilt sowohl für:

```text
GET /runtime/slots
GET /runtime/slots/{slot_id}/status
```

## Tests

```python
def test_running_slot_with_reachable_endpoint_is_chat_ready():
    ...

def test_running_slot_without_endpoint_is_not_chat_ready():
    ...

def test_stopped_slot_is_not_chat_ready():
    ...
```

---

# 3. P0 – Slotvalidierung an den Run-Abort koppeln

Aktuell erzeugt `runtimeSlotValidator.ts` einen eigenen AbortController.

Damit reagiert die Slotprüfung nicht sauber auf den Run-Abort.

## Neue Signatur

```typescript
export async function getRuntimeSlotStatus(
  backendUrl: string,
  slotId: RuntimeSlotId,
  timeoutMs: number = 5000,
  externalSignal?: AbortSignal
): Promise<RuntimeSlotStatus | null>
```

Kombiniere Timeout und externes Signal sauber.

Dann:

```typescript
verifySlotForRequest(
  backendUrl,
  slotId,
  expectedModelId,
  timeoutMs,
  externalSignal
)
```

Im Store:

```typescript
const validation = await verifySlotForRequest(
  backendUrl,
  routing.slotId,
  routing.modelId,
  timeoutManager.getRouting(),
  runAbortController.signal
);
```

Kein `as any`.

---

# 4. P0 – Abort über Electron korrekt lösen

Ein `AbortSignal` kann nicht sinnvoll über `ipcRenderer.invoke()` serialisiert werden.

Die aktuelle Preload-Signatur akzeptiert formal ein Signal, ignoriert es aber.

## Verbindliche Architektur

### Streaming

```text
Renderer AbortController.abort()
→ explizit cancelRuntimeChatStream()
→ Electron abortet aktiven Fetch
```

### Non-Streaming

```text
Request-ID
→ separater Cancel-Kanal
→ Electron AbortController je Request
```

## 4.1 Streaming-Abbruch

Datei:

```text
apps/desktop/src/services/backendClient.ts
```

Bei `streamRuntimeChat()`:

```typescript
if (signal) {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new Error("Aborted")
    );
  }

  const onAbort = () => {
    void bridge().cancelRuntimeChatStream?.();
  };

  signal.addEventListener(
    "abort",
    onAbort,
    { once: true }
  );

  return method(request, onChunk)
    .finally(() => {
      signal.removeEventListener(
        "abort",
        onAbort
      );
    });
}
```

Die Preload-Bridge muss kein Signal an IPC weiterreichen.

Sie muss nur weiterhin bereitstellen:

```typescript
streamRuntimeChat(request, onChunk)
cancelRuntimeChatStream()
```

---

## 4.2 Non-Streaming-Chat abbrechbar machen

Neue Request-ID:

```typescript
const requestId = crypto.randomUUID();
```

Renderer/Preload:

```typescript
sendRuntimeChat(
  requestId: string,
  request: RuntimeChatRequest
)

cancelRuntimeChat(
  requestId: string
)
```

Electron:

```typescript
const nonStreamChatControllers =
  new Map<string, AbortController>();
```

Beim Start:

```typescript
const controller = new AbortController();
nonStreamChatControllers.set(
  requestId,
  controller
);
```

Beim Cancel:

```typescript
controller.abort();
nonStreamChatControllers.delete(
  requestId
);
```

Im `finally` ebenfalls löschen.

---

# 5. P0 – Non-Streaming-Timeout absichern

Aktuell liefert Electron für alle `/runtime/chat`-Pfade:

```typescript
return 0;
```

Damit besitzt auch Non-Streaming keinen Timeout.

## Neue Unterscheidung

```typescript
function getEndpointTimeout(
  pathname: string,
  hasExternalSignal: boolean
): number {
  if (pathname.includes(
    "/runtime/chat/stream"
  )) {
    return 0;
  }

  if (pathname === "/runtime/chat") {
    return hasExternalSignal
      ? 0
      : 5 * 60 * 1000;
  }

  ...
}
```

## Vorgabe

```text
Streaming:
- expliziter Cancel-Kanal
- First-Token-Timeout
- Gesamt-Timeout

Non-Streaming:
- eigener AbortController
- maximal 5 Minuten
- expliziter Cancel-Kanal
```

Keine unendlichen IPC-Promises.

---

# 6. P0 – Externe Signale nicht überschreiben

Aktuell:

```typescript
if (endpointTimeout > 0) {
  fetchInit.signal =
    AbortSignal.timeout(endpointTimeout);
}
```

Damit wird ein externes Signal überschrieben.

## Korrektur

```typescript
const timeoutSignal =
  endpointTimeout > 0
    ? AbortSignal.timeout(endpointTimeout)
    : undefined;

if (init?.signal && timeoutSignal) {
  fetchInit.signal = AbortSignal.any([
    init.signal,
    timeoutSignal
  ]);
} else {
  fetchInit.signal =
    init?.signal ?? timeoutSignal;
}
```

Fallback für Laufzeiten ohne `AbortSignal.any` implementieren.

---

# 7. P1 – Brokerentscheidung vollständig transportieren

Der Request überträgt aktuell:

```text
model_id
slot_id
```

Es fehlt:

```text
fallback_policy
```

## Request

```typescript
{
  messages,
  file_context,
  temperature,
  max_tokens,
  model_id: decision.modelId,
  slot_id: decision.slotId,
  fallback_policy:
    decision.fallbackPolicy
}
```

## Store

Speichere die vollständige Entscheidung:

```typescript
lastBrokerDecision:
  ModelSelectionDecision | null;
```

Damit stehen für Diagnose und Agentenloop echte Werte bereit:

```text
taskType
targetAgent
slotId
modelId
modelName
providerId
reason
fallbackPolicy
decidedAt
```

---

# 8. P1 – Diagnosekarte mit echten Daten versorgen

Aktuell zeigt die UI Platzhalter:

```text
taskType: unknown
memoryAvailable: true
memoryMessage: Available
slotReady: globaler Runtime-Status
```

## Neuer Store-State

```typescript
routingDiagnostics:
  RoutingDiagnostics | null;
```

Nach Brokerentscheidung:

```typescript
set({
  routingDiagnostics: {
    decision: {
      decidedAt:
        decision.decidedAt.toISOString(),
      taskType: decision.taskType,
      targetAgent:
        decision.targetAgent,
      slotId: decision.slotId,
      modelId: decision.modelId,
      modelName: decision.modelName,
      reason:
        decision.reason.join("; ")
    },
    validation: null,
    errorClassification: undefined
  }
});
```

Nach Slotvalidierung reale Daten übernehmen.

Bei Fehler die echte Fehlerklasse übernehmen.

`RuntimeChatTab.tsx` soll ausschließlich diesen realen Store-State rendern.

Keine hardcodierten Werte.

---

# 9. P1 – Strict Model Index vollständig machen

## 9.1 Katalog-ID darf im Strict Mode nicht gewinnen

Aktuell:

```python
model_id = (
    entry["id"]
    if entry.get("id")
    else relative_id
)
```

## Korrektur

```python
if (
    self.discovery_mode
    == "project_local_strict"
):
    model_id = relative_id
else:
    model_id = (
        str(entry.get("id"))
        if entry.get("id")
        else relative_id
        or _stable_id(raw_path)
    )
```

Im Strict Mode ist `relative_id` verpflichtend.

---

## 9.2 Models Root verbindlich aus Repository ableiten

Der Strict Mode darf nicht durch Umgebungsvariablen oder Settings umgelenkt werden.

```python
def get_project_models_dir() -> Path:
    return (
        Path(__file__).resolve()
        .parents[3]
        / "models"
    )
```

Im Constructor:

```python
if (
    discovery_mode
    == "project_local_strict"
):
    self.models_dir = (
        get_project_models_dir()
        .resolve()
    )
else:
    self.models_dir = (
        models_dir
        or get_models_dir()
    ).resolve()
```

Keine externen Modellpfade im Strict Mode.

---

# 10. P1 – Tool Registry projektlokal machen

Aktuell:

```python
RuntimeToolRegistry()
```

ohne Suchpfad.

## Korrektur

```python
runtime_dir = (
    self.models_dir
    / "llama.cpp-win-runtime"
)

self.tool_registry = RuntimeToolRegistry(
    search_paths=[runtime_dir],
    allow_system_path=False,
)
```

## Registry erweitern

```python
class RuntimeToolRegistry:
    def __init__(
        self,
        search_paths:
            list[Path] | None = None,
        allow_system_path:
            bool = True,
    ):
```

Im Strict Mode:

```text
PATH-Suche deaktiviert
nur Projekt-Runtime
keine D:\win_runtimes-Fallbacks
```

---

# 11. Agentenloop ebenfalls verbindlich routen

Prüfe den Pfad:

```text
runAgentChatTurnLoop
→ requestAssistant
```

Der Agentenloop muss dieselbe Brokerentscheidung verwenden.

Der Request muss auch dort enthalten:

```text
model_id
slot_id
fallback_policy
```

Keine neue Modellwahl im Turn-Loop.

Keine Legacy-Routingentscheidung.

---

# 12. Pflichtprüfungen

## Typecheck

```powershell
pnpm typecheck
```

Muss insbesondere bestätigen:

```text
kein taskType-Fehler
keine falsche sendChatStream-Signatur
keine falsche sendChat-Signatur
kein Parameters<[1]>-Fehler
```

## Desktoptests

```powershell
pnpm --filter @dbzs/desktop test
```

## Backend Import

```powershell
cd backend
python -c "from app.models.index_service import ModelIndexService; print('OK')"
```

## Backendtests

```powershell
cd backend
uv run pytest -q
```

## Build

```powershell
pnpm build
```

---

# 13. Neue Pflicht-Tests

## TypeScript

```text
requestAssistantResponse nutzt neue Signaturen
Abort ruft cancelRuntimeChatStream auf
Non-Streaming-Abort ist request-spezifisch
Brokerentscheidung wird wiederverwendet
fallback_policy wird übertragen
Diagnose nutzt echte Entscheidung
```

## Python

```text
chat_ready true für erreichbaren laufenden Slot
chat_ready false für gestoppten Slot
chat_ready false ohne Endpoint
Strict Mode erzwingt Repository-Root
Katalog-ID wird im Strict Mode ignoriert
Tool Registry ignoriert globalen PATH
```

---

# 14. Manuelle Tests

## Test A

```text
Hallo
```

Erwartung:

```text
fast_gpu
Slot validiert
Antwort
```

## Test B

```text
Kannst du mir ausführlich erklären,
wie der aktuelle Model Index arbeitet?
```

Erwartung:

```text
normal_chat
kein Agentenloop
Antwort
```

## Test C

```text
Prüfe runtimeChatStore.ts
auf die Ursache des Timeouts.
```

Erwartung:

```text
review oder debugging
quality_cpu
Modell stimmt mit Slot überein
```

## Test D

Falsches Modell im Slot:

```text
selected_model_not_running_in_slot
```

## Test E

First-Token-Timeout:

```text
Renderer abortet
cancelRuntimeChatStream wird aufgerufen
Electron-Fetch endet
nächste Anfrage funktioniert
```

## Test F

Non-Streaming-Hänger:

```text
spätestens nach Timeout beendet
kein ewiges IPC-Promise
```

## Test G

Strict Mode:

```text
nur Repository-Models-Root
relative IDs
keine externen Katalogmodelle
```

## Test H

Tool Registry:

```text
nur:
<repo>\models\llama.cpp-win-runtime
```

## Test I

Diagnose:

```text
echter Task Type
echter Slot
echtes Modell
echtes Validation-Ergebnis
echte Fehlerklasse
```

---

# 15. Definition of Done

- [ ] `pnpm typecheck` grün
- [ ] neue AgentRunService-Signaturen überall korrekt verwendet
- [ ] `chat_ready` wird real berechnet
- [ ] gesunder Slot passiert die Validierung
- [ ] falsches Modell wird blockiert
- [ ] Streaming-Abort beendet Electron-Fetch
- [ ] Non-Streaming-Abort funktioniert
- [ ] Non-Streaming besitzt sicheren Timeout
- [ ] externe Signale werden nicht überschrieben
- [ ] `fallback_policy` wird transportiert
- [ ] Agentenloop verwendet dieselbe Brokerentscheidung
- [ ] Diagnosekarte zeigt reale Daten
- [ ] Strict Mode erzwingt Repository-Root
- [ ] Katalog-IDs werden im Strict Mode ignoriert
- [ ] Tool Registry sucht nur projektlokal
- [ ] Desktoptests grün
- [ ] Backendtests grün
- [ ] Build grün
- [ ] manuelle Tests A–I dokumentiert
- [ ] keine ungeprüfte Production-Ready-Aussage

---

# 16. Commit-Reihenfolge

```text
fix(chat): align runtime chat store with agent service signatures
fix(runtime): calculate real slot chat readiness
fix(chat): cancel electron stream on renderer abort
fix(chat): add cancellable bounded non-stream requests
fix(electron): preserve and combine external abort signals
fix(routing): transport complete broker decision
fix(agent): bind agent loop to broker-selected model and slot
fix(diagnostics): render real routing and validation state
fix(models): enforce repository-local strict root and relative ids
fix(runtime): restrict llama tool registry to project runtime
test(spine): cover compile readiness abort strict mode and diagnostics
docs(repair): record verified test results only
```

---

# 17. Abschlussbericht

Liefere:

```text
1. geänderte Dateien
2. behobene TypeScript-Buildfehler
3. finaler Brokerpfad
4. chat_ready-Berechnung
5. Slotvalidierung
6. Streaming-Abort
7. Non-Streaming-Abort
8. Timeoutverhalten
9. Strict-Mode-Verhalten
10. Tool-Registry-Pfad
11. Diagnosewerte
12. Typecheck-Ergebnis
13. Desktoptest-Ergebnis
14. Backendtest-Ergebnis
15. Build-Ergebnis
16. Tests A-I jeweils PASS / FAIL / NOT RUN
17. verbleibende Risiken
18. ehrliche Release-Empfehlung
```

Bis alle Gates bestanden sind:

```text
STATUS:
POST-MERGE REPAIR REQUIRED
NOT PRODUCTION READY
```
