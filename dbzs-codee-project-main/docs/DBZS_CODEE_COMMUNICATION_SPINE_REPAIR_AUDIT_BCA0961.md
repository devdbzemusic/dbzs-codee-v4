# Division By Zeros (DBZS) Codee
# Communication-Spine Repair – Audit und nächste Copilot-Runde
## Geprüfter Stand: `bca0961297051a1cf585b4957acb5ca610d93b5b`

## Gesamturteil

Der Repair Run wurde substanziell begonnen, ist aber noch nicht produktionsfähig.

Mehrere P0-Komponenten wurden erstellt, jedoch nicht vollständig in den realen Chatpfad integriert. Der aktuelle Model Index enthält zudem einen wahrscheinlichen Backend-Startblocker.

Der ehrliche Status lautet:

```text
PARTIALLY IMPLEMENTED
NOT PRODUCTION READY
```

Die Aussagen in `RELEASE_NOTES.md` wie `360+ tests passing` und `Production Ready: Yes` sind durch den sichtbaren Repositorystand nicht belegt. Für den aktuellen Commit existieren keine sichtbaren GitHub-Actions-Läufe. Die Staging-Abnahmetests stehen weiterhin auf `Ready for Execution`.

---

# 1. Tatsächlich verbesserte Bereiche

## 1.1 Nachrichtenlängen-Trigger entfernt

Die problematische Regel:

```typescript
cleaned.length > 20
```

wurde entfernt. Eine längere Nachricht löst nicht mehr allein aufgrund ihrer Länge den Agentenloop aus.

### Restproblem

Die Intent-Liste ist weiterhin zu breit. Begriffe wie `Datei`, `Test`, `Run`, `Analyse` oder `Plan` können normale Fragen weiterhin unnötig als Agentenauftrag klassifizieren.

## 1.2 First-Token-Timer verschoben

Der First-Token-Timer startet im normalen Chatpfad jetzt unmittelbar vor `requestAssistantResponse()` und im Agentenpfad vor `runAgentChatTurnLoop()`.

Routing, Kontextaufbau und Orchestrierung werden damit nicht mehr dem First-Token-Timer zugerechnet.

## 1.3 Stage-spezifische Timeouts

Es existieren zentrale Timeoutprofile:

```text
Routing: 5 s
Bootstrap: 10 s
Kontext: 15 s
Transport: 10 s
First Token: 60 s
Gesamt: 30 min
```

Restproblem: Der Store ruft `selectTimeoutProfile()` noch ohne den verbindlichen Task Type aus dem neuen Broker auf.

## 1.4 Fehlerklassifikation und Retry-Policy

Neue Klassen:

```text
transport
timeout
abort
http_400_tools
http_4xx
http_5xx
runtime_error
unknown
```

Regeln:

```text
Transport: maximal 1 Retry
Timeout: 0 Retries
Abort: 0 Retries
HTTP 400 mit Tools: genau 1 Versuch ohne Tools
```

## 1.5 Endpointbezogene Electron-Timeouts

Aktuell:

```text
Status / Health / Doctor: 5 s
Chat: kein Electron-Timeout
Benchmark / Model-Test: 30 min
Default: 10 s
```

Restproblem: Ein intern gesetzter Timeout überschreibt weiterhin ein eventuell von außen übergebenes AbortSignal.

---

# 2. Kritischer Blocker: Self-Import im Model Index

Datei:

```text
backend/app/models/index_service.py
```

Problematische Zeile:

```python
from app.models.index_service import ModelIndexService
```

Die Datei importiert damit ihre eigene Klasse, bevor diese definiert wurde. Das kann zu einem Circular-/Partial-Initialization-Importfehler führen.

## Pflichtkorrektur

```python
# vollständig entfernen
from app.models.index_service import ModelIndexService
```

Pflichttest:

```powershell
cd backend
python -c "from app.models.index_service import ModelIndexService; print('OK')"
```

---

# 3. Kritischer Blocker: `discovery.py` fehlt

`index_service.py` importiert:

```python
from app.models.discovery import ModelDiscoveryService
```

Die Datei:

```text
backend/app/models/discovery.py
```

ist im sichtbaren Repositorystand nicht vorhanden.

## Zulässige Lösungen

### Lösung A

`backend/app/models/discovery.py` vollständig hinzufügen.

