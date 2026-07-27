# GH COPILOT IMPLEMENTIERUNGSAUFTRAG
# Division By Zeros (DBZS) Codee
## PR #19 – Blocker Repair Before Merge

## 0. Ausgangslage

Der offene PR:

```text
#19
fix(routing): integrate Model Selection Broker + Phase 3 manual tests complete
```

darf im aktuellen Zustand nicht gemergt werden.

Der PR enthält weiterhin mehrere harte Blocker:

```text
1. Backend-Startblocker: fehlende discovery.py
2. Desktop-Buildblocker: makeRoutingDecision existiert nicht
3. Alter modelRouterService entscheidet beim Versand weiterhin neu
4. Slot Validator ist nicht im produktiven Pfad
5. Backend validiert das angeforderte Modell nicht gegen das Slotmodell
6. chat_ready fehlt im Backendcontract
7. AbortSignal erreicht den llama.cpp-Pfad nicht vollständig
8. RoutingDiagnosticsCard ist nicht eingebunden
9. behauptete Tests sind nicht durch CI oder ausführbare Belege gedeckt
```

Dieser Auftrag repariert ausschließlich diese Punkte.

Kein weiterer Feature-Ausbau.

---

# 1. Backend-Startblocker beheben

Datei:

```text
backend/app/models/index_service.py
```

Aktuell wird importiert:

```python
from app.models.discovery import ModelDiscoveryService
```

Die Datei:

```text
backend/app/models/discovery.py
```

existiert nicht.

## Verbindliche Lösung

Erstelle:

```text
backend/app/models/discovery.py
```

mit mindestens:

```python
from __future__ import annotations

from pathlib import Path
from typing import Literal

ModelDiscoveryMode = Literal[
    "project_local_strict",
    "local_with_ollama",
    "cloud_enabled",
]


class ModelDiscoveryService:
    def __init__(
        self,
        mode: ModelDiscoveryMode,
        models_dir: Path,
        ollama_models_dir: Path,
    ) -> None:
        self.mode = mode
        self.models_dir = models_dir.resolve()
        self.ollama_models_dir = ollama_models_dir.resolve()

    def get_project_relative_id(self, raw_path: str) -> str | None:
        if not raw_path:
            return None

        resolved = Path(raw_path).expanduser().resolve()

        try:
            relative = resolved.relative_to(self.models_dir)
        except ValueError:
            return None

        return relative.as_posix().lower()

    def is_project_local(self, raw_path: str) -> bool:
        if not raw_path:
            return False

        resolved = Path(raw_path).expanduser().resolve()

        try:
            resolved.relative_to(self.models_dir)
            return True
        except ValueError:
            return False

    def require_project_local(self, raw_path: str) -> Path:
        resolved = Path(raw_path).expanduser().resolve()

        try:
            resolved.relative_to(self.models_dir)
        except ValueError as exc:
            raise ValueError(
                f"model_outside_project_root: {resolved}"
            ) from exc

        return resolved

    def allows_ollama(self) -> bool:
        return self.mode in {
            "local_with_ollama",
            "cloud_enabled",
        }

    def allows_cloud(self) -> bool:
        return self.mode == "cloud_enabled"
```

Passe die Typimporte so an, dass `ModelDiscoveryMode` nur an einer Stelle definiert wird.

Bevorzugt:

```text
backend/app/settings/models.py
```

als zentrale Definition.

`discovery.py` importiert dann:

```python
from app.settings.models import ModelDiscoveryMode
```

---

# 2. Strict Mode tatsächlich erzwingen

`project_local_strict` darf nicht nur Ollama ausblenden.

Es muss externe Modellpfade ablehnen.

## In `_from_catalog()`

Nach Ermittlung von `raw_path`:

```python
if self.discovery_mode == "project_local_strict":
    resolved_model_path = self.discovery_service.require_project_local(raw_path)
else:
    resolved_model_path = Path(raw_path).expanduser().resolve()
```

Kein externer Pfad darf still akzeptiert werden.

## Relative IDs haben Vorrang

Aktuell hat eine Katalog-ID weiterhin Vorrang.

Im Strict Mode:

```python
if self.discovery_mode == "project_local_strict":
    model_id = self.discovery_service.get_project_relative_id(
        str(resolved_model_path)
    )

    if not model_id:
        raise ValueError(
            f"project_relative_model_id_failed: {resolved_model_path}"
        )
else:
    model_id = str(
        entry.get("id")
        or self.discovery_service.get_project_relative_id(raw_path)
        or _stable_id(raw_path)
    )
```

## Filesystem-Scan korrigieren

Nicht mehr:

```python
model_id = _stable_id(path)
```

Sondern:

```python
relative_path = model_path.resolve().relative_to(
    self.models_dir.resolve()
)

model_id = relative_path.as_posix().lower()
```

