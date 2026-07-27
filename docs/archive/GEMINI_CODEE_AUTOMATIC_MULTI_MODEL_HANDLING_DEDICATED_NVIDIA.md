# GEMINI-IMPLEMENTIERUNGSAUFTRAG
# Division By Zeros (DBZS) Codee
## Automatisches Multi-Model-Handling mit dedizierter NVIDIA-GPU für Codee

## 0. Wichtige Hardwarekorrektur

Die interne AMD-Radeon-Grafik des Ryzen 5 5600G übernimmt die Monitore und die Windows-Desktopdarstellung.

Die NVIDIA GTX 1650 SUPER mit 4 GB VRAM steht vollständig für Codee und lokale KI-Inferenz zur Verfügung.

Das bedeutet:

```text
AMD iGPU:
- Monitore
- Windows Desktop
- Electron-/UI-Ausgabe
- keine primäre LLM-Inferenz

NVIDIA GTX 1650 SUPER:
- exklusiv für Codee
- llama.cpp / Vulkan
- kleines generatives Modell
- optional Utility-Modell nach Ressourcenprüfung

CPU / RAM:
- Qwen2.5-Coder-7B
- Build-, Test- und Backendprozesse
```

Trotz der dedizierten Nutzung muss auf der NVIDIA-GPU eine Sicherheitsreserve für:

- Vulkan-Treiber
- Compute-Buffer
- KV-Cache
- llama.cpp-Overhead
- temporäre Allokationen

verbleiben.

Empfohlene VRAM-Reserve:

```text
400–600 MB
```

Codee darf daher nicht pauschal mit 4096 MB frei verfügbarem Modell-VRAM rechnen.

---

# 1. Zielhardware

```text
CPU: AMD Ryzen 5 5600G
Kerne/Threads: 6 / 12
RAM: 32 GB
iGPU: AMD Radeon Graphics
iGPU-Aufgabe: Monitore und Desktop
GPU: NVIDIA GTX 1650 SUPER
VRAM: 4 GB
GPU-Aufgabe: exklusiv Codee / lokale Inferenz
Betriebssystem: Windows 11
Inference: llama.cpp / llama-server / Vulkan
Betriebsstrategie: CPU-first + dedizierte GPU-Runtime
```

---

# 2. Zielarchitektur

Codee soll mindestens drei Runtime-Slots verwalten:

```text
fast_gpu
quality_cpu
utility
```

## fast_gpu

Auf der NVIDIA GTX 1650 SUPER.

Geeignete Modelle:

```text
Priorität 1:
Qwen3.5-2B Q5_K_M

Priorität 2:
Qwen2.5-Coder-3B-Instruct Q4_K_M

Priorität 3:
Qwen2.5-Coder-3B-Instruct Q5_K_M
nur nach bestandenem VRAM-Benchmark
```

Aufgaben:

- normaler Chat
- Begrüßungen
- Intent-Erkennung
- Modell- und Agentenrouting
- Statusmeldungen
- Zusammenfassungen
- kleine Planungen
- kleine Codeänderungen
- Tool-Auswahl
- kurze Datei- und Funktionsanalysen

Port:

```text
8081
```

---

## quality_cpu

Auf CPU und RAM.

Bevorzugtes Modell:

```text
Qwen2.5-Coder-7B-Instruct Q4_K_M
```

Aufgaben:

- größere Coding-Aufgaben
- Multi-File-Analyse
- schwieriges Debugging
- Architekturprüfung
- Refactoring
- Review
- Rust, C++, Tauri und komplexes TypeScript
- Eskalation nach fehlgeschlagenen Versuchen des kleinen Modells

Port:

```text
8082
```

GPU-Layer:

```text
0
```

Das 7B-Modell soll bewusst vollständig auf CPU/RAM laufen, damit die NVIDIA-GPU parallel für das kleine schnelle Modell verfügbar bleibt.

---

## utility

Für Embedding und Reranking.

Modelle:

