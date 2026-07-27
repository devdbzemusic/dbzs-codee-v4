# GH COPILOT IMPLEMENTIERUNGSAUFTRAG
# Division By Zeros (DBZS) Codee
## P0 Repair Run: Runtime Chat Communication Spine

## 0. Auftrag

Repariere ausschließlich den kritischen Kommunikationspfad von der Chat-Eingabe bis zum lokalen `llama-server`.

Kein weiterer Feature-Ausbau.

Nicht gleichzeitig bearbeiten:

- Icons
- Packaging
- Kontextmenüs
- zusätzliche Agenten
- neue Cloudprovider
- neue Modelle
- neue Multi-Model-Features
- Quantisierung
- Embeddings
- Reranker

Der aktuelle Fehler ist klar reproduzierbar:

```text
"Hallo"
→ funktioniert

etwas längere Nachricht
→ Agentenloop / Routing / Kontext / Timeout
```

Ziel ist ein kontrollierter Pfad:

```text
Benutzereingabe
→ Task-Klassifikation
→ eine verbindliche Routingentscheidung
→ ein Modell
→ ein Slot
→ Zielslotprüfung
→ Kontextaufbau
→ echter llama-server Request
→ Stream
→ Antwort
```

---

# 1. P0 – Nachrichtenlängen-Regel entfernen

Datei:

```text
apps/desktop/src/services/runtimeChatAgentConfig.ts
```

Aktuell existiert sinngemäß:

```typescript
return technicalTerms.some(term => cleaned.includes(term))
  || cleaned.length > 20;
```

Diese Regel vollständig entfernen.

Eine Nachricht darf nicht allein aufgrund ihrer Länge den Agentenloop aktivieren.

## Neue Regel

Der Agentenloop darf nur aktiviert werden bei:

```text
explizitem Agent Mode
targetAgent = coder
targetAgent = debugger
eindeutigem Patch-/Edit-/Refactor-Auftrag
eindeutigem Toolauftrag
eindeutigem Review-Auftrag
eindeutigem Debugging-Auftrag
```

Normale längere Fragen bleiben normaler Chat.

## Tests

```text
"Hallo"
→ false

"Kannst du mir das bitte ausführlich erklären?"
→ false

"Erkläre mir den Model Index."
→ false

"Prüfe runtimeChatStore.ts auf Fehler."
→ true

"Ändere die Funktion sendMessage."
→ true

"Führe ein Code Review durch."
→ true
```

---

# 2. P0 – Einen verbindlichen Model Broker bauen

Aktuell routen Frontend und Backend unabhängig.

Das ist zu entfernen.

## Neue zentrale Entscheidung

Erstelle oder erweitere einen zentralen Broker:

```typescript
export interface ModelSelectionDecision {
  taskType:
    | "casual_chat"
    | "normal_chat"
    | "planning"
    | "small_code_change"
    | "large_code_change"
    | "debugging"
    | "review"
    | "architecture";

  targetAgent: ModelTargetAgent;
  slotId: "fast_gpu" | "quality_cpu" | "utility";
  modelId: string;
  modelName: string;
  providerId: "llama-cpp";
  reason: string[];
  fallbackPolicy: "strict" | "allow_local_fallback";
}
```

Die Entscheidung wird einmal erzeugt und unverändert durchgereicht.

## Verbindlicher Pfad

```text
RuntimeChatStore
→ AgentRunService
→ Electron
→ Backend
→ RuntimeService
```

Das Backend darf nicht anschließend erneut anhand von Keywords einen anderen Slot wählen, wenn `slot_id` und `model_id` bereits gesetzt sind.

## Vorgabe

```typescript
RuntimeChatRequest {
  ...
  slot_id: RuntimeSlotId;
  model_id: string;
  fallback_policy: "strict";
}
```

Keine implizite Neuerkennung.

---

# 3. P0 – Zielslot vor Request prüfen

Aktuell wird nur geprüft, ob irgendeine Runtime läuft.

Das ist falsch.

## Ziel

Nach der Brokerentscheidung:

```text
slotId = quality_cpu
modelId = qwen25-coder-7b-q4km
```

muss genau dieser Slot geprüft werden.

## Neue Prüfung

```text
GET /runtime/slots/{slot_id}/status
```

Prüfen:

```text
state = running
model_id stimmt
endpoint vorhanden
chat_ready = true
```