---

# 3. Broker-Buildblocker beheben

Datei:

```text
apps/desktop/src/services/agentRunService.ts
```

Aktuell:

```typescript
import { makeRoutingDecision } from "@/services/modelSelectionBroker";
```

Diese Funktion existiert nicht.

`modelSelectionBroker.ts` exportiert:

```typescript
brokerDecision(...)
classifyTaskType(...)
```

## Verbindliche Lösung

Keinen künstlichen Wrapper mit falscher Signatur erzeugen.

Stattdessen muss die Brokerentscheidung dort entstehen, wo Nachricht, Dateikontext und Settings vorhanden sind:

```text
runtimeChatStore.ts
```

Dort:

```typescript
import {
  brokerDecision,
  classifyTaskType
} from "@/services/modelSelectionBroker";
```

Vor Runtimeprüfung und Kontextaufbau:

```typescript
const settings = useSettingsStore.getState().settings;

const taskType = classifyTaskType(
  trimmedContent,
  sendOptions?.agentMode === "agent",
  Boolean(activeFile)
);

const decision = brokerDecision(taskType, {
  defaultModelId: settings.defaultModelId,
  defaultModelName: settings.defaultModelName,
  defaultCoderModelId: settings.defaultCoderModelId,
  defaultDebugModelId: settings.defaultDebugModelId,
  localOnlyModels: settings.localOnlyModels
});
```

Die Entscheidung wird gespeichert:

```typescript
set({
  lastRouting: {
    targetAgent: decision.targetAgent,
    modelId: decision.modelId,
    modelName: decision.modelName,
    providerId: decision.providerId,
    slotId: decision.slotId
  }
});
```

`AgentRunService.resolveRouting()` darf danach keine neue Brokerentscheidung mehr erzeugen.

Entweder entfernen oder nur noch die bereits erzeugte Entscheidung übernehmen.

---

# 4. Alten Router aus dem Versandpfad entfernen

Datei:

```text
apps/desktop/src/services/agentRunService.ts
```

Aktuell verwenden sowohl `sendChat()` als auch `sendChatStream()` weiterhin:

```typescript
modelRouterService.selectModelForAgent(...)
```

Das ist zu entfernen.

## Neue API

```typescript
async sendChat(
  request: RuntimeChatRequest
): Promise<RuntimeChatResponse>
```

und:

```typescript
async sendChatStream(
  request: RuntimeChatRequest,
  callbacks: RuntimeChatStreamCallbacks,
  signal?: AbortSignal
): Promise<RuntimeChatResponse>
```

Die Methoden verwenden ausschließlich:

```typescript
request.model_id
request.slot_id
```

Keine erneute Modellwahl.

## llama.cpp-Pfad

```typescript
return streamRuntimeChat(
  request,
  callbacks,
  signal
);
```

## Non-Streaming-Pfad

```typescript
return backendClient.sendRuntimeChat(
  request,
  signal
);
```

Falls `backendClient.sendRuntimeChat()` noch kein Signal akzeptiert, Signatur erweitern.

---

# 5. Request vollständig binden

Jeder Request muss enthalten:

```typescript
{
  messages,
  file_context,
  temperature,
  max_tokens,
  model_id: decision.modelId,
  slot_id: decision.slotId,
  fallback_policy: decision.fallbackPolicy
}
```

Falls `fallback_policy` im Shared Contract und Backend-Schema fehlt, ergänzen.

## Shared Type

```typescript
export type RuntimeFallbackPolicy =
  | "strict"
  | "allow_local_fallback";

export interface RuntimeChatRequest {
  messages: RuntimeChatMessage[];
  file_context?: RuntimeChatFileContext | null;
  temperature?: number;
  max_tokens?: number;
  tools?: unknown[] | null;
  model_id?: string | null;
  slot_id?: RuntimeSlotId | null;
  fallback_policy?: RuntimeFallbackPolicy;
}
```

## Backend Schema

```python
class RuntimeChatRequest(BaseModel):
    messages: list[RuntimeChatMessage]
    file_context: RuntimeChatFileContext | None = None
    temperature: float = 0.2
    max_tokens: int = 1024
    tools: list[dict] | None = None
    model_id: str | None = None
    slot_id: RuntimeSlotId | None = None
    fallback_policy: Literal[
        "strict",
        "allow_local_fallback",
    ] = "strict"
```

---

# 6. Slot Validator produktiv einbauen

Datei:

```text
apps/desktop/src/services/runtimeSlotValidator.ts
```

Die Funktion:

```typescript
verifySlotForRequest(...)
```

muss im echten Chatpfad vor Kontextaufbau und vor Modellrequest aufgerufen werden.

## Reihenfolge

