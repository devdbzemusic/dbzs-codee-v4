# DBZS Runtime Management

**Dokument-Version:** 1.0  
**Letzte Aktualisierung:** 2026-06-11  
**Geltungsbereich:** Model-Runtime, llama-server, Ollama

---

## 1. Übersicht

Das DBZS Runtime-System verwaltet lokale AI-Modelle und stellt sie für Agents und Chat zur Verfügung.

**Unterstützte Runtime-Provider:**
- `llama-server` (llama.cpp) — Für GGUF-Modelle
- `Ollama` — Für Ollama-Manifest-Modelle

---

## 2. Architektur

```
┌─────────────────────────────────────────────────────────────┐
│  Desktop App (Renderer)                                     │
│  - Model-Auswahl im UI                                      │
│  - Runtime-Status-Anzeige                                   │
└─────────────────────────────────────────────────────────────┘
                          ↓ IPC
┌─────────────────────────────────────────────────────────────┐
│  Electron Main Process                                      │
│  - Backend API Calls                                        │
└─────────────────────────────────────────────────────────────┘
                          ↓ HTTP (127.0.0.1:8876)
┌─────────────────────────────────────────────────────────────┐
│  FastAPI Backend                                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  RuntimeService                                       │  │
│  │  - Process-Management (llama-server, Ollama)          │  │
│  │  - Health-Checks                                      │  │
│  │  - Chat-Proxy                                         │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          ↓ subprocess
┌─────────────────────────────────────────────────────────────┐
│  Externe Prozesse                                           │
│  - llama-server.exe --model coder.gguf --port 8091          │
│  - ollama.exe serve (Port 11434)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Konfiguration

### 3.1 Umgebungsvariablen

| Variable | Zweck | Default | Beispiel |
|----------|-------|---------|----------|
| `DBZS_MODELS_DIR` | Basis-Pfad für Modelle | `D:\Models` | `E:\AI\Models` |
| `DBZS_OLLAMA_DIR` | Ollama-Installationsverzeichnis | `G:\Ollama` | `C:\Programs\Ollama` |
| `DBZS_OLLAMA_MODELS_DIR` | Ollama-Modell-Speicher | Siehe Code | `D:\Ollama\Models` |
| `OLLAMA_MODELS` | Ollama-Umgebungsvariable | — | `D:\Ollama\Models` |

### 3.2 Model-Verzeichnis-Struktur

```
D:\Models\
├── models.catalog.json       # Modell-Katalog (Pflicht)
├── models.runtime.json       # Runtime-Konfiguration
├── models.state.json         # Health-State
├── llama.cpp-win-runtime\
│   └── llama-server.exe      # llama-server Binary
├── coder.gguf                # GGUF-Modell
└── reviewer.gguf             # weiteres Modell
```

### 3.3 models.catalog.json

```json
{
  "base_dir": "D:/Models",
  "runtime_dir": "D:/Models/llama.cpp-win-runtime",
  "artifacts": [
    {
      "id": "coder",
      "name": "Coder Q4",
      "artifact_type": "model",
      "role": "CODE_MODEL",
      "capabilities": ["chat", "code"],
      "modality": ["text"],
      "file_path": "D:/Models/coder.gguf",
      "size_bytes": 4294967296,
      "quantization": "Q4_K_M",
      "backend": "llama.cpp",
      "loader": {
        "launcher": "llama-server"
      }
    }
  ]
}
```

### 3.4 models.runtime.json

```json
{
  "artifacts": [
    {
      "id": "coder",
      "runtime": {
        "ctx": 4096,
        "gpu_layers": 12,
        "n_threads": 8
      },
      "server": {
        "enabled": true,
        "preferred_port": 8091
      }
    }
  ]
}
```

---

## 4. Runtime-Steuerung

### 4.1 Model Starten

**UI-Weg:**
1. Runtime-Panel öffnen
2. Gewünschtes Modell auswählen
3. "Start" klicken
4. Status wechselt zu `running` mit Endpoint-URL

**API-Weg:**
```bash
curl -X POST http://127.0.0.1:8876/runtime/start \
  -H "Content-Type: application/json" \
  -d '{"model_id": "coder"}'
