# DBZS Codee Model Operations Center
## WinUI-Tool für Erkennung, Analyse, Benchmarking und Verwaltung lokaler KI-Modelle

**Arbeitsname:** `DBZS Codee Model Lab`
**Alternative Namen:** `Codee Model Forge`, `Codee Model Inspector`, `Codee Model Operations Center`

---

## 1. Zielbild

Die Anwendung wird die zentrale lokale Modell-Schaltzentrale für Codee.

Sie soll:

- beliebig viele Modellordner rekursiv durchsuchen,
- Modellartefakte und zusammengehörige Dateien erkennen,
- Modelltyp, Architektur, Quantisierung, Modalitäten und Capabilities bestimmen,
- fehlende Informationen kontrolliert aus dem Web ergänzen,
- Modelle auf der vorhandenen Hardware reproduzierbar testen,
- CPU-, GPU- und Hybrid-Konfigurationen vergleichen,
- optimale Startparameter erzeugen,
- beschädigte, unvollständige oder doppelte Modelle erkennen,
- sämtliche Ergebnisse direkt in den Codee-Datenbestand schreiben,
- Codee eine belastbare Grundlage für automatisches Model Routing liefern.

Das Tool ist damit kein einfacher Dateiscanner, sondern ein lokales **Model Inventory, Certification & Runtime Optimization System**.

---

# 2. Architekturentscheidung

## Empfohlener Aufbau

### WinUI-Frontend
- C# / .NET
- WinUI 3
- MVVM
- CommunityToolkit.Mvvm
- Fluent Design
- Windows App SDK Stable
- native Windows Hardware-, Datei- und Prozessintegration

### Analyse- und Benchmark-Worker
Bestehendes Codee-Python-Backend weiterverwenden und erweitern:

- FastAPI
- Pydantic
- SQLite
- asynchrone Job Queue
- subprocess-basierte Runtime Adapter
- Hardware Telemetrie
- Web Enrichment

### Native Benchmark-Adapter
Separate Adapter je Laufzeit:

- llama.cpp / llama-bench / llama-server
- Ollama
- ONNX Runtime
- Transformers
- Diffusers
- Stable Diffusion Runtime
- Whisper / faster-whisper
- Piper / TTS
- optional vLLM, ExLlamaV2, TensorRT-LLM und DirectML

### Codee-Anbindung
Das WinUI-Tool schreibt nicht in eine eigene isolierte Datenwelt.

Es verwendet:

- dieselbe SQLite-Datenbank oder eine gemeinsam versionierte Model Registry,
- dieselben Model IDs,
- denselben Runtime-Status,
- dieselben Profile,
- dieselben Modellrollen und Capability-Typen,
- dieselben Backend-APIs wie Codee.

---

# 3. Integration in den vorhandenen Codee-Bestand

Im aktuellen Projekt existieren bereits:

- `backend/app/models/index_service.py`
- `backend/app/models/schemas.py`
- `backend/app/models/profile_service.py`
- `backend/app/runtime/service.py`
- `backend/app/runtime/multi_server_manager.py`
- `backend/app/job_spooler`
- `backend/app/orchestration`
- SQLite-basierte Agent-, Task- und Project-Memory-Module
- `GET /models/index`
- Runtime Start/Stop
- Ollama- und llama.cpp-Erkennung

Diese Module werden erweitert, nicht ersetzt.

## Neue Backend-Module

```text
backend/app/model_lab/
├── models.py
├── service.py
├── repository.py
├── scanner.py
├── artifact_grouping.py
├── metadata_extractors/
│   ├── gguf.py
│   ├── safetensors.py
│   ├── onnx.py
│   ├── pytorch.py
│   ├── ollama.py
│   ├── diffusion.py
│   └── media.py
├── capability_detection/
│   ├── rules.py
│   ├── tokenizer_probe.py
│   ├── config_probe.py
│   └── runtime_probe.py
├── enrichment/
│   ├── huggingface.py
│   ├── github.py
│   ├── ollama_library.py
│   ├── web_search.py
│   └── source_ranker.py
├── benchmark/
│   ├── coordinator.py
│   ├── scenarios.py
│   ├── hardware_monitor.py
│   ├── quality_checks.py
│   └── adapters/
│       ├── llama_cpp.py
│       ├── ollama.py
│       ├── onnxruntime.py
│       ├── transformers.py
│       ├── diffusion.py
│       └── whisper.py
├── certification/
│   ├── rules.py
│   └── scorer.py
└── optimization/
    ├── runtime_profiles.py
    └── recommendation_engine.py
```

