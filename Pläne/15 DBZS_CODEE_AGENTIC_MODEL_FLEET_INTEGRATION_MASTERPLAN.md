# DBZS Codee – Agentic Model Fleet Integration Masterplan

**Stand:** 01.08.2026  
**Ziel:** Die heruntergeladenen Agentic-Modelle inventarisieren, testen, profilieren, zertifizieren und rollenbasiert in Codee einsetzen.

## 1. Grundentscheidung

Die Modelle werden nicht als einfache Dropdown-Liste behandelt, sondern als verwaltete Agentenflotte:

```text
Quelle → Scan → Artefaktidentität → Metadaten → Runtime-Probe
→ Hardwareprofil → Benchmark → Zertifikat → Rolle → Routing
```

SQLite wird Source of Truth. JSON bleibt Import/Export und Diagnose.

## 2. Modellflotte und Rollen

| Modell | Primäre Rolle | Priorität |
|---|---|---:|
| InternScience Agents-A1-4B | Hauptagent, Planner, Tool-Orchestrator | A |
| AgentCPM-Explore | Deep Research, Repository Explorer | A |
| QwenPaw-Flash-2B | schneller General-Agent, Tool Router | A |
| MiniCPM5-1B Agentic Tooluse | Micro Tool Agent, Dispatcher | A |
| Nemotron-3-Nano-4B Coding Agent | Coding Executor, Bugfix Worker | A |
| QwenPaw-Flash-4B | stärkerer General-Agent | B |
| AgentCPM-Report | Langbericht, Dokumentationssynthese | On Demand |
| DeepCoder-1.5B | Algorithmus-/Coding-Spezialist | B |
| DeepScaleR-1.5B | Reasoning-/Bewertungsworker | B |
| VibeThinker-Fable-Nano-Agentic-3B | experimenteller Agent | Sandbox |
| llama-3.2-1b-mini-agent | Micro-Agent-Vergleich | Sandbox |
| Merlin-Agent | Research-Spezialist | On Demand |
| Qwen7B-SmartHome-Agent | IoT-/Smart-Home-Spezialist | Domain |

## 3. Zielrollen in Codee

```text
MAIN_AGENT              → Agents-A1-4B
DEEP_RESEARCH_AGENT     → AgentCPM-Explore
FAST_GENERAL_AGENT      → QwenPaw-Flash-2B
MICRO_TOOL_AGENT        → MiniCPM5-1B
CODING_EXECUTOR         → Nemotron-3-Nano-4B
ALGORITHM_SPECIALIST    → DeepCoder-1.5B
REASONING_VALIDATOR     → DeepScaleR-1.5B
REPORT_GENERATOR        → AgentCPM-Report
```

## 4. Gemeinsames Datenmodell

Neue beziehungsweise erweiterte Tabellen:

```text
model_sources
model_artifacts
model_bundles
logical_models
model_variants
runtime_adapters
runtime_presets
hardware_snapshots
probe_runs
benchmark_runs
benchmark_measurements
capability_evidence
certifications
model_role_assignments
model_failures
agent_execution_policies
```

Identitäten:

```text
artifact_id      = SHA-256 einer Datei
bundle_id        = Modell + Config + Tokenizer + LoRA/MMProj
logical_model_id = Modellfamilie unabhängig von Quantisierung
installation_id  = konkreter lokaler Pfad
```

Rollen werden nie allein aus Dateinamen vergeben.

## 5. Model Source Registry

Die heruntergeladenen Ordner werden als gemeinsame Quelle registriert, zum Beispiel:

```json
{
  "name": "Agentic Models",
  "path": "D:/Models/Agentic",
  "recursive": true,
  "enabled": true,
  "watch": true,
  "priority": 100,
  "include": ["*.gguf", "*.safetensors", "*.json"],
  "exclude": ["*.tmp", "*.part", ".cache/**"]
}
```

Zusätzliche Quellen:

```text
D:/Models
F:/Models
H:/Models
C:/dev/prj/models/gguf
Ollama Store
Hugging Face Cache
LM Studio Cache
```