```

### 4.2 Model Stoppen

**UI-Weg:**
1. Runtime-Panel → "Stop" klicken

**API-Weg:**
```bash
curl -X POST http://127.0.0.1:8876/runtime/stop
```

### 4.3 Runtime-Status

```bash
curl http://127.0.0.1:8876/runtime/status
```

**Response:**
```json
{
  "state": "running",
  "model_id": "coder",
  "model_name": "Coder Q4",
  "provider": "llama.cpp",
  "port": 8091,
  "endpoint": "http://127.0.0.1:8091"
}
```

---

## 5. llama-server Konfiguration

### 5.1 Start-Command (automatisch generiert)

```bash
llama-server.exe \
  -m D:/Models/coder.gguf \
  --host 127.0.0.1 \
  --port 8091 \
  --ctx-size 4096 \
  --gpu-layers 12 \
  --threads 8
```

### 5.2 Parameter-Übersicht

| Parameter | Config-Key | Default | Beschreibung |
|-----------|------------|---------|--------------|
| `--ctx-size` | `runtime.ctx` | 4096 | Kontext-Fenster in Tokens |
| `--gpu-layers` | `runtime.gpu_layers` | 0 | GPU-Offloading-Layer |
| `--threads` | `runtime.n_threads` | CPU-Kerne | CPU-Threads |
| `--port` | `server.preferred_port` | 8091 | HTTP-Port |

### 5.3 Performance-Empfehlungen

| Hardware | gpu_layers | ctx_size | threads |
|----------|------------|----------|---------|
| CPU-only | 0 | 2048 | Anzahl Kerne |
| 4GB VRAM | 12 | 4096 | Anzahl Kerne |
| 8GB VRAM | 24 | 8192 | Anzahl Kerne |
| 16GB+ VRAM | 32+ | 16384 | Anzahl Kerne |

---

## 6. Ollama Konfiguration

### 6.1 Voraussetzung

- Ollama installiert (siehe [ollama.com](https://ollama.com))
- `OLLAMA_MODELS` Umgebungsvariable gesetzt (optional)
- Modell via `ollama pull` heruntergeladen

### 6.2 Modell-Registrierung

Ollama-Modelle werden automatisch erkannt via:

```
<OLLAMA_MODELS_DIR>/manifests/registry.ollama.ai/<namespace>/<name>/<tag>
```

Beispiel:
```
D:/Ollama/models/manifests/registry.ollama.ai/library/qwen2.5-coder/latest
```

### 6.3 Start-Command

```bash
ollama.exe serve
```

Ollama läuft standardmäßig auf `http://127.0.0.1:11434`.

### 6.4 Chat mit Ollama

```bash
curl http://127.0.0.1:11434/api/chat -d '{
  "model": "qwen2.5-coder",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": false
}'
```

---

## 7. Troubleshooting

### 7.1 Runtime startet nicht

**Symptom:** Status bleibt `stopped` oder `error`

**Ursachen:**
1. Modell-Pfad existiert nicht
2. llama-server.exe fehlt
3. Port bereits belegt
4. GGUF-Datei korrupt

**Diagnose:**
```bash
# Backend-Logs prüfen
Get-Content $env:LOCALAPPDATA\DBZS\CodeAssistant\*.log

# Port-Belegung prüfen
netstat -ano | findstr :8091

# Modell-Pfad prüfen
Test-Path "D:/Models/coder.gguf"
```