Benötigte Funktionen:

```text
project_local_strict
local_with_ollama
cloud_enabled
Projekt-Root-Erkennung
Pfadvalidierung
relative stabile Modell-IDs
```

### Lösung B

Den Import entfernen und die Discovery-Logik sauber in `index_service.py` integrieren.

Keine Dummyklasse und keinen Platzhalter verwenden.

---

# 4. Neuer Model Broker ist nicht produktiv verbunden

Vorhanden:

```text
apps/desktop/src/services/modelSelectionBroker.ts
```

Die Datei erzeugt:

```text
taskType
targetAgent
slotId
modelId
modelName
providerId
reason
fallbackPolicy
```

Im echten Chatpfad wird weiterhin aufgerufen:

```typescript
agentRunService.resolveRouting(effectiveAgent)
```

`AgentRunService` verwendet weiterhin:

```typescript
modelRouterService.selectModelForAgent(...)
```

Damit existieren weiterhin drei Routingebenen:

```text
neuer ModelSelectionBroker
alter ModelRouterService
Backend-Slotrouting
```

## Pflichtkorrektur

Im `runtimeChatStore` muss einmalig entschieden werden:

```typescript
const taskType = classifyTaskType(
  trimmedContent,
  sendOptions?.agentMode === "agent",
  Boolean(activeFile)
);

const decision = brokerDecision(taskType, {
  defaultModelId: settings.defaultModelId,
  defaultModelName: resolvedDefaultModelName,
  defaultCoderModelId: settings.defaultCoderModelId,
  defaultDebugModelId: settings.defaultDebugModelId,
  localOnlyModels: settings.localOnlyModels
});
```

Danach darf der alte `modelRouterService` im Runtime-Chatpfad nicht mehr neu entscheiden.

---

# 5. Slot und Modell fehlen im echten Request

Der aktuelle Request enthält sinngemäß:

```typescript
{
  messages,
  file_context,
  temperature,
  max_tokens
}
```

Es fehlen:

```typescript
model_id
slot_id
fallback_policy
```

Beim llama.cpp-Pfad ergänzt `AgentRunService` aktuell nur `model_id`.

## Pflichtkorrektur

```typescript
const request: RuntimeChatRequest = {
  messages,
  file_context,
  temperature,
  max_tokens,
  model_id: decision.modelId,
  slot_id: decision.slotId,
  fallback_policy: decision.fallbackPolicy
};
```

Diese Werte dürfen nach der Brokerentscheidung nicht mehr geändert werden.

---

# 6. Backend validiert das Modell im Slot nicht

`resolve_chat_target()` prüft aktuell nur:

```text
Slot läuft
Endpoint vorhanden
```

Es fehlt:

```python
chat_request.model_id == current.model_id
```

## Pflichtkorrektur

```python
if chat_request.model_id and current.model_id != chat_request.model_id:
    raise RuntimeError(
        "selected_model_not_running_in_slot: "
        f"requested={chat_request.model_id}, "
        f"running={current.model_id}, "
        f"slot={slot_id}"
    )
```

Kein stiller Wechsel und kein automatisches Ersatzmodell.

---

# 7. Slot Validator ist nicht in den Chatpfad eingebunden

Vorhanden:

```text
apps/desktop/src/services/runtimeSlotValidator.ts
```

Die Funktion `verifySlotForRequest()` prüft Slotstatus, Modell-ID, Endpoint und `chat_ready`, wird aber produktiv nicht aufgerufen.

## Pflichtkorrektur

Unmittelbar nach der Brokerentscheidung:

```typescript
const validation = await verifySlotForRequest(
  settings.backendUrl,
  decision.slotId,
  decision.modelId,
  timeoutManager.getRouting()
);

if (!validation.ok) {
  throw new Error(validation.error ?? "target_slot_unavailable");
}
```

---

# 8. Contract-Fehler: `chat_ready` fehlt im Backend

Der Frontend-Validator erwartet:

```typescript
chat_ready: boolean
```

Das Backend-Schema `RuntimeSlotStatus` liefert dieses Feld nicht.

## Pflichtkorrektur

```python
class RuntimeSlotStatus(RuntimeStatus):
    slot_id: RuntimeSlotId
    device_policy: Literal["gpu", "cpu", "auto"] = "auto"
    gpu_layers: int | None = None
    context_size: int | None = None
    chat_ready: bool = False
```