```text
Qwen3-Embedding-0.6B
Qwen3-Reranker-0.6B
```

Port:

```text
8083
```

Strategie:

```text
Load on demand
```

Bevorzugte Reihenfolge:

```text
1. CPU verwenden, solange fast_gpu aktiv ist
2. GPU nur verwenden, wenn das Ressourcenbudget ausreicht
3. nach Ausführung wieder entladen
```

---

# 3. Erlaubter Parallelbetrieb

Primär erlaubt:

```text
quality_cpu + fast_gpu
```

Das ist die bevorzugte Dauerbelegung.

Beispiel:

```text
CPU:
Qwen2.5-Coder-7B Q4_K_M

NVIDIA:
Qwen3.5-2B Q5_K_M
```

Optional erlaubt:

```text
quality_cpu + fast_gpu + utility_cpu
```

Nur nach Ressourcenprüfung erlaubt:

```text
quality_cpu + fast_gpu + utility_gpu
```

Nicht automatisch erlaubt:

```text
zwei generative Modelle gleichzeitig auf der NVIDIA-GPU
```

Nicht automatisch erlaubt:

```text
3B-Modell + Embedding + Reranker vollständig gleichzeitig auf 4 GB VRAM
```

---

# 4. Ressourcenmodell

Vor jedem Start muss Codee schätzen:

```text
GGUF-Modellgröße
Quantisierung
GPU-Layer
KV-Cache
Kontextgröße
Batchgröße
Compute-Buffer
Vulkan-Overhead
freier VRAM
VRAM-Sicherheitsreserve
freier RAM
RAM-Sicherheitsreserve
bereits laufende Runtimes
```

Contract:

```typescript
interface RuntimeResourceEstimate {
  modelRamMb: number;
  modelVramMb: number;
  kvCacheRamMb: number;
  kvCacheVramMb: number;
  computeBufferMb: number;
  driverReserveMb: number;
  totalRamMb: number;
  totalVramMb: number;
  fitsRam: boolean;
  fitsVram: boolean;
  confidence: "low" | "medium" | "high";
  warnings: string[];
}
```

Standardreserven:

```text
VRAM: 512 MB
RAM: 6144 MB
```

---

# 5. GPU-Layer-Benchmark

Codee darf `--n-gpu-layers` nicht dauerhaft raten.

Benchmarkablauf:

```text
1. konservativ starten
2. Readiness prüfen
3. kurzen Prompt senden
4. First-Token-Zeit messen
5. Tokens/s messen
6. VRAM-Fehler erkennen
7. GPU-Layer erhöhen
8. letzten stabilen Wert speichern
```

Teststufen:

```text
8
16
24
32
vollständig
```

Je nach Modellarchitektur können andere Stufen verwendet werden.

Abbruchkriterien:

```text
Vulkan allocation failed
out of memory
Modellstart fehlgeschlagen
Timeout
Prozessabbruch
instabile Antwort
```

Der letzte stabile Wert wird pro Modell und Kontextgröße gespeichert.

---

# 6. Empfohlene Startprofile

## 6.1 CPU 7B

```powershell
llama-server.exe `
  --model "D:\Models\Qwen\Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf" `
  --alias "Qwen2.5-Coder-7B-CPU" `
  --host 127.0.0.1 `
  --port 8082 `
  --ctx-size 8192 `
  --threads 5 `
  --threads-batch 6 `
  --batch-size 128 `
  --ubatch-size 64 `
  --n-gpu-layers 0 `
  --parallel 1 `
  --cache-type-k q8_0 `
  --cache-type-v q8_0 `
  --jinja
```

Ziel:

```text
7B bleibt im RAM
NVIDIA-VRAM bleibt vollständig für fast_gpu
```

---

## 6.2 GPU 2B