**Lösung:**
1. Pfad in `models.catalog.json` korrigieren
2. llama.cpp von [GitHub Releases](https://github.com/ggerganov/llama.cpp/releases) herunterladen
3. Anderen Port in `models.runtime.json` konfigurieren
4. Modell neu herunterladen

### 7.2 Ollama wird nicht erkannt

**Symptom:** Ollama-Modelle erscheinen nicht im Index

**Ursachen:**
1. `OLLAMA_MODELS` nicht gesetzt
2. Manifest-Verzeichnis falsch strukturiert
3. Ollama-Executable nicht gefunden

**Diagnose:**
```bash
# Ollama-Verzeichnis prüfen
Test-Path "G:/Ollama/ollama.exe"

# Models-Verzeichnis prüfen
Test-Path "D:/Ollama/models"

# Manifest prüfen
Get-Content "D:/Ollama/models/manifests/registry.ollama.ai/library/qwen2.5-coder/latest"
```

**Lösung:**
```bash
# Umgebungsvariable setzen (PowerShell)
$env:OLLAMA_MODELS = "D:/Ollama/models"

# In DBZS config:
DBZS_OLLAMA_MODELS_DIR=D:/Ollama/models
```

### 7.3 Chat-Antworten langsam

**Ursachen:**
1. Zu großer Kontext (`ctx_size`)
2. GPU-Layers zu niedrig
3. CPU-Threads suboptimal

**Lösung:**
```json
// models.runtime.json anpassen
{
  "artifacts": [{
    "id": "coder",
    "runtime": {
      "ctx": 2048,
      "gpu_layers": 24,
      "n_threads": 8
    }
  }]
}
```

### 7.4 Runtime stürzt ab

**Symptom:** Prozess endet unerwartet, Status `stopped`

**Ursachen:**
1. OOM (Out of Memory)
2. GPU-Treiber-Problem
3. Korruptes Modell

**Diagnose:**
```bash
# Event Viewer prüfen (Windows)
eventvwr.msc → Windows Logs → Application

# RAM-Auslastung prüfen
Task Manager → Performance → Memory
```

**Lösung:**
1. `ctx_size` reduzieren
2. `gpu_layers` reduzieren oder auf 0 setzen (CPU-only)
3. Modell neu validieren/downloaden

---

## 8. Runtime-Chat API

### 8.1 Request

```typescript
POST /runtime/chat
Content-Type: application/json

{
  "messages": [
    {"role": "user", "content": "Erkläre diese Funktion"}
  ],
  "file_context": {
    "path": "D:/Dev/repo/app.ts",
    "language": "typescript",
    "content": "export function add(a: number, b: number): number { ... }"
  },
  "temperature": 0.7,
  "max_tokens": 1024
}
```

### 8.2 Response

```json
{
  "message": {
    "role": "assistant",
    "content": "Diese Funktion addiert zwei Zahlen..."
  },
  "model_id": "coder",
  "model_name": "Coder Q4"
}
```

### 8.3 Error-Cases

| Status | Bedeutung | Handlung |
|--------|-----------|----------|
| 409 | Runtime nicht gestartet | Model starten |
| 500 | Request fehlgeschlagen | Logs prüfen |

---

## 9. Best Practices

### 9.1 Entwicklungsumgebung

- **Empfohlen:** CPU-only oder niedrige GPU-Layers für Stabilität
- **Ctx-Size:** 2048-4096 für Code-Reviews
- **Threads:** Anzahl physischer CPU-Kerne

### 9.2 Produktivumgebung

- **Empfohlen:** Maximale GPU-Auslastung
- **Ctx-Size:** 8192+ für komplexe Tasks
- **Dedizierter Port:** Pro Modell separaten Port verwenden

### 9.3 Ressourcen-Monitoring

```bash
# llama-server Prozess überwachen
Get-Process llama-server | Select-Object CPU,WorkingSet

# Ollama Prozess überwachen
Get-Process ollama | Select-Object CPU,WorkingSet
```

---

## 10. Sicherheit

### 10.1 Localhost-Only

Runtime-Server binden ausschließlich an `127.0.0.1`:

```bash
llama-server --host 127.0.0.1
ollama serve (default 127.0.0.1:11434)
```

### 10.2 Keine externen Requests

- Runtime akzeptiert nur lokale Connections
- Keine Cloud-Modelle ohne explizite Konfiguration
- API-Keys nur für Cloud-Fallback (optional)

---

## 11. Referenzen

- [llama.cpp Dokumentation](https://github.com/ggerganov/llama.cpp)
- [Ollama Dokumentation](https://ollama.com/)
- `docs/ARCHITECTURE.md` — Gesamtarchitektur
- `docs/SECURITY.md` — Sicherheitsmodell

---

## 12. Änderungshistorie

| Version | Datum | Autor | Änderung |
|---------|-------|-------|----------|
| 1.0 | 2026-06-11 | Codex | Initialversion nach Code Review |