---

# 4. Kernfunktionen

## 4.1 Modellordner verwalten

Der Nutzer kann mehrere Modellquellen hinterlegen:

- `D:\Models`
- `F:\Models`
- `G:\Ollama`
- `%USERPROFILE%\.ollama\models`
- Hugging-Face-Cache
- frei definierte Netzwerk- oder NAS-Pfade

Pro Quelle:

- aktiv/inaktiv
- rekursiv scannen
- Dateifilter
- Priorität
- vertrauenswürdig / unbekannt
- automatischer Scan
- Watcher für Änderungen
- Ausschlussmuster
- letzter Scan
- belegter Speicher

## 4.2 Artefakterkennung

Erkannte Formate:

### Sprach- und Multimodalmodelle
- `.gguf`
- `.ggml`
- `.safetensors`
- `.bin`
- `.pt`
- `.pth`
- `.ckpt`
- `.onnx`
- `.ort`
- Ollama Manifeste und Blob Store

### Support-Artefakte
- `mmproj`
- LoRA
- Adapter
- Tokenizer
- Vokabular
- Chat Templates
- Config-Dateien
- Generation Config
- Preprocessor Config

### Bild, Audio und Medien
- Stable Diffusion / SDXL / Flux
- ControlNet
- VAE
- CLIP
- Whisper
- TTS
- Embedding
- Reranker
- OCR
- Upscaler
- Audio- und Musikmodelle
- Video-Modelle

## 4.3 Zusammengehörige Dateien gruppieren

Ein Modell ist häufig nicht nur eine Datei.

Das Tool bildet automatisch ein `ModelBundle`:

```text
ModelBundle
├── Base Model
├── Quantization Variant
├── Tokenizer
├── Config
├── Chat Template
├── MMProj
├── Vision Encoder
├── Adapter / LoRA
├── README / Model Card
└── Runtime Profile
```

Erkennung über:

- Verzeichnisstruktur
- Dateinamen
- SHA-256
- GGUF-Metadaten
- Config-Referenzen
- Architektur
- Basismodellname
- Hugging-Face-Repository-ID
- Ollama Manifest Digests

---

# 5. Capability-Erkennung

Capabilities werden nicht nur aus Dateinamen geraten.

## Stufe 1: statische Metadaten

- Modellarchitektur
- Kontextgröße
- Embedding-Dimension
- Layerzahl
- Attention-Typ
- Rope-Konfiguration
- Quantisierung
- Tokenizer
- Chat Template
- Vision Encoder
- Audio Encoder
- Tool-Calling Templates
- FIM-Tokens
- unterstützte Sprachen
- Lizenz
- Parameterzahl

## Stufe 2: Regelbasierte Klassifikation

Mögliche Rollen:

- Chat
- Instruction
- Coding
- Fill-in-the-Middle
- Code Review
- Planning
- Reasoning
- Tool Calling
- Function Calling
- Vision
- OCR
- Image Understanding
- Image Generation
- Audio Transcription
- Audio Classification
- Text-to-Speech
- Embedding
- Reranking
- Translation
- Summarization
- Classification
- Music / Audio Generation

## Stufe 3: Runtime-Probe

Das Modell wird kontrolliert gestartet und mit kleinen Capability-Probes geprüft:

- akzeptiert Chat Template?
- unterstützt System Prompt?
- liefert strukturiertes JSON?
- kann Tool Calls erzeugen?
- erkennt Bildinput?
- besitzt FIM-Verhalten?
- erzeugt Embeddings?
- antwortet mehrsprachig?
- unterstützt Streaming?
- stoppt korrekt?
- lädt ohne Fehler?
- produziert valide Tokens?

## Stufe 4: Confidence Score

Jede Capability erhält:

```json
{
  "capability": "coding",
  "confidence": 0.94,
  "evidence": [
    "GGUF architecture metadata",
    "FIM special tokens",
    "Model card pipeline tag",
    "runtime probe passed"
  ]
}
```

---

# 6. Web-Enrichment

Die Websuche darf lokale Daten nicht überschreiben, sondern nur ergänzen.

## Quellenreihenfolge