```text
1. Task klassifizieren
2. Brokerentscheidung erzeugen
3. Zielslot validieren
4. erst danach Kontextaufbau
5. Modellrequest
```

## Beispiel

```typescript
const validation = await withTimeout(
  verifySlotForRequest(
    settings.backendUrl,
    decision.slotId,
    decision.modelId,
    timeoutManager.getRouting()
  ),
  timeoutManager.getRouting(),
  "Zielslot validieren",
  runAbortController.signal
);

if (!validation.ok) {
  throw new Error(
    validation.error
    ?? "target_slot_unavailable"
  );
}
```

Keine globale Prüfung:

```text
irgendeine Runtime läuft
```

als Ersatz für die konkrete Slotprüfung.

---

# 7. `chat_ready` Contract ergänzen

Backend:

```text
backend/app/runtime/schemas.py
```

Ergänzen:

```python
class RuntimeSlotStatus(RuntimeStatus):
    slot_id: RuntimeSlotId
    device_policy: Literal["gpu", "cpu", "auto"] = "auto"
    gpu_layers: int | None = None
    context_size: int | None = None
    chat_ready: bool = False
```

Beim Erzeugen des Status:

```python
chat_ready=(
    status.state == "running"
    and bool(status.endpoint)
    and self._endpoint_available(status.endpoint)
)
```

Der Frontend-Validator darf nicht auf ein Feld prüfen, das das Backend nicht liefert.

---

# 8. Modell-Slot-Konsistenz im Backend erzwingen

Datei:

```text
backend/app/runtime/service.py
```

In `resolve_chat_target()`:

```python
if current.state == "running" and current.endpoint:
    if (
        chat_request.model_id
        and current.model_id != chat_request.model_id
    ):
        raise RuntimeError(
            "selected_model_not_running_in_slot: "
            f"requested={chat_request.model_id}, "
            f"running={current.model_id}, "
            f"slot={slot_id}"
        )

    return RuntimeStreamContext(
        slot_id=slot_id,
        model_id=current.model_id,
        model_name=current.model_name,
        endpoint=current.endpoint,
    )
```

Kein stilles Ausführen mit einem anderen Modell.

---

# 9. AbortSignal vollständig durchreichen

Aktuell erreicht das Signal den llama.cpp-Pfad nicht vollständig.

## `runtimeChatStreamClient.ts`

```typescript
export async function streamRuntimeChat(
  request: RuntimeChatRequest,
  callbacks: RuntimeChatStreamCallbacks,
  signal?: AbortSignal
): Promise<RuntimeChatResponse> {
  return backendClient.streamRuntimeChat(
    request,
    payload => {
      callbacks.onDelta(
        payload.delta,
        payload.totalLength
      );
    },
    signal
  );
}
```

## `AgentRunService`

```typescript
return streamRuntimeChat(
  request,
  callbacks,
  signal
);
```

## Non-Streaming

`sendRuntimeChat()` ebenfalls um `signal?: AbortSignal` erweitern.

Keine Chat-Fetches ohne kontrollierbaren Timeout oder Abort.

---

# 10. Non-Streaming-Chat darf nicht unendlich hängen

Aktuell wird für:

```text
/runtime/chat
```

der Electron-Timeout vollständig deaktiviert.

Der Non-Streaming-Pfad besitzt aber nicht zuverlässig ein externes Signal.

## Neue Regel

Streaming:

```text
externes AbortSignal
kein zusätzlicher Electron-Timer
```

Non-Streaming:

```text
explizites AbortSignal
oder eigener Chat-Timeout
```

Beispiel:

```typescript
function getEndpointTimeout(
  pathname: string,
  hasExternalSignal: boolean
): number {
  if (pathname.includes("/runtime/chat")) {
    return hasExternalSignal
      ? 0
      : 5 * 60 * 1000;
  }

  ...
}
```

Externe Signale dürfen nicht überschrieben werden.

---

# 11. Diagnose-UI wirklich einbinden

`RoutingDiagnosticsCard.tsx` existiert, wird aber nicht gerendert.

In:

```text
apps/desktop/src/components/RuntimeChatTab.tsx
```

importieren:

```typescript
import {
  RoutingDiagnosticsCard
} from "@/components/RoutingDiagnosticsCard";
```

Im Diagnosebereich:

```tsx
{routingDiagnostics ? (
  <RoutingDiagnosticsCard
    diagnostics={routingDiagnostics}
  />
) : null}
```

Dazu im Store echten State ergänzen:

```typescript
routingDiagnostics: RoutingDiagnostics | null;
```

Befüllen aus:

```text
Brokerentscheidung
Slotvalidierung
aktiver Timeoutstage
Fehlerklassifikation
Retry-Zähler
```

Keine Mockdaten.

---

# 12. Falsche Testbehauptungen korrigieren