Der Katalog darf den rekursiven Scan niemals verhindern.

## 6. Scan-Pipeline

```text
Dateisystemscan
→ SHA-256
→ GGUF-Metadaten
→ Shards/Varianten erkennen
→ Bundle gruppieren
→ Runtime-Kompatibilität
→ Status setzen
```

Pflichtmetadaten:

```text
general.name
general.architecture
general.file_type
general.quantization_version
general.license
general.source.url
general.base_model.*
tokenizer.chat_template
*.context_length
*.block_count
*.embedding_length
*.attention.head_count
*.attention.head_count_kv
```

Statuskette:

```text
DISCOVERED
IDENTIFIED
COMPATIBLE
LOADABLE
TUNED
BENCHMARKED
CERTIFIED
DEGRADED
QUARANTINED
UNSUPPORTED
```

## 7. Runtime-Konsolidierung

Ein gemeinsames Adapter-Interface:

```python
class RuntimeAdapter:
    def detect(self): ...
    def validate_artifact(self): ...
    def build_command(self): ...
    def probe_load(self): ...
    def health_check(self): ...
    def benchmark(self): ...
    def collect_metrics(self): ...
    def stop(self): ...
```

Reihenfolge:

```text
1. llama.cpp
2. Ollama
3. Transformers
4. vLLM
5. ONNX Runtime
6. Diffusers
7. Whisper
```

Für die aktuelle Flotte reicht zunächst llama.cpp.

## 8. GPU-Autotuning

```text
0 Layer
→ Startschätzung
→ binäre Suche
→ Sicherheitsreserve
→ Belastungstest
→ Profil speichern
```

Testmatrix:

```text
GPU-Layer: 0 / 8 / 16 / 24 / vollständig
Kontext:   2K / 4K / 8K / 16K
Batch:     64 / 128 / 256
UBatch:    32 / 64 / 128
KV Cache:  f16 / q8_0 / q4_0
Flash Attn: off / auto / on
```

Gespeicherte Profile:

```text
best_low_latency
best_throughput
safe_balanced
cpu_fallback
large_context
```

## 9. Capability-Zertifizierung

```text
CHAT_VERIFIED
INSTRUCTION_FOLLOWING_VERIFIED
STRUCTURED_OUTPUT_VERIFIED
TOOL_CALLING_VERIFIED
READ_ONLY_AGENT_VERIFIED
WRITE_AGENT_VERIFIED
CODING_VERIFIED
REPOSITORY_QA_VERIFIED
DEEP_RESEARCH_VERIFIED
LONG_HORIZON_VERIFIED
REPORT_GENERATION_VERIFIED
GPU_PROFILE_VERIFIED
```

## 10. Sicherheitsstufen

```text
LEVEL_0_CHAT_ONLY
LEVEL_1_READ_ONLY_TOOLS
LEVEL_2_SANDBOXED_WRITE
LEVEL_3_REPOSITORY_WRITE
LEVEL_4_SHELL_AND_GIT
```

Startfreigabe:

```text
Agents-A1             LEVEL_1
AgentCPM-Explore      LEVEL_1
QwenPaw-Flash-2B      LEVEL_1
MiniCPM5-1B           LEVEL_1
Nemotron Coding Agent LEVEL_2
AgentCPM-Report       LEVEL_0
Experimentalmodelle   LEVEL_0
```

## 11. Router

```text
Anfrage klassifizieren
→ Rolle bestimmen
→ zertifizierte Modelle filtern
→ Hardware-Fit prüfen
→ laufende Instanz bevorzugen
→ Qualität/Latenz gewichten
→ Modell auswählen
```

Beispiele:

```text
Repository untersuchen → AgentCPM-Explore
Backend-Refactor planen → Agents-A1-4B
Patch erzeugen          → Nemotron Coding Agent
Logik prüfen            → DeepScaleR
Bericht schreiben       → AgentCPM-Report
kleines Tool ausführen  → MiniCPM5-1B
schnelle Alltagsfrage   → QwenPaw-Flash-2B
```