1. eingebettete Modellmetadaten
2. lokale `README.md` oder Model Card
3. Hugging Face Model Card und API
4. Hersteller-Repository
5. GitHub Release / Dokumentation
6. Ollama Library
7. Papers with Code / arXiv
8. allgemeine Websuche als letzte Stufe

## Gesammelte Informationen

- offizieller Modellname
- Hersteller
- Basismodell
- Version
- Veröffentlichungsdatum
- Architektur
- Parameterzahl
- Kontextlänge
- Modalitäten
- empfohlene Runtime
- Prompt- und Chat-Template
- bekannte Startparameter
- Lizenz
- kommerzielle Nutzbarkeit
- Einschränkungen
- bekannte Probleme
- RAM- und VRAM-Empfehlungen
- Benchmark-Ergebnisse des Herstellers
- unterstützte Sprachen
- Modellfamilie
- Repository-URL
- Commit / Revision
- Prüfsumme

## Sicherheitsregel

Jeder externe Wert benötigt:

- Quellen-URL
- Abrufzeit
- Quellenart
- Vertrauensscore
- Feldstatus: bestätigt / wahrscheinlich / unbestätigt / widersprüchlich

---

# 7. Hardware-Inventarisierung

Beim ersten Start wird ein Hardwareprofil erstellt.

## CPU
- Modell
- Kerne / Threads
- Befehlssätze
- Takt
- NUMA
- RAM
- Speicherbandbreite
- Energieprofil

## GPU
- Hersteller
- Modell
- VRAM
- Shared Memory
- Treiberversion
- CUDA / Vulkan / DirectML / ROCm / OpenCL
- Compute Capability
- verfügbare Backends

## Speicher
- Laufwerkstyp
- Lesegeschwindigkeit
- freier Speicher
- Modellpfad
- NTFS-Kompression
- Netzlaufwerk

## Laufzeitumgebung
- Windows-Version
- llama.cpp Build
- Ollama-Version
- ONNX Runtime
- CUDA Toolkit
- Vulkan Runtime
- Python
- Treiber

Alle Benchmark-Ergebnisse werden an die exakte Hardware- und Runtime-Version gebunden.

---

# 8. Benchmark-System

## 8.1 Testmodi

Jedes kompatible Modell wird in mehreren Profilen getestet:

### CPU
- GPU Offload = 0
- definierte Thread-Stufen
- mehrere Batch-Größen

### GPU
- maximal möglicher GPU Offload
- mehrere Kontextgrößen
- Flash Attention an/aus, sofern unterstützt

### Hybrid
- automatisch bestimmte GPU-Layer
- CPU-Fallback
- optimiertes VRAM-Limit

### Eco
- reduzierte Threads
- niedriger Stromverbrauch
- Hintergrundbetrieb

### Max Performance
- maximale sichere Auslastung
- höchste Tokens/s

## 8.2 Messwerte

### Laden
- Cold Start
- Warm Start
- Datei-Lesezeit
- Modellinitialisierung
- GPU Upload
- Zeit bis Ready
- Zeit bis erster Token

### Inferenz
- Prompt Processing Tokens/s
- Generation Tokens/s
- Time To First Token
- Inter-Token-Latency
- Gesamtantwortzeit
- Durchsatz bei parallelen Requests
- Kontext-Skalierung

### Ressourcen
- CPU-Auslastung
- RAM Peak
- VRAM Peak
- GPU-Auslastung
- Temperatur
- Leistungsaufnahme, soweit verfügbar
- Datenträger-I/O
- Page Faults
- Stabilität

### Qualität
- Antwortformat
- Wiederholungen
- Abbruchverhalten
- JSON-Validität
- Code-Kompilierbarkeit
- Tool-Call-Validität
- Halluzinationsindikatoren
- Instruktionsbefolgung

---

# 9. Benchmark-Szenarien

## Basistest
- Modell lädt
- Health Endpoint verfügbar
- einfache Antwort
- sauberer Shutdown

## Chat
- Deutsch
- Englisch
- System Prompt
- Mehrturn-Dialog
- längerer Kontext

## Coding
- Code vervollständigen
- Fehler finden
- Patch erzeugen
- JSON Schema einhalten
- FIM
- Repository-Kontext

## Reasoning
- mehrstufige Aufgabe
- Planerstellung
- Constraint-Einhaltung