Der PR behauptet aktuell:

```text
7/7 PASS
Production Ready
```

obwohl:

```text
discovery.py fehlt
makeRoutingDecision existiert nicht
kein CI-Status vorhanden
```

Diese Aussagen entfernen.

## Erlaubter Status vor echter Ausführung

```text
Unit Tests: NOT RUN
Integration Tests: NOT RUN
Manual Tests A-G: NOT RUN
Production Ready: NO
```

Erst nach tatsächlicher Ausführung aktualisieren.

---

# 13. Pflichtprüfungen

## Backend Import

```powershell
cd backend
python -c "from app.models.index_service import ModelIndexService; print('OK')"
```

Muss ausgeben:

```text
OK
```

## Frontend Typecheck

```powershell
pnpm typecheck
```

Muss insbesondere bestätigen:

```text
kein fehlender Export makeRoutingDecision
keine falschen Brokerargumente
keine Request-Typefehler
```

## Desktop Tests

```powershell
pnpm --filter @dbzs/desktop test
```

## Backend Tests

```powershell
cd backend
uv run pytest -q
```

## Build

```powershell
pnpm build
```

Alle Ergebnisse im PR dokumentieren.

---

# 14. Manuelle Abnahmetests

## Test A

```text
Hallo
```

Erwartung:

```text
fast_gpu
kein Agentenloop
Antwort
```

## Test B

```text
Kannst du mir ausführlich erklären,
wie der Model Index arbeitet?
```

Erwartung:

```text
normal_chat
fast_gpu
kein Agentenloop
```

## Test C

```text
Prüfe runtimeChatStore.ts
auf die Ursache des frühen Timeouts.
```

Erwartung:

```text
review oder debugging
quality_cpu
Slot validiert
```

## Test D

Falsches Modell im Slot:

```text
selected_model_not_running_in_slot
```

## Test E

Stream abbrechen:

```text
Frontend stoppt
Electron-Fetch stoppt
Backendstream stoppt
nächste Anfrage funktioniert
```

## Test F

Strict Mode:

```text
nur Modelle unter:
C:\Users\ralle\source\repos\dbzs-codee-project\models
```

## Test G

Runtime Tool Registry:

```text
nur Tools unter:
C:\Users\ralle\source\repos\dbzs-codee-project\models\llama.cpp-win-runtime
```

---

# 15. Merge-Gate

PR #19 darf erst gemergt werden, wenn:

- [ ] `backend/app/models/discovery.py` existiert
- [ ] Backendimport funktioniert
- [ ] `makeRoutingDecision`-Buildfehler beseitigt
- [ ] Brokerentscheidung entsteht im Store
- [ ] alter Router entscheidet beim Versand nicht erneut
- [ ] `model_id` und `slot_id` bleiben unverändert
- [ ] Slot Validator ist aktiv
- [ ] `chat_ready` wird geliefert
- [ ] Modell-Slot-Konsistenz wird geprüft
- [ ] AbortSignal erreicht Streaming und Non-Streaming
- [ ] Non-Streaming kann nicht unendlich hängen
- [ ] RoutingDiagnosticsCard ist sichtbar
- [ ] Typecheck grün
- [ ] Desktoptests grün
- [ ] Backendtests grün
- [ ] Build grün
- [ ] manuelle Tests A-G ehrlich dokumentiert
- [ ] keine ungeprüfte Production-Ready-Behauptung

---

# 16. Commit-Reihenfolge

```text
fix(models): add missing discovery service
fix(models): enforce strict project-local paths and stable relative ids
fix(routing): create broker decision in runtime chat store
fix(routing): remove legacy model router from chat dispatch
fix(runtime): validate selected model against target slot
fix(runtime): expose chat readiness in slot status
fix(chat): propagate abort signal through all runtime chat paths
fix(electron): bound non-stream chat requests
feat(ui): render routing diagnostics in runtime chat
test(spine): verify broker slot abort strict mode and diagnostics
docs(repair): replace unverified pass claims with actual test results
```

---

# 17. Abschlussbericht

Liefere:

```text
1. geänderte Dateien
2. behobene Backendblocker
3. behobene Desktop-Buildblocker
4. finaler Routingpfad
5. Slotvalidierung
6. Modell-Slot-Prüfung
7. Abortpfad
8. Strict-Mode-Verhalten
9. UI-Verkabelung
10. Typecheck-Ergebnis
11. Desktoptest-Ergebnis
12. Backendtest-Ergebnis
13. Build-Ergebnis
14. Test A-G jeweils PASS / FAIL / NOT RUN
15. verbleibende Blocker
16. Merge-Empfehlung
```

Bis alle Gates bestanden sind:

```text
PR #19 STATUS:
CHANGES REQUIRED
DO NOT MERGE
```