Wenn nicht:

```text
target_slot_unavailable
```

Kein stiller Wechsel.

---

# 4. P0 – Backend-Neurouting deaktivieren

Datei:

```text
backend/app/runtime/service.py
```

Aktuell entscheidet `_route_request_slot()` erneut anhand von:

```text
Dateikontext
Keywords
laufenden Slots
```

## Neue Regel

```python
if chat_request.slot_id:
    return chat_request.slot_id
```

Wenn `slot_id` gesetzt ist, darf keine weitere Routinglogik ausgeführt werden.

Wenn `model_id` gesetzt ist, muss geprüft werden, ob das Modell im Slot aktiv ist.

Bei Abweichung:

```text
selected_model_not_running_in_slot
```

Kein stilles Fallback.

Die bisherige Keywordlogik darf nur noch für Legacy-Requests ohne `slot_id` verwendet werden.

---

# 5. P0 – First-Token-Timer verschieben

Datei:

```text
apps/desktop/src/stores/runtimeChatStore.ts
```

Aktuell startet der First-Token-Timer direkt nach Annahme der Nachricht.

Das ist falsch.

## Entfernen

```typescript
startFirstTokenTimeout();
```

aus dem frühen Vorbereitungsabschnitt.

## Neuer Startpunkt

Der Timer startet erst unmittelbar vor:

```typescript
agentRunService.sendChatStream(...)
```

oder unmittelbar vor dem ersten echten HTTP-/IPC-Modellrequest.

## Stoppen

Beim ersten Delta:

```typescript
resetFirstTokenTimeout();
```

Routing, Kontextaufbau, Workspace-Lesen und Orchestrierung dürfen nicht auf den First-Token-Timer angerechnet werden.

---

# 6. P0 – Stage-spezifische Timeouts

Verwende getrennte Timeouts:

```text
Runtime Status: 5 Sekunden
Model Routing: 5 Sekunden
Runtime Bootstrap: 10 Sekunden
Prompt Context: 15 Sekunden
Workspace Context: 15 Sekunden
Orchestration: 15 Sekunden
First Token: modellabhängig
Total Runtime: modellabhängig
```

Kein globaler First-Token-Timer während der Vorverarbeitung.

---

# 7. P0 – Abort vollständig bis llama.cpp durchreichen

Aktuell erreicht `AbortSignal` den llama.cpp-Streamingpfad nicht vollständig.

## Reparaturkette

```text
RuntimeChatStore
→ requestAssistantResponse
→ AgentRunService.sendChatStream
→ streamRuntimeChat
→ backendClient.streamRuntimeChat
→ Electron IPC
→ streamRuntimeChatViaBackend
→ fetch(..., { signal })
```

## Änderungen

### `streamRuntimeChat`

Neue Signatur:

```typescript
export async function streamRuntimeChat(
  request: RuntimeChatRequest,
  callbacks: RuntimeChatStreamCallbacks,
  signal?: AbortSignal
): Promise<RuntimeChatResponse>
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

### Electron Fetch

Das Signal muss beim Backend-Streamingrequest verwendet werden.

## Abnahmekriterium

```text
Run abbrechen
→ Stream endet
→ Fetch beendet
→ keine Hintergrundantwort
→ nächste Anfrage funktioniert sofort
```

---

# 8. P0 – Retry-Lawine entfernen

Datei:

```text
apps/desktop/src/stores/runtimeChatStore.ts
```

Aktuell:

```text
bis zu 3 Streamingversuche
+ Non-Streaming-Fallback
```

## Neue Policy

### Transportfehler vor Requestbeginn

```text
maximal 1 Wiederholung
```

### Timeout

```text
keine Wiederholung
```

### Abort

```text
keine Wiederholung
```

### Tool HTTP 400

```text
genau ein Versuch ohne Tools
```

### Leerer Stream

```text
genau ein Non-Streaming-Diagnoseversuch
nur ohne Timeout und ohne Abort
```

Implementiere eine explizite Fehlerklassifikation:

```typescript
type ChatFailureKind =
  | "transport"
  | "timeout"
  | "aborted"
  | "http_400_tools"
  | "empty_stream"
  | "runtime_offline"
  | "unknown";