## Vision
- Bildbeschreibung
- OCR
- UI-Screenshot analysieren
- Diagramm verstehen

## Embedding / Reranker
- Vektordimension
- Durchsatz
- Recall-Test
- Ranking-Konsistenz

## Audio
- Transkriptionszeit
- Word Error Rate Testset
- Echtzeitfaktor

## Bildgenerierung
- Startzeit
- Sekunden pro Bild
- VRAM Peak
- reproduzierbare Seed-Ausgabe

---

# 10. Automatische Runtime-Optimierung

Nach den Tests erzeugt das Tool pro Modell mehrere Startprofile.

Beispiel:

```json
{
  "model_id": "qwen3-8b-q4-k-m",
  "hardware_fingerprint": "ryzen5600g-gtx1650s-4gb",
  "profiles": {
    "interactive": {
      "ctx_size": 4096,
      "threads": 6,
      "batch": 128,
      "ubatch": 128,
      "gpu_layers": 8,
      "flash_attention": "auto",
      "cache_type_k": "q8_0",
      "cache_type_v": "q8_0"
    },
    "quality": {
      "ctx_size": 8192,
      "threads": 6,
      "batch": 64,
      "gpu_layers": 6
    },
    "cpu_fallback": {
      "ctx_size": 4096,
      "threads": 8,
      "gpu_layers": 0
    }
  }
}
```

Die Profile werden direkt für Codee verwendbar.

---

# 11. Modell-Zertifizierung

Jedes Modell erhält einen Status.

## Statusklassen

- `DISCOVERED`
- `IDENTIFIED`
- `ENRICHED`
- `LOADABLE`
- `BENCHMARKED`
- `VERIFIED`
- `CERTIFIED_FOR_CODEE`
- `DEGRADED`
- `INCOMPLETE`
- `BROKEN`
- `UNSUPPORTED`
- `QUARANTINED`

## Zertifizierungskriterien

- Dateien vollständig
- Hash gültig
- Runtime kompatibel
- Ladeprobe erfolgreich
- definierte Mindestleistung
- keine Abstürze
- Capability-Probes bestanden
- Lizenz geklärt
- passende Startparameter vorhanden
- mindestens ein Fallback-Profil vorhanden

## Ergebnis

```text
Codee Certified
Coding: 92/100
Chat: 84/100
German: 88/100
Speed: 76/100
Stability: 100/100
Hardware Fit: 91/100
Recommended Role: Primary Coding Model
```

---

# 12. Datenmodell

## Zentrale Tabellen

```text
model_sources
model_artifacts
model_bundles
model_metadata
model_capabilities
model_external_sources
model_runtime_compatibility
model_benchmark_runs
model_benchmark_measurements
model_quality_results
model_runtime_profiles
model_certifications
model_relationships
model_licenses
hardware_profiles
runtime_versions
scan_jobs
enrichment_jobs
benchmark_jobs
```

## Wichtige Grundregel

Dateipfad ist keine dauerhafte Modell-ID.

Empfohlene Identität:

```text
model_id = Architektur + Modellfamilie + Variante
artifact_id = SHA-256 der Datei
bundle_id = stabiler Hash aller primären Artefakte
installation_id = lokaler Pfad auf diesem Rechner
```

Dadurch bleiben Ergebnisse auch nach Verschieben eines Modells gültig.

---

# 13. API-Erweiterung für Codee

```http
GET    /model-lab/sources
POST   /model-lab/sources
POST   /model-lab/scan
GET    /model-lab/jobs
GET    /model-lab/models
GET    /model-lab/models/{id}
POST   /model-lab/models/{id}/enrich
POST   /model-lab/models/{id}/probe
POST   /model-lab/models/{id}/benchmark
POST   /model-lab/models/{id}/certify
GET    /model-lab/models/{id}/profiles
PUT    /model-lab/models/{id}/profiles/{profile}
GET    /model-lab/hardware
POST   /model-lab/hardware/refresh
GET    /model-lab/recommendations
```

## Ereignisse

Für Fortschrittsanzeigen:

```text
scan.started
scan.file_detected
scan.bundle_created
metadata.extracted
enrichment.completed
benchmark.stage_started
benchmark.measurement
benchmark.completed
certification.updated
```

Transport:

- Server-Sent Events als einfache erste Lösung
- später WebSocket Event Stream

