# Codee – Bereinigte Downloadliste brauchbarer Agentic-Modelle

## Zielhardware

- AMD Ryzen 5 5600G
- 32 GB RAM
- NVIDIA GTX 1650 SUPER
- 4 GB VRAM
- Windows 11
- bevorzugte Runtime: llama.cpp / GGUF

## Sofort herunterladen – Priorität A

### 1. `InternScience/Agents-A1-4B-Q4_K_M-GGUF`

**Hauptagent für Codee**

Geeignet für:

- Planung
- Tool Calling
- Engineering
- Repository-Fragen
- Recherche
- wissenschaftliche Aufgaben
- längere Agentenabläufe
- Codegenerierung

Warum herunterladen:

- offizielles Modell
- Apache-2.0
- 4B Parameter
- speziell für Long-Horizon-Agenten trainiert
- veröffentlichte Benchmarks
- Q4_K_M passt wesentlich besser zu 4 GB VRAM als Q8_0

Codee-Rolle:

```text
MAIN_ENGINEERING_AGENT
LONG_HORIZON_AGENT
TOOL_ORCHESTRATOR
```

Priorität:

```text
1
```

---

### 2. `openbmb/AgentCPM-Explore-GGUF`

**Bester Recherche- und Explorer-Agent aus den Listen**

Empfohlene Datei:

```text
AgentCPM-Explore.Q4_K_M.gguf
```

Geeignet für:

- Deep Research
- Repository-Erkundung
- Web- und Dokumentensuche
- Quellenprüfung
- lange Read-only-Agentenläufe
- mehrstufige Untersuchung unbekannter Projekte

Warum herunterladen:

- offizielles OpenBMB-Modell
- 4B Parameter
- für Long-Horizon-Agentenbenchmarks entwickelt
- vollständig dokumentierte Agentenfamilie
- lokale GGUF-Version vorhanden

Codee-Rolle:

```text
DEEP_RESEARCH_AGENT
REPOSITORY_EXPLORER
READ_ONLY_LONG_HORIZON_AGENT
```

Priorität:

```text
2
```

---

### 3. `agentscope-ai/QwenPaw-Flash-2B-Q4_K_M`

**Schneller lokaler Alltagsagent**

Geeignet für:

- Tool Routing
- Kommandoplanung
- Memory-Verwaltung
- einfache Mehrschrittaufgaben
- schneller Read-only-Agent
- Dispatcher zwischen Nutzer und Spezialagenten

Warum herunterladen:

- nur etwa 1,45 GB
- vollständiges GPU-Offloading sehr wahrscheinlich
- speziell für autonome Agentenszenarien optimiert
- schneller als die 4B-Hauptagenten
- sinnvoller Mittelbau zwischen 1B und 4B

Codee-Rolle:

```text
FAST_GENERAL_AGENT
TOOL_ROUTER
MEMORY_WORKER
```

Priorität:

```text
3
```

---

### 4. `ewinregirgojr/MiniCPM5-1B-Agentic-Tooluse-GGUF`

Empfohlene Quantisierung:

```text
Q4_K_M
```

**Ultraleichter Tool-Agent**

Geeignet für:

- Function Calling
- Tool-Auswahl
- Argumente vorbereiten
- einfache Datei- und Symbolsuche
- Task-Klassifikation
- dauerhaft geladener Nebenagent

Warum herunterladen:

- nur ungefähr 1B Parameter
- sehr niedriger RAM-/VRAM-Bedarf
- explizites Tool-Use-Fine-Tuning
- schnelle lokale Reaktion
- ideal als erste Agentenstufe

Codee-Rolle:

```text
MICRO_TOOL_AGENT
FUNCTION_CALL_ROUTER
FAST_DISPATCHER
```

Priorität:

```text
4
```

---

### 5. `S4MPL3BI4S/Nemotron-3-Nano-4B-Coding-Agent-GGUF`

**Coding- und Tool-Executor**

Geeignet für:

- Python-Code
- Function Calling
- kleine Bugfixes
- Codegenerierung
- Coding-Aufgaben hinter einem Planner
- strukturierte Coding-Aktionen

Warum herunterladen:

- moderne Nemotron-Hybridbasis
- Q4_K_M
- auf Python Function Calling trainiert
- llama.cpp-kompatibel
- sinnvolle Ergänzung zu Agents-A1

Einschränkung:

- Community-Fine-Tune
- muss gegen das offizielle Nemotron-3-Nano-4B getestet werden
- nicht ungeprüft mit Schreibrechten verwenden

Codee-Rolle:

```text
CODING_EXECUTOR
PYTHON_TOOL_WORKER
BUGFIX_AGENT
```

Priorität:

```text
5
```

## Ebenfalls sinnvoll – Priorität B

### 6. `agentscope-ai/QwenPaw-Flash-4B-Q4_K_M`

**Stärkere Alternative zum 2B-QwenPaw**

Geeignet für:

- komplexere Tool-Aufgaben
- stabilere Mehrschrittplanung
- Agentenaufgaben, bei denen 2B nicht genügt

Vorteil:

- etwa 2,84 GB
- vermutlich noch vollständig oder nahezu vollständig GPU-offloadbar

Nachteil:

- überschneidet sich stark mit Agents-A1-4B
- erst nach dem 2B-Modell laden

Codee-Rolle:

```text
FAST_GENERAL_AGENT_PLUS
```

Priorität:

```text
6
```

---

### 7. `openbmb/AgentCPM-Report-GGUF`

**Spezialist für lange Berichte**

Geeignet für:

- Entwicklungsstatusberichte
- Repository-Berichte
- Forschungsberichte
- Dokumentationssynthese
- lange strukturierte Ausgaben

Warum nur Priorität B:

- ungefähr 8B
- auf 4 GB VRAM nur Hybridbetrieb
- höhere Lade- und Antwortzeit
- sollte nur bei Bedarf gestartet werden

Codee-Rolle:

```text
REPORT_GENERATOR
DEEP_RESEARCH_SYNTHESIZER
DOCUMENTATION_AGENT
```

Priorität:

```text
7
```

---

### 8. `agentica-org/DeepCoder-1.5B-Preview`

**Kleiner Coding-Reasoning-Spezialist**

Geeignet für:

- Algorithmusaufgaben
- kleine Coding-Probleme
- alternative Lösungskandidaten
- Bewertung einfacher Implementierungen

Einschränkung:

- der sichtbare Eintrag ist nicht zwingend GGUF
- Runtime oder Konvertierung prüfen
- kein vollständiger Tool-Agent

Codee-Rolle:

```text
ALGORITHM_CODING_SPECIALIST
```

Priorität:

```text
8
```

## Nur optional herunterladen

### `agentica-org/DeepScaleR-1.5B-Preview`

- eher Reasoning als Tool-Agent
- nützlich als kleiner Planungs- oder Bewertungsworker
- nicht als Hauptagent

### `Nexlab/VibeThinker-Fable-Nano-Agentic-3B`

- größenmäßig interessant
- Community-Herkunft und Toolformat erst prüfen
- nur isoliert benchmarken

### `Frost2o24/llama-3.2-1b-mini-agent`

- kleiner Testkandidat
- gegen MiniCPM5-1B vergleichen
- ohne klaren Vorteil wieder aussortieren

### `armaanahuja7777/Qwen7B-SmartHome-Agent-GGUF`

- nur für Smart Home / IoT
- für Codees Kernentwicklung nicht notwendig

### `Merlin-Research/Merlin-Agent`

- wissenschaftlicher Spezialagent
- ungefähr 9B und daher schwer
- nur bei konkretem Research-Bedarf

## Nicht herunterladen

### Zu groß für einen reaktionsschnellen Codee-Betrieb

```text
Qwen-AgentWorld-35B
Qwen3.6-35B-A3B
AgentBench/xref-9B
Jack-Long-Agentic-27B
AgentLM-13B
AgentLM-70B
ToRA-Code-13B
ToRA-Code-34B
ToRA-70B
Gemma-4-12B-Agentic-Varianten
Ornith-35B
```

Sie können zwar teilweise im CPU-/RAM-Hybrid laufen, sind auf deiner Hardware aber
für interaktive Agentenarbeit zu langsam.

### Heretic, uncensored, abliterated und refusal-modifizierte Varianten

```text
Agents-A1-4B-Heretic
Agents-A1-4B-Abliterated
Agents-A1-Uncensored
Qwen-AgentWorld-Heretic
Huihui-Agent-Abliterated
Refusals8-Varianten
```

Gründe:

- absichtlich verändertes Sicherheitsverhalten
- unzuverlässige Tool-Entscheidungen möglich
- schlecht für Shell-, Git- und Dateischreibrechte
- schwer reproduzierbare Agentenreaktionen

### Alte Legacy-Agenten

```text
zai-org/agentlm-7b
zai-org/agentlm-13b
TheBloke/agentlm-7B
TheBloke/agentlm-13B
llm-agents/tora-7b-v1.0
llm-agents/tora-code-7b-v1.0
internlm/Agent-FLAN-7b
Zephyr-Agent-Fine-Tunes von 2023
Llama-2-Agent-Fine-Tunes
```

Diese Modelle sind höchstens als historische Benchmarks interessant.

### Keine generativen Agentenmodelle

Nicht als LLM-Agent herunterladen:

```text
CentralBankRoBERTa-agent-classifier
DPR question encoder
CamemBERT QA Encoder
Meta-agent-dense Classifier
ML-Agents-Pyramids
ML-Agents-SnowballTarget
PPO/DQN/Unity-Agenten
Bildklassifikatoren
Stable-Diffusion-Agent-Einträge
```

Das sind Klassifikatoren, Encoder, Reinforcement-Learning-Policies oder Bildmodelle,
keine lokalen Chat-/Tool-Agenten für Codee.

## Finale Downloadreihenfolge

```text
01 InternScience/Agents-A1-4B-Q4_K_M-GGUF
02 openbmb/AgentCPM-Explore-GGUF — Q4_K_M
03 agentscope-ai/QwenPaw-Flash-2B-Q4_K_M
04 ewinregirgojr/MiniCPM5-1B-Agentic-Tooluse-GGUF — Q4_K_M
05 S4MPL3BI4S/Nemotron-3-Nano-4B-Coding-Agent-GGUF
06 agentscope-ai/QwenPaw-Flash-4B-Q4_K_M
07 openbmb/AgentCPM-Report-GGUF — nur bei Bedarf
08 agentica-org/DeepCoder-1.5B-Preview — falls GGUF/Runtime passt
```

## Empfohlene produktive Agentenkette

```text
NUTZERANFRAGE
    │
    ▼
MiniCPM5-1B
Task-Klassifikation und Tool-Routing
    │
    ├── einfache Aufgabe ──► QwenPaw-Flash-2B
    │
    ├── komplexe Planung ──► Agents-A1-4B
    │
    ├── Recherche ─────────► AgentCPM-Explore
    │
    ├── Coding ────────────► Nemotron-3-Nano Coding Agent
    │
    └── Langbericht ───────► AgentCPM-Report
                               │
                               ▼
                    Validator / Compiler / Tests
```

## Downloadumfang

Ungefährer sinnvoller Kernbestand:

```text
Agents-A1-4B Q4_K_M          ca. 2,5–3,0 GB
AgentCPM-Explore Q4_K_M      ca. 2,5–3,0 GB
QwenPaw-Flash-2B Q4_K_M      ca. 1,45 GB
MiniCPM5-1B Q4_K_M           deutlich unter 1 GB
Nemotron-3-Nano-4B Q4_K_M    ca. 2,5–3,0 GB
```

Gesamt grob:

```text
ca. 10–12 GB
```

Damit bekommst du bereits eine vollständige lokale Agentenmannschaft.

## Codee-Zertifizierungsstufen

Jedes Modell startet mit:

```text
DOWNLOADED
→ METADATA_PARSED
→ LOAD_VERIFIED
→ TOOL_FORMAT_VERIFIED
→ READ_ONLY_VERIFIED
→ SANDBOX_WRITE_VERIFIED
→ REPOSITORY_WRITE_VERIFIED
```

Kein Modell erhält sofort Shell-, Git- oder Dateischreibrechte.

## Klare Empfehlung

Lade zuerst nur diese fünf:

```text
InternScience/Agents-A1-4B-Q4_K_M-GGUF
openbmb/AgentCPM-Explore-GGUF
agentscope-ai/QwenPaw-Flash-2B-Q4_K_M
ewinregirgojr/MiniCPM5-1B-Agentic-Tooluse-GGUF
S4MPL3BI4S/Nemotron-3-Nano-4B-Coding-Agent-GGUF
```

Diese fünf decken Planung, Tool Calling, Recherche, schnelle Alltagsaufgaben und
Coding ab, ohne deine Hardware unnötig mit alten oder übergroßen Modellen zu belasten.