## 12. Bridge-Integration

Verbindlicher Kommunikationsweg:

```text
React UI
→ typisierter Application Client
→ DesktopBridgeV1
→ zentrale IPC-Registry
→ Electron BackendTransport
→ FastAPI Model Lab API
```

Neue Operationen:

```text
listModelSources
addModelSource
startModelScan
getModelScanJob
listLogicalModels
getLogicalModel
probeModel
benchmarkModel
certifyModel
startModelRuntime
stopModelRuntime
assignModelRole
```

Jeder Request besitzt:

```text
requestId
operation
startedAt
timeoutPolicy
cancellation
structured error result
```

## 13. UI

```text
Inventory
Sources
Discovery Jobs
Compatibility
Tuning Lab
Benchmarks
Certification
Roles & Routing
Runtime
Failures
Metadata
```

Model Inspector:

```text
Overview
Files
GGUF Metadata
Capabilities
Runtime Profiles
Benchmarks
Certification
Role Assignments
Failures
Logs
```

## 14. Umsetzungsreihenfolge

### Phase 0 – Reparatur

1. Katalog und rekursiven Scan zusammenführen
2. `_from_filesystem()` implementieren/verifizieren
3. mehrere Modellquellen
4. UI-Slice entfernen
5. Ausschlussgründe anzeigen
6. `gpu_layers=None` nicht still zu CPU-only machen

### Phase 1 – Inventory MVP

1. `backend/app/model_lab/`
2. SQLite-Tabellen
3. SHA-256
4. Bundle-Gruppierung
5. Quellenverwaltung
6. Scan-Jobs
7. ModelLabTab

### Phase 2 – Runtime

1. llama.cpp-Adapter
2. zentraler Command Builder
3. Prozess-/Portverwaltung
4. Logs
5. Readiness
6. Runtime-Presets

### Phase 3 – Autotuning

1. Hardware Snapshot
2. CPU Safe Probe
3. GPU-Layer-Suche
4. Context-/Batch-Tuning
5. Profile persistieren

### Phase 4 – Benchmarks

1. technische Messwerte
2. Tool-Calling-Suite
3. Coding-Suite
4. Agenten-Loop-Suite
5. Vergleichsansicht

### Phase 5 – Zertifizierung und Routing

1. Zertifikate
2. Sicherheitslevel
3. Rollen
4. Router
5. Fallback-Ketten

## 15. Erste Testreihenfolge

```text
1. MiniCPM5-1B
2. QwenPaw-Flash-2B
3. Agents-A1-4B
4. AgentCPM-Explore
5. Nemotron Coding Agent
6. DeepCoder-1.5B
7. DeepScaleR-1.5B
8. QwenPaw-Flash-4B
9. AgentCPM-Report
10. Experimentalmodelle
```

## 16. Definition of Done

- alle Modellordner erkannt
- jede Datei hat SHA-256
- jedes Modell ist ein logisches Bundle
- Architektur/Quantisierung/Kontext stammen aus Metadaten
- jeder Kandidat besitzt Runtime-Status
- reale CPU-/GPU-Profile existieren
- Tool Calls werden maschinenlesbar validiert
- Rollen werden nur nach Zertifizierung vergeben
- keine ungeprüften Schreibrechte
- Router nutzt nur zertifizierte Modelle
- jeder Ausschlussgrund ist sichtbar
- Runtime-, Benchmark- und Routingdaten liegen in SQLite
- Frontend, Electron Bridge und Backend nutzen denselben typisierten Vertrag

## 17. Klare Startentscheidung

Zuerst produktiv integrieren:

```text
MiniCPM5-1B
QwenPaw-Flash-2B
Agents-A1-4B
AgentCPM-Explore
Nemotron-3-Nano-4B Coding Agent
```

Danach:

```text
DeepCoder
DeepScaleR
QwenPaw-Flash-4B
AgentCPM-Report
```

Rest zunächst:

```text
EXPERIMENTAL
DOMAIN_SPECIFIC
ON_DEMAND
```