---

# 14. WinUI-Oberfläche

## Hauptnavigation

### Dashboard
- Anzahl Modelle
- neu gefunden
- ungeprüft
- zertifiziert
- beschädigt
- Gesamtspeicher
- aktive Jobs
- Hardware-Auslastung

### Model Library
Tabellarische und kartenbasierte Ansicht:

- Name
- Typ
- Format
- Größe
- Quantisierung
- Capabilities
- Status
- Laufzeit
- Tokens/s
- VRAM
- Codee-Rolle

### Scanner
- Modellquellen
- Scan starten
- Live-Fortschritt
- gefundene Artefakte
- Duplikate
- unvollständige Bundles

### Model Inspector
Detailansicht:

- Overview
- Files
- Metadata
- Capabilities
- Web Sources
- Runtime
- Benchmarks
- Quality
- Profiles
- Certification
- Logs

### Benchmark Lab
- Modelle auswählen
- Hardwaremodus
- Testpaket
- Wiederholungen
- Kontextgrößen
- Vergleichsansicht
- Diagramme
- Export

### Runtime Tuner
- GPU Layer Slider
- Context
- Threads
- Batch
- KV Cache
- Flash Attention
- Live RAM/VRAM-Schätzung
- Profil speichern
- direkt in Codee aktivieren

### Certification Center
- offene Prüfungen
- Fehler
- Lizenzprobleme
- fehlende Dateien
- Freigabe für Codee-Rollen

### Jobs & Logs
- Scans
- Webrecherche
- Benchmarks
- Fehler
- Prozessausgaben

### Settings
- Codee Backend
- Modellpfade
- Runtime-Pfade
- Internetzugriff
- API Tokens
- Datenschutz
- Benchmark-Limits
- Temperaturgrenzen
- Datenbank

---

# 15. UI-Design

## DBZS-Stil

- dunkles Fluent-Design
- Neon Cyan / Blau als Akzent
- klare Statusfarben
- kompakte technische Tabellen
- progressive Detailansichten
- keine überladene Spielzeugoptik

## Statusdarstellung

- Blau: erkannt
- Cyan: geprüft
- Grün: zertifiziert
- Gelb: eingeschränkt
- Rot: fehlerhaft
- Grau: nicht unterstützt

## Wichtige UX-Regel

Jede Aussage zeigt ihre Herkunft:

```text
Context Size: 32.768
Quelle: GGUF Metadata
Vertrauen: Hoch
```

Oder:

```text
Vision Capability: Wahrscheinlich
Quelle: Dateiname + Model Card
Runtime-Test: Noch nicht durchgeführt
```

---

# 16. Zusätzliche Funktionen

## Duplikat- und Variantenanalyse
- identische Datei an mehreren Orten
- gleiche Modellfamilie in mehreren Quantisierungen
- unnötige Kopien
- Einsparpotenzial anzeigen

## Integritätsprüfung
- SHA-256
- beschädigte Dateien
- abgebrochene Downloads
- fehlende Shards
- fehlerhafte Ollama Blobs

## Speicheroptimierung
- selten genutzte Modelle
- schlechtere Quantisierung bei gleicher Qualität
- Dubletten
- Archivvorschläge
- sichere Verschiebeaktion mit Datenbankupdate

## Modellvergleich
- Geschwindigkeit
- Qualität
- Speicherverbrauch
- Fähigkeiten
- Lizenz
- Codee-Eignung

## Intelligentes Routing
Codee fragt später nicht nur nach einem Modellnamen, sondern nach Anforderungen:

```text
Task: Code Review
Language: German
Max VRAM: 4 GB
Latency Priority: High
Context: 8k
```

Das Model Lab liefert den besten verfügbaren Kandidaten samt Startprofil.

## Reproduzierbarkeit
Jeder Benchmark speichert:

- Modellhash
- Runtime-Version
- Treiber
- Startparameter
- Hardwareprofil
- Promptset-Version
- Datum
- Rohdaten

## Modell-Lebenslauf
- entdeckt
- verschoben
- aktualisiert
- getestet
- zertifiziert
- Profil geändert
- Fehler festgestellt

---

# 17. Sicherheits- und Stabilitätsregeln

