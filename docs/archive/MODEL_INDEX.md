# Local Model Index

Quellen:

- `D:\Models`
- `G:\Ollama`

Der DBZS Code Assistant indexiert lokale Modelle dynamisch ueber das Backend.
Dabei wird zuerst `D:\Models\models.catalog.json` genutzt. Falls diese Datei
fehlt, scannt die App direkt nach `.gguf`- und `.safetensors`-Artefakten.
Zusaetzlich werden Ollama-Manifeste aus dem Ollama-Modellstore eingelesen.
Der Store wird ueber `DBZS_OLLAMA_MODELS_DIR`, danach `OLLAMA_MODELS`,
danach `G:\Ollama\models`, danach `%USERPROFILE%\.ollama\models` ermittelt.

## Aktueller Befund

- Gesamt: 206 Modelle/Artefakte
- GGUF: 206
- llama-server bereit: 127
- Ollama bereit: dynamisch aus `G:\Ollama`
- Coding-Kandidaten: 24
- Vision-Kandidaten: 36
- Adapter/LoRA/MMProj-Support-Artefakte: 10
- Nicht direkt verwendbar: 4

## Runtime-Zuordnung

- `primary_coding`: sofort fuer Coding/Agenten priorisieren, wenn Health `ok`
- `coding_candidate`: Coding-Modell, aber noch nicht bestaetigt
- `chat_candidate`: allgemeines Chat-/Instruction-Modell
- `review_agent`: Review-, Summary- oder Klassifikationsmodell
- `vision_candidate`: Vision/VL-Modell, ggf. mit `mmproj`
- `embedding` / `reranker`: spaeter fuer Retrieval und Ranking
- `media_pipeline`: Diffusion/Video/Audio; nicht ueber `llama-server`
- `adapter_only`: LoRA/Adapter/MMProj, nur zusammen mit Basismodell

## Empfohlene erste Integration

Fuer Phase 3 sollte die App zuerst `primary_coding`-Modelle mit
`compatibility = llama_server_ready` anbieten. Damit sind lokale Coding-Modelle
direkt fuer Chat, Code-Erklaerung und spaeter Agentenrouting nutzbar.

Aus dem aktuellen Index sind die ersten geeigneten Kandidaten:

- `Base-Roblox-coder-Llama-3.2-3B-vLLM-Q3_K_M`
- `ByteDance-Seed.Stable-DiffCoder-8B-Instruct.Q2_K`
- `Code-Ricky-Llama-3.2.f16`
- `Codestral-22B-v0.1-Q4_K_M`
- `deepseek-coder-6.7b-instruct.Q4_K_M`
- `DeepSeek-Coder-V2-Lite-Instruct-Q2_K`
- `ggml-org_Qwen2.5-Coder-3B-Instruct-Q8_0-GGU`
- `Qwen2.5-Coder`-Varianten

## App-Anbindung

Backend:

- `GET /models/index`
- nutzt `DBZS_MODELS_DIR`, Default `D:\Models`
- liefert Summary, Modellliste, Runtime-Hints und empfohlene Verwendung

Renderer:

- `window.dbzs.getModelIndex()`
- Modellstatus in der Topbar
- Modellindex im AI/Agents-Panel
- erster Coding-Kandidat als aktueller lokaler Provider-Kontext

Runtime:

- `window.dbzs.getRuntimeStatus()`
- `window.dbzs.startRuntimeModel(modelId)`
- `window.dbzs.stopRuntimeModel()`
- startet genau einen lokalen `llama-server`-Prozess bewusst per UI-Aktion
- erkennt Ollama-Modelle als `runtime_launcher = ollama`
- startet `G:\Ollama\ollama.exe serve`, wenn Ollama nicht bereits auf
  `127.0.0.1:11434` aktiv ist
- setzt `OLLAMA_MODELS` auf den erkannten Modellstore
- nutzt fuer Ollama-Chat den lokalen Endpunkt `/api/chat`