```powershell
llama-server.exe `
  --model "D:\Models\Qwen\Qwen3.5-2B-Q5_K_M.gguf" `
  --alias "Qwen3.5-2B-GPU" `
  --host 127.0.0.1 `
  --port 8081 `
  --ctx-size 8192 `
  --threads 3 `
  --threads-batch 4 `
  --batch-size 128 `
  --ubatch-size 64 `
  --parallel 1 `
  --main-gpu 0 `
  --flash-attn auto `
  --cache-type-k q8_0 `
  --cache-type-v q8_0 `
  --jinja
```

`--n-gpu-layers` wird aus dem gespeicherten Benchmarkprofil ergänzt.

---

## 6.3 GPU 3B

Für:

```text
Qwen2.5-Coder-3B-Instruct Q4_K_M
```

Start zunächst mit:

```text
ctx-size: 4096
batch-size: 96
ubatch-size: 48
parallel: 1
```

Nach bestandenem Stabilitätstest darf auf 8192 Kontext erhöht werden.

---

# 7. Model Catalog

Beispiel fast_gpu:

```json
{
  "id": "qwen35-2b-q5km",
  "displayName": "Qwen3.5 2B Q5_K_M",
  "path": "D:/Models/Qwen/Qwen3.5-2B-Q5_K_M.gguf",
  "provider": "llama.cpp",
  "quantization": "Q5_K_M",
  "roles": [
    "runtime_chat",
    "orchestrator",
    "planner"
  ],
  "preferredSlot": "fast_gpu",
  "contextRecommended": 8192,
  "enabled": true
}
```

Beispiel quality_cpu:

```json
{
  "id": "qwen25-coder-7b-q4km",
  "displayName": "Qwen2.5 Coder 7B Q4_K_M",
  "path": "D:/Models/Qwen/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf",
  "provider": "llama.cpp",
  "quantization": "Q4_K_M",
  "roles": [
    "coder",
    "reviewer",
    "debugger"
  ],
  "preferredSlot": "quality_cpu",
  "contextRecommended": 8192,
  "recommendedGpuLayers": 0,
  "enabled": true
}
```

---

# 8. Task Routing

Aufgabentypen:

```typescript
type ModelTaskType =
  | "casual_chat"
  | "status"
  | "summarize"
  | "intent_routing"
  | "planning"
  | "small_code_change"
  | "large_code_change"
  | "debugging"
  | "review"
  | "architecture"
  | "embedding"
  | "reranking";
```

Routing:

```text
casual_chat
→ fast_gpu

status
→ fast_gpu

summarize
→ fast_gpu

intent_routing
→ fast_gpu

planning
→ fast_gpu oder quality_cpu je nach Komplexität

small_code_change
→ fast_gpu

large_code_change
→ quality_cpu

debugging
→ quality_cpu

review
→ quality_cpu

architecture
→ quality_cpu

embedding
→ utility

reranking
→ utility
```

---

# 9. Automatikmodi

```text
Auto – Schnell
Auto – Ausgewogen
Auto – Qualität
Manuell
```

## Auto – Schnell

```text
fast_gpu bevorzugen
quality_cpu nicht automatisch starten
maximal 8K Kontext
```

## Auto – Ausgewogen

```text
fast_gpu für Chat und kleine Aufgaben
quality_cpu für große Aufgaben
Eskalation erlaubt
```

## Auto – Qualität

```text
quality_cpu für Coding, Debugging und Review
fast_gpu für Routing und Status
```

## Manuell

```text
festes Modell
keine automatische Umschaltung
```

---

# 10. Eskalation

Beispiel:

```text
1. fast_gpu bearbeitet kleine Codeänderung
2. Typecheck schlägt fehl
3. fast_gpu darf einmal korrigieren
4. erneut fehlgeschlagen
5. quality_cpu wird vorgeschlagen
6. Handover wird erzeugt
7. 7B-Modell übernimmt
```

Maximal:

```text
fast_gpu: 2 Versuche
quality_cpu: 2 Versuche
```

Kein endloser Wechsel.

---

# 11. Handover

```typescript
interface ModelHandover {
  sourceModelId: string;
  targetModelId: string;
  goal: string;
  completedSteps: string[];
  relevantFiles: string[];
  proposedChanges: string[];
  testResults: string[];
  unresolvedErrors: string[];
  contextSummary: string;
}
```

Keine vollständige rohe Chat-Historie übertragen.

Nur verdichteten Arbeitszustand.

---

# 12. Runtime Slots

```typescript
type RuntimeSlotId =
  | "fast_gpu"
  | "quality_cpu"
  | "utility";