- Modelle nie automatisch beim App-Start laden
- Benchmark-Worker in separaten Prozessen
- harte RAM- und VRAM-Limits
- Timeout pro Test
- Kill-Fallback
- Temperaturgrenze
- Crash Recovery
- Job Resume
- keine Shell-Kommandos aus Webquellen
- externe Metadaten niemals ungeprüft als Startparameter ausführen
- Hash und Pfad vor jedem Benchmark erneut prüfen
- Internetzugriff pro Quelle deaktivierbar
- API Tokens ausschließlich im Windows Credential Manager

---

# 18. Produktionsreife

## Phase 1 – Inventory MVP
- WinUI Shell
- Modellquellen
- rekursiver Scanner
- GGUF, Safetensors, ONNX und Ollama
- Artefakt-Gruppierung
- SQLite Registry
- Codee API
- Modell-Detailansicht

## Phase 2 – Capability & Enrichment
- Metadatenextraktion
- Hugging-Face-Anbindung
- Quellenbewertung
- Capability-Regeln
- Lizenzdaten
- Dublettenprüfung

## Phase 3 – Benchmark Core
- Hardwareprofil
- llama.cpp Adapter
- CPU/GPU/Hybrid
- Ladezeit
- Tokens/s
- RAM/VRAM
- Benchmark-Historie

## Phase 4 – Certification
- Capability-Probes
- Qualitäts-Tests
- Scoring
- Codee-Rollen
- Runtime-Profilgenerator

## Phase 5 – Multi-Modal
- Vision
- Embedding
- Reranker
- Whisper
- Diffusion
- ONNX Runtime

## Phase 6 – Autonomous Model Operations
- automatischer Dateiwächter
- geplante Nacht-Benchmarks
- neue Modelle automatisch identifizieren
- Regressionen nach Runtime-Update erkennen
- automatisch optimierte Codee-Routingprofile

---

# 19. Meine klare Empfehlung

Das Tool sollte als eigenständige WinUI-App erscheinen, aber technisch Teil des Codee-Systems bleiben.

## Aufteilung

```text
WinUI App
    ↓ REST + SSE
Codee FastAPI Backend
    ↓
Model Lab Services
    ↓
Runtime Adapter / Benchmark Worker
    ↓
llama.cpp / Ollama / ONNX / Diffusion / Whisper
    ↓
gemeinsame Codee SQLite Model Registry
```

Damit erhältst du:

- keine doppelte Modellverwaltung,
- keine widersprüchlichen Datenbestände,
- eine native Windows-Oberfläche,
- wiederverwendbare Backend-Logik,
- direkte Nutzung aller Ergebnisse durch Codee,
- später automatisches Model Routing,
- reproduzierbare Zertifizierung aller 366+ Modelle.

---

# 20. Wichtigste Verbesserung gegenüber dem aktuellen Model Index

Der bestehende Index beantwortet hauptsächlich:

> Welche Modellartefakte sind vorhanden und womit könnten sie gestartet werden?

Das Model Operations Center beantwortet zusätzlich:

> Was ist dieses Modell wirklich, ist es vollständig, welche Fähigkeiten wurden nachgewiesen, wie gut läuft es exakt auf meiner Hardware, mit welchen Parametern soll Codee es starten und für welche Aufgabe darf Codee es zuverlässig einsetzen?

Genau dieser Schritt macht aus einer Modellsammlung einen produktionsreifen lokalen KI-Modellbestand.

---

# 21. Empfohlener erster Implementierungsschnitt

Als erstes sollte gebaut werden:

1. gemeinsame versionierte `ModelRegistry` in SQLite,
2. WinUI Model Library,
3. rekursiver Scanner mit Bundle-Erkennung,
4. GGUF- und Safetensors-Metadatenextraktion,
5. Hardware Fingerprint,
6. llama.cpp CPU/GPU/Hybrid Benchmark,
7. automatische Runtime-Profile,
8. Rückschreiben in Codees bestehenden Model Index.

Damit entsteht schnell ein nutzbarer Kern, ohne sich direkt in Vision, Diffusion und Audio zu verzetteln.

---

# 22. Echte Modell-Lade- und Testumgebung

Das Tool muss Modelle nicht nur erkennen und katalogisieren, sondern sie aktiv laden, starten, testen und wieder sauber entladen können.

## 22.1 Model Test Runtime

Jeder Test läuft in einem eigenen isolierten Worker-Prozess.