Endpoint:

```python
chat_ready=(
    status.state == "running"
    and bool(status.endpoint)
    and service._endpoint_checker(status.endpoint)
)
```

---

# 9. Abort erreicht llama.cpp weiterhin nicht vollständig

Der Store übergibt ein `AbortSignal` an `AgentRunService.sendChatStream()`.

Beim llama.cpp-Pfad wird das Signal jedoch nicht an `streamRuntimeChat()` weitergegeben. `streamRuntimeChat()` besitzt weiterhin keinen Signalparameter.

## Pflichtkorrektur

### `runtimeChatStreamClient.ts`

```typescript
export async function streamRuntimeChat(
  request: RuntimeChatRequest,
  callbacks: RuntimeChatStreamCallbacks,
  signal?: AbortSignal
): Promise<RuntimeChatResponse> {
  return backendClient.streamRuntimeChat(
    request,
    payload => callbacks.onDelta(payload.delta, payload.totalLength),
    signal
  );
}
```

### `AgentRunService`

```typescript
return streamRuntimeChat(
  {
    ...request,
    model_id: cleanModelId,
    slot_id: request.slot_id
  },
  callbacks,
  signal
);
```

Das Signal muss über BackendClient, Preload und Electron bis zum echten `fetch(..., { signal })` reichen.

## Abnahmekriterium

```text
First-Token-Timeout
→ AbortController.abort()
→ Electron-Fetch endet
→ Backendstream endet
→ llama-server-Verbindung endet
→ nächste Anfrage funktioniert sofort
```

---

# 10. `project_local_strict` ist noch nicht wirklich strict

Gewünschter Models Root:

```text
C:\Users\ralle\source\repos\dbzs-codee-project\models
```

Gewünschter Runtime Root:

```text
C:\Users\ralle\source\repos\dbzs-codee-project\models\llama.cpp-win-runtime
```

## Offene Probleme

### Models Root bleibt überschreibbar

```python
self.models_dir = models_dir or get_models_dir()
```

Im Strict-Modus muss der Projektroot verbindlich sein.

### Externe Katalogpfade werden akzeptiert

Aktuell wird jede existierende Datei akzeptiert:

```python
if direct.is_file():
    return str(direct.resolve())
```

Pflichtprüfung:

```python
resolved = direct.resolve()
root = self.models_dir.resolve()

if self.discovery_mode == "project_local_strict":
    try:
        resolved.relative_to(root)
    except ValueError:
        raise ValueError(f"model_outside_project_root: {resolved}")
```

### Filesystem-IDs bleiben vom absoluten Pfad abhängig

Aktuell:

```python
model_id = _stable_id(path)
```

Richtig:

```python
relative_path = model_path.resolve().relative_to(self.models_dir.resolve())
model_id = _stable_id(relative_path.as_posix().lower())
```

### Katalog-ID hat weiterhin Vorrang

Im Strict-Modus muss die relative stabile ID Vorrang haben.

---

# 11. llama.cpp Tool Registry sucht am falschen Ort

Die Registry erkennt:

```text
llama-server
llama-cli
llama-bench
llama-tokenize
```

Sie sucht jedoch zuerst im globalen `PATH`. `RuntimeService` übergibt keinen projektlokalen Suchpfad.

## Pflichtkorrektur

```python
runtime_dir = self.models_dir / "llama.cpp-win-runtime"
self.tool_registry = RuntimeToolRegistry(
    search_paths=[str(runtime_dir)],
    allow_system_path=False
)
```

Im Strict-Modus dürfen keine externen Runtimes bevorzugt werden.

---

# 12. Tool Registry ist noch kein Jobrunner

Die Registry kann derzeit nur:

```text
Executable finden
Version auslesen
--help auslesen
Verfügbarkeit melden
```

Noch offen:

```text
llama-cli Smoketest
llama-bench Benchmarkjob
llama-tokenize Tokenbudget
Timeout
Abort
stdout
stderr
Exit-Code
Jobstatus
```

Benötigte Architektur:

```text
LlamaServerManager
LlamaJobRunner
LlamaModelWorkshop
```

Für die nächste Runde genügt zunächst:

```text
LlamaJobRunner
→ llama-cli
→ llama-bench
→ llama-tokenize
```

---

# 13. UI-Komponenten sind nicht eingebunden

`RoutingDiagnosticsCard.tsx` existiert, wird aber im Runtime Chat nicht gerendert.

Damit bleiben unsichtbar:

```text
Task Type
Zielagent
Modell
Slot
Routinggrund
Slotvalidierung
Timeoutstage
Fehlerklassifikation
```

## Pflichtkorrektur

```tsx
<RoutingDiagnosticsCard diagnostics={routingDiagnostics} />
```

Der Store benötigt dafür echten State:

```typescript
routingDiagnostics: RoutingDiagnostics | null
```

Keine Mockdaten.

---

# 14. Weitere Inkonsistenzen

## Provider-ID

Der Code verwendet teilweise `llama.cpp` und teilweise `llama-cpp`. Diese Werte müssen zentral gemappt und konsistent verwendet werden.

## Falscher Modellname im Broker

`brokerDecision()` übernimmt den Default-Modellnamen auch dann, wenn ein Coder- oder Debug-Modell gewählt wurde. Der Broker muss das reale Modellobjekt aus dem Index verwenden.

## Taskklassifikation zu aggressiv

Beispiele:

```text
"Warum ist der Himmel blau?" → debugging
"Kannst du das prüfen?" → review
"Ich brauche einen Plan für morgen." → planning
```

Die Klassifikation muss Coding-/Workspace-Kontext und explizite Änderungsabsicht berücksichtigen.

## Electron verschluckt Root Causes

Der Non-Streaming-Pfad ersetzt technische Fehler teilweise durch sichere Textantworten. Technische Fehler sollen klassifiziert an die UI weitergegeben werden; die UI erzeugt daraus die verständliche Meldung.

---

# 15. Ampel

| Bereich | Status |
|---|---|
| Nachrichtenlängen-Trigger entfernt | Grün |
| First-Token-Timer verschoben | Grün |
| Stage-Timeouts | Grün/Gelb |
| Fehlerklassifikation | Grün/Gelb |
| Retry-Kaskade reduziert | Grün |
| Endpointbezogene Timeouts | Gelb |
| Model Broker implementiert | Gelb |
| Broker produktiv verbunden | Rot |
| Slot-ID verbindlich im Request | Rot |
| Modell-ID verbindlich im Request | Rot |
| Slot Validator produktiv | Rot |
| Backend-Modell-Slot-Konsistenz | Rot |
| Abort bis llama.cpp | Rot |
| Project Local Strict | Rot |
| Model Index importierbar | Rot – Blocker |
| Runtime Tool Registry | Gelb |
| Projektlokale Runtime Registry | Rot |
| CLI-/Bench-/Tokenize-Jobs | Rot |
| Diagnose-UI verbunden | Rot |
| Manuelle Tests | NOT RUN |
| CI-Nachweis | Nicht vorhanden |
| Production Ready | Nein |

---

# 16. Nächste Copilot-Runde – verbindliche Reihenfolge

## P0.1 Backend wieder importierbar machen

1. Self-Import aus `index_service.py` entfernen.
2. Fehlende `discovery.py` hinzufügen oder den Import entfernen.
3. Importtest ausführen.
4. Backendtests ausführen.

## P0.2 Broker wirklich integrieren

5. `classifyTaskType()` im Store aufrufen.
6. `brokerDecision()` im Store aufrufen.
7. alten `modelRouterService` aus dem Runtime-Chatpfad entfernen.
8. Brokerentscheidung im Store speichern.

## P0.3 Slot und Modell binden

9. `slot_id`, `model_id`, `fallback_policy` in jeden Request übernehmen.
10. `verifySlotForRequest()` vor dem Modellrequest aufrufen.
11. `chat_ready` im Backendcontract ergänzen.
12. Requestmodell gegen aktives Slotmodell prüfen.

## P0.4 Abort vollständig reparieren

13. AbortSignal durch `AgentRunService` weiterreichen.
14. `streamRuntimeChat()` um Signal erweitern.
15. BackendClient, Preload und Electron-Fetch verbinden.
16. Timeout-Abbruch manuell testen.

## P1 Strict Model Index

17. Projekt-Models-Root verbindlich machen.
18. externe Modellpfade ablehnen.
19. relative stabile Modell-IDs verwenden.
20. Ollama und globale Runtimes im Strict-Modus deaktivieren.