```

---

# 9. P0 – Pauschalen 10-Sekunden-Backend-Timeout entfernen

Datei:

```text
apps/desktop/electron/main.ts
```

Aktuell wird in `requestBackend()` pauschal verwendet:

```typescript
signal: AbortSignal.timeout(10000)
```

Das ist für alle Endpunkte falsch.

## Neue Timeoutklassen

```typescript
type BackendTimeoutClass =
  | "status"
  | "settings"
  | "runtime_start"
  | "runtime_stop"
  | "chat"
  | "benchmark"
  | "diagnostic"
  | "none";
```

Beispiel:

```text
status: 5 Sekunden
settings: 5 Sekunden
runtime_start: 10 Minuten
runtime_stop: 30 Sekunden
chat: externes AbortSignal
benchmark: 30 Minuten
diagnostic: 10 Minuten
none: kein automatischer Timeout
```

`requestBackend()` darf nicht automatisch jedes Signal überschreiben.

Wenn ein externes Signal übergeben wird, muss dieses Vorrang haben.

---

# 10. P1 – Project Local Strict Model Index

Erst nach Abschluss aller P0-Punkte.

## Fester Model Root

```text
C:\Users\ralle\source\repos\dbzs-codee-project\models
```

## Fester Runtime Root

```text
C:\Users\ralle\source\repos\dbzs-codee-project\models\llama.cpp-win-runtime
```

## Neuer Modus

```typescript
export type ModelSourceMode =
  | "project_local_strict"
  | "configured"
  | "discovery";