```text
WinUI Model Lab
    ↓
Benchmark / Test Coordinator
    ↓
Isolated Model Worker
    ↓
Runtime Adapter
    ↓
Model + Test Assets
```

Vorteile:

- ein defektes Modell reißt nicht die App mit,
- RAM und VRAM werden nach dem Test zuverlässig freigegeben,
- Hänger können beendet werden,
- mehrere Runtime-Versionen lassen sich vergleichen,
- Logs und Abstürze bleiben einem konkreten Modelltest zugeordnet.

## 22.2 Unterstützte Ladearten

### Textmodelle

- Completion
- Chat
- Instruction
- Reasoning
- Coding
- Fill-in-the-Middle
- Tool Calling
- Structured Output
- Embedding
- Reranking

### Multimodal- und Visionmodelle

- GGUF-Hauptmodell plus `mmproj`
- integrierte Vision Encoder
- Hugging-Face Multimodalmodelle
- ONNX Vision-Language-Modelle
- OCR-Modelle
- Bildklassifikation
- Bildbeschreibung
- Dokumentenverständnis
- Screenshot- und UI-Analyse

### Audiomodelle

- Speech-to-Text
- Audio Classification
- Speaker Detection
- Music Analysis
- Text-to-Speech
- Audio Generation

### Bild- und Medienmodelle

- Stable Diffusion
- SDXL
- Flux
- VAE
- ControlNet
- Upscaler
- Image Encoder
- Video-Modelle, sofern eine unterstützte Runtime vorhanden ist

## 22.3 Test Asset Library

Für Multimodaltests benötigt Codee einen versionierten lokalen Testdatenbestand.

```text
backend/test_assets/model_lab/
├── text/
├── code/
├── vision/
│   ├── photos/
│   ├── screenshots/
│   ├── ui/
│   ├── charts/
│   ├── documents/
│   └── ocr/
├── audio/
│   ├── speech/
│   ├── music/
│   └── noise/
├── diffusion/
│   ├── prompts/
│   ├── control_images/
│   └── reference_images/
└── expected_results/
```

Jedes Testasset erhält:

- stabile Asset-ID,
- Version,
- Lizenzangabe,
- Prüfsumme,
- erwartete Capability,
- erwartetes Ergebnis oder Bewertungsregel,
- Sprache,
- Schwierigkeitsgrad.

## 22.4 Multimodaler Testablauf

Beispiel für ein Vision-Language-Modell:

1. Hauptmodell identifizieren
2. passendes `mmproj` oder Vision-Modul zuordnen
3. Runtime-Kompatibilität prüfen
4. Modell mit begrenztem Kontext laden
5. Referenzbild übergeben
6. Bildbeschreibung testen
7. OCR-Test durchführen
8. Screenshot-Analyse testen
9. strukturierte Ausgabe anfordern
10. Latenz, RAM und VRAM messen
11. Modell sauber entladen
12. Ergebnis und Rohlogs im Codee-Datenbestand speichern

## 22.5 Ladeprofile

Pro Modell werden mehrere Ladeprofile erzeugt.

```json
{
  "profile_name": "vision_interactive",
  "runtime": "llama.cpp",
  "model_path": "D:/Models/model.gguf",
  "projection_path": "D:/Models/mmproj.gguf",
  "context_size": 4096,
  "gpu_layers": 8,
  "threads": 6,
  "batch_size": 128,
  "image_max_dimension": 1024,
  "timeout_seconds": 180
}
```

Weitere Profile:

- `text_cpu`
- `text_gpu`
- `text_hybrid`
- `vision_cpu`
- `vision_gpu`
- `vision_hybrid`
- `audio_realtime`
- `audio_quality`
- `diffusion_low_vram`
- `diffusion_quality`

## 22.6 Runtime Adapter Contract

Jeder Adapter muss dieselbe Schnittstelle erfüllen.

```text
CanLoad(model_bundle, hardware_profile)
Prepare(runtime_profile)
Load()
HealthCheck()
RunProbe(test_case)
CollectMetrics()
Unload()
ForceTerminate()
CollectLogs()
```

Ein Runtime Adapter meldet zusätzlich:

- unterstützte Modellformate,
- unterstützte Modalitäten,
- Hardware-Backends,
- verfügbare Quantisierungen,
- Streaming-Support,
- Batch-Support,
- Parallelitäts-Support,
- bekannte Einschränkungen.