## P2 Tool Registry und Jobs

21. Registry ausschließlich auf Projekt-Runtime begrenzen.
22. `LlamaJobRunner` für CLI, Bench und Tokenize implementieren.
23. Exit-Code, stdout, stderr und Logs speichern.

## P3 UI

24. `RoutingDiagnosticsCard` rendern.
25. Slotstatus anzeigen.
26. Model-Index-Quelle anzeigen.
27. Runtime-Tools anzeigen.
28. Timeoutstage und Fehlerklassifikation anzeigen.

---

# 17. Pflichtprüfungen

## Backend-Import

```powershell
cd backend
python -c "from app.models.index_service import ModelIndexService; print('OK')"
```

## Backendtests

```powershell
cd backend
uv run pytest -q
```

## Frontend

```powershell
pnpm typecheck
pnpm --filter @dbzs/desktop test
pnpm build
```

Nicht ausgeführte Tests müssen als `NOT RUN` dokumentiert werden.

---

# 18. Manuelle Abnahmetests

## Test A – einfacher Chat

```text
Hallo
```

Erwartung:

```text
fast_gpu
kein Agentenloop
Antwort
```

## Test B – längere normale Frage

```text
Kannst du mir ausführlich erklären, wie der aktuelle Model Index arbeitet?
```

Erwartung:

```text
normal_chat
kein Agentenloop
kein Timeout
```

## Test C – Coding-/Review-Aufgabe

```text
Prüfe runtimeChatStore.ts auf die Ursache des frühen Timeouts.
```

Erwartung:

```text
review oder debugging
quality_cpu
Slotvalidierung vor Request
```

## Test D – falsches Modell im Slot

Erwartung:

```text
selected_model_not_running_in_slot
kein stilles Fallback
```

## Test E – Stream abbrechen

Erwartung:

```text
UI endet
Electron-Fetch endet
Backendstream endet
nächste Anfrage funktioniert
```

## Test F – Strict Model Index

Erwartung:

```text
nur Modelle unter:
C:\Users\ralle\source\repos\dbzs-codee-project\models
```

## Test G – Runtime Tools

Erwartung:

```text
nur Tools unter:
C:\Users\ralle\source\repos\dbzs-codee-project\models\llama.cpp-win-runtime
```

---

# 19. Definition of Done

- [ ] `index_service.py` ist importierbar.
- [ ] `discovery.py` existiert oder wird nicht importiert.
- [ ] Der neue Broker wird im echten Chatpfad verwendet.
- [ ] Der alte Router entscheidet dort nicht mehr.
- [ ] Jeder Request enthält `slot_id`.
- [ ] Jeder Request enthält `model_id`.
- [ ] Jeder Request enthält `fallback_policy`.
- [ ] Zielslot wird vor dem Request geprüft.
- [ ] `chat_ready` existiert im Backendcontract.
- [ ] Backend validiert Slotmodell gegen Requestmodell.
- [ ] Abort erreicht den Electron-Fetch.
- [ ] Abort beendet den Backendstream.
- [ ] Strict Mode erlaubt nur das Projektmodellverzeichnis.
- [ ] Externe Katalogpfade werden abgelehnt.
- [ ] Modell-IDs sind relativ und stabil.
- [ ] Tool Registry nutzt nur die Projekt-Runtime.
- [ ] `llama-cli`, `llama-bench` und `llama-tokenize` laufen als kontrollierte Jobs.
- [ ] RoutingDiagnosticsCard ist sichtbar eingebunden.
- [ ] Typecheck ist grün.
- [ ] Desktoptests sind grün.
- [ ] Backendtests sind grün.
- [ ] Build ist grün.
- [ ] Manuelle Tests A–G sind dokumentiert.
- [ ] Release Notes enthalten keinen ungeprüften Production-Ready-Status.

---

# 20. Abschlussregel

Der Repair Run ist erst abgeschlossen, wenn der reale Pfad nachweislich funktioniert:

```text
Chat
→ Taskklassifikation
→ ein Broker
→ ein Modell
→ ein Slot
→ Slotvalidierung
→ lokaler llama-server
→ kontrollierter Stream
→ echter Abort
→ sichtbare Antwort
```