interface RuntimeSlot {
  id: RuntimeSlotId;
  port: number;
  devicePolicy: "gpu" | "cpu" | "auto";
  activeModelId: string | null;
  state:
    | "stopped"
    | "starting"
    | "probing"
    | "ready"
    | "busy"
    | "stopping"
    | "error";
  endpoint: string | null;
  pid: number | null;
  startedAt: string | null;
  lastUsedAt: string | null;
  error: string | null;
}
```

Ports:

```text
fast_gpu: 8081
quality_cpu: 8082
utility: 8083
```

---

# 13. Readiness

Ein Prozessstatus allein reicht nicht.

Prüfen:

```text
Prozess läuft
Endpoint erreichbar
Modell geladen
Chat-Completion funktioniert
First Token kommt
```

Status:

```text
process_running
endpoint_reachable
model_loaded
chat_ready
busy
unresponsive
```

---

# 14. Idle Management

```text
fast_gpu:
20 Minuten

quality_cpu:
8 Minuten

utility:
60 Sekunden
```

Nicht entladen bei:

```text
aktivem Run
laufendem Tool Call
laufendem Stream
Review Gate
Handover
Benchmark
```

---

# 15. Transparenz

Jede Auswahl muss im Chat sichtbar sein:

```text
Modell:
Qwen2.5-Coder-7B Q4_K_M

Slot:
quality_cpu

Grund:
• große Coding-Aufgabe
• mehrere Dateien
• Review angefordert
• NVIDIA-GPU bleibt für fast_gpu reserviert