```

Während des Repair Runs:

```text
project_local_strict
```

## In diesem Modus deaktivieren

```text
Ollama
DBZS_MODELS_DIR Override
settings.modelsPath Override
D:\Models
F:\Models
H:\Models
.ollama
externe llama.cpp Runtimepfade
Cloudmodelle
Cloudfallback
```

## Pfadprüfung

Jeder Modellpfad muss innerhalb des Projekt-Models-Roots liegen.

Externe Pfade erzeugen:

```text
model_outside_project_root
```

## Stabile Modell-ID

Nicht aus absolutem Pfad.

Stattdessen:

```python
relative_path = model_path.relative_to(models_dir)
model_id = stable_id(relative_path.as_posix().lower())
```

---

# 11. P1 – Externe Runtimepfade deaktivieren

In `project_local_strict` dürfen diese Fallbacks nicht verwendet werden:

```text
D:\win_runtimes\llama\cpu-x64
D:\win_runtimes\llama\vulkan-x64
D:\win_runtimes\llama
```

Nur:

```text
<project>\models\llama.cpp-win-runtime
```

---

# 12. P2 – llama.cpp Runtime Tool Registry

Erst nach P0 und P1.

## P0-Tools erfassen

```text
llama-server.exe
llama-cli.exe
llama-bench.exe
llama-tokenize.exe
```

## Contract

```typescript
export interface LlamaRuntimeTool {
  id: "server" | "cli" | "bench" | "tokenize";
  executableName: string;
  executablePath: string;
  available: boolean;
  version: string | null;
  executionMode: "service" | "job";
  lastTestAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
}
```

## Manager

```text
LlamaServerManager
LlamaJobRunner
```

`llama-cli`, `llama-bench` und `llama-tokenize` sind Jobs, keine dauerhaften Chatserver.

---

# 13. UI-Verkabelung

Erst nach funktionsfähigem Backend.

## Sichtbar machen

### Chat Run

```text
Task Type
Zielagent
Modell
Slot
Routinggrund
aktuelle Stage
aktiver Timeout
```

### Runtime Slots

```text
Fast GPU
Quality CPU
Utility
```

Je Slot:

```text
Status
Modell
Port
PID
GPU-Layer
Kontext
Start
Stopp
Logs
```

### Model Index

```text
Source Mode
Models Root
Runtime Root
gefundene Modelle
abgelehnte Pfade
Index neu aufbauen
```

### llama.cpp Tools

```text
Executable
Version
verfügbar
Test
Exit-Code
```

---

# 14. Tests

## Unit Tests

### Agent Intent

```text
lange normale Frage → kein Agentenloop
Codingauftrag → Agentenloop
Reviewauftrag → Agentenloop
```

### Broker

```text
normal_chat → fast_gpu
coding → quality_cpu
slotId und modelId immer gesetzt
```

### Backend

```text
slot_id gesetzt → kein Keyword-Neurouting
falsches Modell im Slot → Fehler
```

### Abort

```text
AbortSignal erreicht fetch
keine Hintergrundantwort
```

### Retry

```text
Timeout → 0 Retries
Abort → 0 Retries
Transportfehler → maximal 1 Retry
Tool 400 → einmal ohne Tools
```

### Project Local Strict

```text
nur Projektmodelle
externer Pfad wird abgelehnt
Ollama nicht indexiert
relative stabile IDs
```

---

# 15. Manuelle Abnahme

## Test A

```text
Hallo
```

Erwartung:

```text
normaler Fast Path
keine Kontextpipeline
Antwort
```

## Test B

```text
Kannst du mir ausführlich erklären, wie der aktuelle Model Index arbeitet?
```

Erwartung:

```text
normaler Chat
kein Agentenloop
kein Timeout
```

## Test C

```text
Prüfe runtimeChatStore.ts auf die Ursache des frühen Timeouts.
```

Erwartung:

```text
Coding Task
quality_cpu
Slot vor Request geprüft
```

## Test D

```text
quality_cpu offline
Coding Task senden
```

Erwartung:

```text
target_slot_unavailable
kein stiller Fallback
```

## Test E

```text
laufenden Stream abbrechen
```

Erwartung:

```text
Stream sofort beendet
keine Hintergrundantwort
nächste Anfrage funktioniert
```

## Test F

```text
Project Local Strict aktivieren
```

Erwartung:

```text
nur Modelle aus:
C:\Users\ralle\source\repos\dbzs-codee-project\models
```

---

# 16. Qualitätsgates

```powershell
pnpm typecheck
pnpm --filter @dbzs/desktop test
pnpm build
```

Backend:

```powershell
cd backend
uv run pytest -q
```

Nicht ausgeführte Tests als `NOT RUN` dokumentieren.

Keine Aussage „vollständig repariert“, solange die manuellen Tests A–F nicht dokumentiert sind.

---

# 17. Commit-Reihenfolge

```text
fix(chat): remove message-length agent trigger
feat(routing): add single authoritative model broker
fix(runtime): enforce explicit slot and model selection
fix(chat): start first-token timer at transport boundary
fix(chat): propagate abort through llama stream
fix(chat): replace retry cascade with explicit failure policy
fix(electron): add endpoint-specific backend timeouts
feat(models): add project-local-strict source mode
fix(models): reject external model paths and use stable relative ids
feat(runtime): add llama runtime tool registry
feat(ui): expose routing slot index and runtime tools
test(chat): cover communication spine routing abort and retry
```

---

# 18. Definition of Done

- [ ] `cleaned.length > 20` entfernt
- [ ] längere normale Fragen bleiben Chat
- [ ] genau ein Model Broker
- [ ] `slot_id` und `model_id` verbindlich
- [ ] Backend routet bei gesetztem Slot nicht neu
- [ ] Zielslot vor Request geprüft
- [ ] First-Token-Timer startet erst beim HTTP-Request
- [ ] Abort erreicht den llama.cpp Fetch
- [ ] Retry-Lawine entfernt
- [ ] kein pauschaler 10-Sekunden-Timeout
- [ ] Project Local Strict funktioniert
- [ ] externe Modelle und Ollama deaktiviert
- [ ] stabile relative Modell-IDs
- [ ] llama.cpp Tool Registry vorhanden
- [ ] UI zeigt Routing, Slot, Index und Tools
- [ ] Tests und Build grün
- [ ] manuelle Tests A–F dokumentiert

---

# 19. Abschlussbericht

Liefere:

```text
1. entfernte Root Causes
2. neuer Communication Spine
3. Brokerentscheidung
4. Slotprüfung
5. Timeoutverhalten
6. Abortpfad
7. Retry-Policy
8. Project Local Strict
9. Runtime Tool Registry
10. UI-Verkabelung
11. Testresultate
12. Test A: PASS / FAIL / NOT RUN
13. Test B: PASS / FAIL / NOT RUN
14. Test C: PASS / FAIL / NOT RUN
15. Test D: PASS / FAIL / NOT RUN
16. Test E: PASS / FAIL / NOT RUN
17. Test F: PASS / FAIL / NOT RUN
18. bekannte Restprobleme
19. ehrlicher Readiness-Status
```