## 22.7 Modell- und Komponentenauflösung

Multimodalmodelle bestehen oft aus mehreren Komponenten.

Das Tool muss automatisch erkennen:

```text
Vision Language Model
├── Language Model
├── Vision Encoder
├── Projection Model / mmproj
├── Tokenizer
├── Image Processor
├── Chat Template
└── Generation Config
```

Fehlt eine Komponente, erhält das Modell den Status:

- `INCOMPLETE`
- `MISSING_PROJECTION_MODEL`
- `MISSING_IMAGE_PROCESSOR`
- `MISSING_TOKENIZER`
- `INCOMPATIBLE_COMPONENT_VERSION`

## 22.8 Interaktive Testkonsole

Im Model Inspector erhält jedes ladbare Modell eine Testkonsole.

### Text

- Prompt eingeben
- System Prompt setzen
- Samplingparameter verändern
- Streaming testen
- Tokenstatistik anzeigen

### Vision

- Bild per Drag & Drop laden
- Screenshot aufnehmen
- mehrere Bilder übergeben
- OCR-Modus
- UI-Analyse
- Bounding-Box-Ausgabe, sofern unterstützt

### Audio

- Datei laden
- Mikrofon-Test
- Transkription
- Sprache erkennen
- Echtzeitfaktor anzeigen

### Bildgenerierung

- Prompt
- Negative Prompt
- Seed
- Steps
- Auflösung
- Sampler
- VRAM-Verlauf
- Ergebnisvergleich

Die interaktive Konsole und die automatisierten Benchmarks verwenden denselben Runtime Adapter. Dadurch entstehen keine zwei voneinander abweichenden Implementierungen.

## 22.9 Live-Telemetrie während des Ladens

Während eines Tests zeigt WinUI live:

- aktueller Ladeschritt,
- geladene Komponenten,
- RAM,
- VRAM,
- CPU,
- GPU,
- Datenträger-I/O,
- Prozessstatus,
- Runtime-Log,
- verstrichene Ladezeit,
- geschätzte Restphase,
- aktives Testprofil.

## 22.10 Entladen und Ressourcenbereinigung

Nach jedem Test:

- Request-Verbindungen schließen,
- Runtime kontrolliert stoppen,
- Worker-Prozess beenden,
- GPU-Kontext freigeben,
- temporäre Dateien löschen,
- belegten RAM und VRAM erneut messen,
- Ressourcenleck markieren.

Bleibt Speicher belegt, wird das Ergebnis als möglicher Runtime- oder Treiberfehler protokolliert.

## 22.11 Fehlertoleranz

Das Testsystem benötigt:

- Load Timeout
- Inference Timeout
- Idle Timeout
- Heartbeat
- Crash Detection
- Prozess-Kill
- automatisches Log-Sammeln
- optionalen Neustart mit reduziertem Profil
- automatische GPU-zu-CPU-Fallback-Prüfung

Beispiel:

```text
GPU Load fehlgeschlagen
→ Hybridprofil versuchen
→ GPU-Layer reduzieren
→ CPU-Fallback versuchen
→ Ergebnis als DEGRADED speichern
```

## 22.12 Multimodale Zertifizierung

Ein MM-Modell wird erst zertifiziert, wenn alle erforderlichen Komponenten gemeinsam getestet wurden.

Beispiel:

```text
Model: Qwen Vision Variant
Text Load: PASSED
Vision Encoder: PASSED
Projection Model: PASSED
Image Input: PASSED
OCR Probe: PASSED
UI Screenshot Probe: PASSED
Structured Output: PASSED
GPU Profile: DEGRADED
Hybrid Profile: PASSED
CPU Profile: PASSED

Certification:
CODEE_CERTIFIED_MULTIMODAL
Recommended Profile:
vision_hybrid
```

## 22.13 Wichtig für Codee

Codee soll später dasselbe geprüfte Ladeprofil direkt verwenden können.

Der Test endet daher nicht mit einem Bericht, sondern erzeugt:

- verifiziertes Runtime-Profil,
- passende Modellkomponenten,
- getestete Startparameter,
- Capability-Matrix,
- bekannte Fehler,
- Fallback-Profil,
- empfohlene Codee-Rolle.

Damit kann Codee ein Multimodalmodell später ohne erneutes Rätselraten korrekt starten.