Hardware:
• CPU
• 5 Threads
• 8192 Kontext
```

Kein stiller Wechsel.

---

# 16. Cloud-Regel

```text
localOnly = true
```

Nie automatisch Quellcode an Cloud senden.

Bei lokalem Fehler:

```text
anderes lokales Modell anbieten
kleineres Modell anbieten
Runtime-Neustart anbieten
```

Cloud nur nach ausdrücklicher Zustimmung.

---

# 17. UI-Anforderungen

Runtime-Cockpit:

```text
Fast GPU
Quality CPU
Utility
```

Je Slot:

```text
Modell
Status
Port
PID
Gerät
Kontext
GPU-Layer
RAM
VRAM
First Token
Tokens/s
Start
Stopp
Benchmark
```

Zusätzlich:

```text
Warum dieses Modell?
Warum dieser Slot?
Warum CPU statt GPU?
Warum Utility auf CPU?
```

---

# 18. Implementierungsphasen

## Phase A — Audit

Erstelle:

```text
docs/AUTOMATIC_MODEL_HANDLING_AUDIT.md
```

Keine Implementierung vorher.

## Phase B — Contracts

```text
RuntimeSlot
HardwareProfile
RuntimeResourceEstimate
ModelRuntimeProfile
ModelSelectionDecision
ModelHandover
```

## Phase C — Multi-Runtime

```text
fast_gpu
quality_cpu
utility
```

## Phase D — Hardware und Ressourcen

```text
AMD iGPU als Display-GPU erkennen
NVIDIA als Compute-GPU markieren
VRAM-Budget berechnen
```

## Phase E — Policy Engine

```text
Task Classification
Model Routing
sichtbare Begründung
manueller Override
```

## Phase F — Lifecycle

```text
Start
Readiness
Stop
Idle Unload
Recovery
```

## Phase G — Benchmark

```text
GPU-Layer
First Token
Tokens/s
Stabilität
```

## Phase H — Eskalation

```text
fast_gpu → quality_cpu
Handover
Versuchslimits
```

## Phase I — Utility Runtime

```text
Embedding
Reranker
CPU-Fallback
On-demand
```

## Phase J — UI

```text
Runtime Slots
Policy
Benchmark
Diagnose
```

---

# 19. Tests

Mindestens:

```text
HardwareProfiler tests
ResourceEstimator tests
RuntimeSlotManager tests
TaskClassifier tests
ModelPolicyEngine tests
ModelBroker tests
IdleManager tests
Handover tests
Parallel CPU/GPU tests
```

Wichtige Tests:

```text
AMD iGPU ist Display-GPU
NVIDIA ist Compute-GPU
```

```text
7B CPU und 2B GPU laufen gleichzeitig
```

```text
GPU-Utility-Start wird verhindert, wenn Reserve unterschritten wird
```

```text
kleine Chatnachricht nutzt fast_gpu
```

```text
große Coding-Aufgabe nutzt quality_cpu
```

```text
kein Cloud-Fallback
```

---

# 20. Manuelle Abnahme

## Test 1

```text
AMD iGPU treibt Monitore
NVIDIA ohne Desktoplast
```

Erwartung:

```text
Codee erkennt NVIDIA als dedizierte Compute-GPU
```

## Test 2

```text
Qwen3.5-2B auf fast_gpu starten
```

Erwartung:

```text
GPU-Ready
VRAM-Reserve bleibt erhalten
```

## Test 3

```text
Qwen2.5-Coder-7B auf quality_cpu starten
```

Erwartung:

```text
CPU-Ready
NVIDIA bleibt für fast_gpu verfügbar
```

## Test 4

```text
beide gleichzeitig anfragen
```

Erwartung:

```text
unabhängige Antworten
keine Portkollision
keine gegenseitige Beendigung
```

## Test 5

```text
Embedding oder Reranker anfordern
```

Erwartung:

```text
CPU oder Utility-Slot
kein VRAM-Overcommit
```

---

# 21. Qualitätsgates

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

Manuelle CPU-/GPU-Tests als:

```text
PASS
FAIL
NOT RUN
```

dokumentieren.

---

# 22. Definition of Done

- [ ] AMD-iGPU wird als Display-GPU behandelt.
- [ ] NVIDIA GTX 1650 SUPER wird als dedizierte Compute-GPU behandelt.
- [ ] 7B-Modell läuft auf CPU/RAM.
- [ ] 2B- oder 3B-Modell läuft parallel auf NVIDIA.
- [ ] GPU-VRAM wird nicht anhand der Dateigröße allein bewertet.
- [ ] KV-Cache und Compute-Buffer werden berücksichtigt.
- [ ] VRAM-Sicherheitsreserve bleibt erhalten.
- [ ] GPU-Layer werden benchmarkbasiert gespeichert.
- [ ] Runtime-Slots sind unabhängig.
- [ ] Keine Portkollisionen.
- [ ] Kein stiller Modellwechsel.
- [ ] Kein stiller Cloud-Fallback.
- [ ] Utility-Modelle werden on demand geladen.
- [ ] Modellwahl ist sichtbar begründet.
- [ ] Typecheck, Tests und Build sind grün.
- [ ] Manuelle Tests 1–5 sind dokumentiert.

---

# 23. Abschlussbericht

Am Ende liefern:

```text
1. Ausgangszustand
2. Hardwareerkennung
3. Display-GPU und Compute-GPU
4. Runtime Slots
5. Ressourcenberechnung
6. GPU-Layer-Benchmark
7. CPU-/GPU-Parallelbetrieb
8. Routingregeln
9. Utility Runtime
10. Handover und Eskalation
11. UI und Transparenz
12. Testresultate
13. Manueller Test 1
14. Manueller Test 2
15. Manueller Test 3
16. Manueller Test 4
17. Manueller Test 5
18. Bekannte Restprobleme
19. Ehrlicher Readiness-Status
```
