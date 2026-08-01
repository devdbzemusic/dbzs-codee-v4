# DBZS Codee – Durchgehende Model-Handling-Revision

**Analysebasis:** `dbzs-codee-project-main`
**Stand:** 01.08.2026
**Bereiche:** lokale Modelle, Modellquellen, Scan, Index, Metadaten, Runtime, GPU-Offloading, Tuning, Benchmarks, UI und Persistenz

## 1. Gesamturteil

Das lokale Model Handling ist derzeit **nicht durchgängig funktionsfähig**, sondern besteht aus mehreren teilweise miteinander verbundenen Entwicklungsständen:

1. Modellindex über `models.catalog.json`
2. optionaler Dateisystem-Scan, dessen Implementierung fehlt
3. Ollama-Manifest-Import
4. Single-Model-Runtime für `llama-server` oder Ollama
5. separates Modellprofil-/Multi-Server-System
6. theoretischer Ressourcen-„Benchmark"
7. rudimentäre Desktop-Anzeige

Die Systeme verwenden unterschiedliche Schemas und sind nicht vollständig gekoppelt. Dadurch verschwinden Modelle aus der Oberfläche, Runtimewerte werden nicht geladen und neue Modelle starten standardmäßig ohne GPU-Offloading.

## 2. Warum wahrscheinlich nur etwa 20 Modelle erscheinen

### 2.1 Der vorhandene Katalog blockiert den vollständigen Scan

`ModelIndexService.build_index()` entscheidet exklusiv:

- `models.catalog.json` vorhanden → nur Katalog laden
- Katalog nicht vorhanden → `_from_filesystem()` aufrufen

Der Katalog wird **nicht** mit einem rekursiven Scan zusammengeführt. Befinden sich im Katalog nur 20 Einträge, stehen in Codee auch nur diese 20 Einträge zur Verfügung – unabhängig davon, wie viele weitere GGUF-, Safetensors-, MMProj-, LoRA- oder andere Modelldateien auf den Laufwerken liegen.

**Fundstelle:** `backend/app/models/index_service.py`, `build_index()`

### 2.2 Der Dateisystem-Fallback ist nicht implementiert

`build_index()` ruft `_from_filesystem()` auf. Diese Methode existiert nicht. Ohne `models.catalog.json` bricht die Indexierung mit `AttributeError` ab.

Folge:

- kein verlässlicher rekursiver Scan
- keine automatische Aufnahme neuer Modelle
- keine Erkennung mehrerer Modellwurzeln
- kein Wiederaufbau des Katalogs aus dem tatsächlichen Bestand

### 2.3 Es wird nur eine GGUF-Modellwurzel verwendet

`get_models_dir()` liefert nur:

- `DBZS_MODELS_DIR`, sonst
- `D:/Models`

Bekannte weitere Bestände wie `F:/Models`, `H:/Models`, `C:/dev/prj/models/gguf` oder mehrere frei wählbare Ordner werden nicht als gemeinsame Sources verwaltet.

### 2.4 UI zeigt absichtlich nur einen kleinen Ausschnitt

Das Modellindex-Panel zeigt nur fünf Modelle:

```ts
.filter(...).slice(0, 5)
```

Die Runtime-Auswahl zeigt nur Modelle, deren Kompatibilität als startbar eingestuft wurde. Support-Artefakte, Vision-Pipelines, Embeddings, Reranker, Diffusion und Modelle mit unvollständigem Health-/Runtime-State werden ausgeschlossen oder nur gezählt.

**Fundstellen:**

- `apps/desktop/src/App.tsx`, `ModelIndexPanel()`
- `apps/desktop/src/App.tsx`, `isRunnableModel()`

### 2.5 Schema-Migration ist inkonsistent

Der Code kommentiert „V2-Kompatibilität“, unterstützt aber nur Teile der alten/neuen Strukturen.

Beispiele:

- Katalog: `models` oder `artifacts` wird akzeptiert
- Runtime: nur `models` als Dictionary
- State: nur `models` als Dictionary
- ältere Tests und Dokumente verwenden unter anderem `artifacts` beziehungsweise `health`

Dadurch bleiben `health_status`, `ctx`, `gpu_layers`, Port und Serverfreigabe häufig auf Standardwerten.

### 2.6 Resultierender Filtereffekt

Wenn Healthdaten nicht gelesen werden:

- `health_status = unknown`
- `llama_server_ready` wird zu `llama_server_candidate`
- Coding-Modell wird nicht `primary_coding`
- Profilgenerator berücksichtigt nur `llama_server_ready` und `ollama_ready`

Damit fallen zahlreiche vorhandene Modelle aus automatischer Profilbildung und bevorzugtem Routing heraus.

## 3. Wo die restlichen Modelle derzeit bleiben

Die restlichen Modelle befinden sich mit hoher Wahrscheinlichkeit in einer oder mehreren dieser Gruppen:

1. physisch vorhanden, aber nicht in `models.catalog.json`
2. in einem nicht konfigurierten Modellordner
3. als `.safetensors` gefunden, aber nicht durch eine passende Runtime startbar
4. MMProj/LoRA/Adapter ohne korrekt verknüpftes Basismodell
5. Vision-/Multimodal-Modell ohne Runtime-Pairing oder Chat-Template
6. Ollama-Modell in einem anderen Store als dem erkannten Pfad
7. im Index vorhanden, aber durch `isRunnableModel()` aus der Runtime-Auswahl gefiltert
8. wegen unbekanntem Health-State nicht als „ready“ eingestuft
9. wegen veraltetem oder inkompatiblem JSON-Schema ohne Runtimeparameter
10. Duplikate oder Shards, die noch nicht als logisches Modell gruppiert werden

Eine exakte Bestandszahl kann Codee aktuell nicht zuverlässig liefern, weil der rekursive Scanner fehlt und nur eine primäre Modellwurzel vorgesehen ist.

## 4. GPU-Layer: aktueller Ist-Zustand

### 4.1 Werte können aus `models.runtime.json` kommen

Das Datenmodell besitzt `runtime.gpu_layers`. Die Runtime baut daraus:

```text
--gpu-layers <wert>
```

### 4.2 Fehlender Wert bedeutet CPU-only

Ist `gpu_layers` nicht gesetzt, verwendet die Runtime ausdrücklich:

```python
gpu_layers = 0
```

Neue oder nicht korrekt migrierte Modelle laufen damit standardmäßig vollständig auf der CPU.

### 4.3 Runtime-Command ist stark unterkonfiguriert

Der Single-Model-Start setzt nur:

- Modellpfad
- Host
- Port
- Context Size
- GPU Layers

Nicht genutzt werden unter anderem:

- `--threads`
- `--threads-batch`
- `--batch-size`
- `--ubatch-size`
- Flash Attention
- KV-Cache-Typ K/V
- mmap/mlock
- NUMA
- GPU-Split / Tensor-Split
- Main GPU
- Parallel Slots
- Continuous Batching
- RoPE/Yarn-Konfiguration
- Chat Template
- MMProj
- Embedding-/Reranker-Modus
- Vulkan-/CUDA-Gerätewahl

### 4.4 Gespeicherte „last good command“-Daten sind unvollständig

`_save_last_good_command()` versucht Threads aus dem Command auszulesen. Der erzeugte Command enthält aber gar kein `--threads`. Deshalb landet regelmäßig nur der Defaultwert 4 in der Persistenz.

### 4.5 Modellprofile sind vom eigentlichen Runtime-Start getrennt

`ProfileService` besitzt GPUConfig, ContextConfig und Profilgenerierung. Die normale Desktop-Runtime startet Modelle jedoch direkt über `RuntimeService` und nutzt diese Profile nicht. Es existieren somit zwei Konfigurationswelten ohne verbindliche gemeinsame Execution Pipeline.

## 5. Benchmarks: aktueller Ist-Zustand

Der Endpoint `/model-profiles/benchmark` führt **keinen realen Modellbenchmark** durch.

Berechnet werden lediglich:

- GPU-Schätzung: `n_gpu_layers × 128 MB`
- Cache-Summe aus konfigurierten Werten
- Threadsumme
- daraus ein synthetischer Score

Nicht gemessen werden:

- Ladezeit
- tatsächliche VRAM-Belegung
- RAM-Belegung
- Prompt-Evaluation in Token/s
- Generation in Token/s
- Time to First Token
- Latenzverteilung
- Stabilität
- GPU-Auslastung
- CPU-Auslastung
- Energie/Temperatur
- Context-Skalierung
- Qualität oder Task-Eignung
- GPU-only / CPU-only / Hybrid-Vergleich

Die aktuelle Funktion sollte deshalb **Resource Preflight**, nicht Benchmark heißen.

## 6. Verifizierter Teststatus

Ausgeführt:

```text
python -m pytest \
  backend/tests/test_model_index.py \
  backend/tests/test_runtime_service.py \
  backend/tests/test_model_profiles.py -q
```

Ergebnis:

```text
7 failed, 11 passed
```

Fehlergruppen:

1. Katalog-/Runtime-/State-Schema wird nicht vollständig gelesen
2. `_from_filesystem()` fehlt
3. GGUF-Scan funktioniert nicht
4. Ollama-Scan ohne Katalog funktioniert nicht
5. llama-server Runtime-Start scheitert in den Tests
6. Runtime-Chat kann anschließend nicht laufen

## 7. Zielarchitektur: ein durchgehender Model Lifecycle

Jedes Modell muss denselben nachvollziehbaren Lebenszyklus durchlaufen:

```text
Source registrieren
→ rekursiv entdecken
→ Artefakte gruppieren
→ Format/Header analysieren
→ Metadaten anreichern
→ Capability erkennen
→ Runtime-Kompatibilität prüfen
→ Safe Probe Load
→ Hardware-Tuning durchführen
→ Benchmark ausführen
→ Ergebnis zertifizieren
→ Index/DB aktualisieren
→ für Routing freigeben
→ Laufzeit überwachen
```

## 8. Empfohlene einheitliche Komponenten

### 8.1 Model Source Registry

Mehrere frei konfigurierbare Quellen statt eines einzelnen `DBZS_MODELS_DIR`:

- lokale Ordner
- Ollama Stores
- Hugging Face Cache
- LM Studio Cache
- benutzerdefinierte Runtime Stores
- Netzlaufwerke optional

Pro Source:

- aktiv/inaktiv
- rekursiv
- Include-/Exclude-Patterns
- Watcher aktiv
- Priorität
- letzter Scan
- Fehlerstatus

### 8.2 Artifact Scanner

Unterstützte Artefakte mindestens:

- GGUF
- Safetensors
- PyTorch BIN/PT/PTH
- ONNX
- TensorRT Engine
- OpenVINO
- MLX
- GPTQ/AWQ-Verzeichnisse
- Ollama Manifeste
- MMProj
- LoRA/Adapter
- Tokenizer
- Config/Generation Config
- Chat Templates

Der Scanner darf nie nur Dateinamen raten. Bei GGUF müssen Header und Metadaten gelesen werden.

### 8.3 Logical Model Grouper

Mehrere Dateien müssen zu einem logischen Modell gruppiert werden:

- gesplittete GGUF-Shards
- Basismodell + MMProj
- Basismodell + LoRA
- Safetensors-Shards + Index JSON
- Tokenizer-/Config-Dateien
- verschiedene Quantisierungen als Varianten eines Modells

### 8.4 Canonical Model Database

Nicht mehr mehrere lose JSON-Dateien als führende Wahrheit verwenden. Empfohlen:

- SQLite als Source of Truth
- JSON nur noch Import/Export und Diagnose
- Schema-Versionierung und Migrationen

Kernentitäten:

- `model_sources`
- `logical_models`
- `model_artifacts`
- `model_variants`
- `capabilities`
- `runtime_adapters`
- `runtime_presets`
- `hardware_snapshots`
- `probe_runs`
- `benchmark_runs`
- `certifications`
- `model_failures`
- `web_metadata`

### 8.5 Runtime Adapter Layer

Gemeinsames Interface für:

- llama.cpp / llama-server
- Ollama
- Transformers
- vLLM
- ONNX Runtime
- TensorRT-LLM
- OpenVINO
- Diffusers
- Stable Diffusion Runtime
- Whisper/Faster-Whisper
- embedding/reranker runtimes

Jeder Adapter implementiert:

- `detect()`
- `validate_artifact()`
- `build_command()`
- `probe_load()`
- `health_check()`
- `benchmark()`
- `stop()`
- `collect_metrics()`

## 9. Reale GPU-Layer- und Tuning-Automatik

Für jedes GGUF-Modell wird eine sichere Tuning-Matrix ausgeführt.

### Stufe A – Metadatenbasierte Startschätzung

Auslesen:

- Architektur
- Layerzahl
- Parameterzahl
- Quantisierung
- Dateigröße
- Embeddinggröße
- Context-Limit
- KV-Typen
- MoE-Daten
- Vision/MMProj-Abhängigkeit

Daraus initiale Offload-Schätzung bilden.

### Stufe B – Safe Probe

Start mit:

- kleinem Context
- konservativem Batch
- CPU-only
- Timeout
- separatem Port
- vollständigem stdout/stderr Capture

### Stufe C – GPU-Layer-Suche

Nicht linear blind testen, sondern:

1. 0 Layer verifizieren
2. geschätzten Wert testen
3. binäre Suche zwischen letztem stabilen und instabilen Wert
4. Sicherheitsreserve abziehen
5. finale Werte mit mehreren Prompts validieren

### Stufe D – Parameter-Tuning

Je GPU-Layer-Kandidat testen:

- Context: 2K / 4K / 8K, soweit unterstützt
- Batch: 64 / 128 / 256 / 512
- UBatch: 32 / 64 / 128
- Flash Attention: off / auto / on
- KV Cache: f16 / q8_0 / q4_0, soweit kompatibel
- Threads: 4 / 6 / physische Kerne
- CPU/GPU/Hybrid
- Vulkan-Gerät 0/1 und gegebenenfalls CUDA

### Stufe E – Persistenz

Speichern:

- `best_throughput`
- `best_low_latency`
- `safe_balanced`
- `cpu_fallback`
- `large_context`
- `vision_safe`

## 10. Benchmark-Suite

### Technische Messwerte

- Load Time
- Time to First Token
- Prompt Eval Token/s
- Generation Token/s
- Peak VRAM
- Peak RAM
- CPU/GPU Utilization
- Fehlerquote
- Warm-/Cold-Start
- Context-Stabilität
- 5-/15-/30-Minuten-Dauerlauf

### Funktionale Testklassen

- Chat/Instruct
- Coding Completion
- Code Repair
- Repository Q&A
- Tool Calling
- JSON/Schema Output
- Long Context
- Vision Understanding
- OCR optional
- Embedding
- Reranking
- Audio/ASR
- Image Generation

### Ergebnisstatus

- `DISCOVERED`
- `IDENTIFIED`
- `COMPATIBLE`
- `LOADABLE`
- `TUNED`
- `BENCHMARKED`
- `CERTIFIED`
- `DEGRADED`
- `QUARANTINED`
- `UNSUPPORTED`

## 11. Neue Model-Manager-UI

Die bisherige Fünf-Zeilen-Anzeige muss durch einen vollwertigen Model Manager ersetzt werden.

### Hauptansichten

1. **Inventory** – alle logischen Modelle und Varianten
2. **Sources** – Modellordner und Stores
3. **Discovery Jobs** – Scanfortschritt und Fehler
4. **Compatibility** – Runtime- und Capability-Matrix
5. **Tuning Lab** – GPU-Layer, Context, Batch, Threads
6. **Benchmarks** – Messwerte und Vergleiche
7. **Runtime** – laufende Instanzen, Ports, Logs, Ressourcen
8. **Profiles** – Task-/Hardwareprofile
9. **Failures** – Gründe, Logs, Reparaturaktionen
10. **Metadata** – lokale und Webinformationen

### Unverzichtbare Filter

- Runtime
- Format
- Capability
- Modellfamilie
- Parameterklasse
- Quantisierung
- Status
- Laufwerk/Source
- startbar/nicht startbar
- zertifiziert/nicht getestet
- GPU-fit
- Vision/MM
- Coding

Jedes ausgefilterte Modell muss einen sichtbaren Grund besitzen. Niemals Modelle kommentarlos verschwinden lassen.

## 12. Priorisierter Umsetzungsplan

### Phase 0 – Sofortige Reparatur

1. `_from_filesystem()` implementieren
2. Katalog + Scan zusammenführen statt exklusiv auswählen
3. alte und neue Runtime-/State-Schemas migrieren
4. Modell-IDs normalisieren und stabilisieren
5. mehrere Modellwurzeln unterstützen
6. UI-Slice entfernen und vollständigen Bestand zugänglich machen
7. Status „warum nicht startbar“ anzeigen
8. fehlschlagende Index-/Runtime-Tests reparieren

**Abnahmekriterium:** Physischer Bestand = erkannte Artefakte; jedes fehlende Artefakt hat einen protokollierten Ausschlussgrund.

### Phase 1 – Canonical Inventory

1. SQLite Model DB
2. Source Registry
3. inkrementeller Scan + Hash/Fingerprint
4. Logical Model Grouping
5. GGUF Header Parser
6. File Watcher
7. Scan Jobs mit Fortschritt und Abbruch

### Phase 2 – Runtime-Konsolidierung

1. gemeinsames Runtime Adapter Interface
2. Single Runtime und Multi-Server-Manager zusammenführen
3. Runtime Presets aus einer Quelle
4. vollständiger Command Builder
5. stdout/stderr Logstream
6. readiness statt Root-URL prüfen
7. Port- und Prozessverwaltung robust machen

### Phase 3 – Hardware Profiler und Auto-Tuning

1. CPU/RAM/GPU/Vulkan/CUDA erkennen
2. VRAM live messen
3. sichere GPU-Layer-Suche
4. Batch/UBatch/Threads/KV/Flash-Attention testen
5. Presets persistieren
6. automatische Fallback-Kette

### Phase 4 – Reale Benchmark Engine

1. Cold-/Warm-Load
2. TTFT, Prompt Eval, Generation
3. Ressourcen-Telemetrie
4. standardisierte Promptsets
5. Task-spezifische Qualitätschecks
6. reproduzierbare Runs und Reports

### Phase 5 – Capability und Informationsgewinnung

1. lokale Metadaten zuerst
2. Modellkarte/README/Config erkennen
3. optional Web-/Hugging-Face-/GitHub-Anreicherung
4. Quellen und Zeitstempel speichern
5. Konflikte zwischen lokaler und externer Information markieren
6. Chat Template und Startparameter automatisch ableiten

### Phase 6 – Zertifizierung und Routing

1. Modellzertifikat pro Hardwareprofil
2. Task-Eignung und Quality Score
3. dynamischer Model Router
4. automatische Auswahl nach Qualität, Geschwindigkeit, Context und Ressourcen
5. Degradations- und Quarantänehandling

## 13. Sofort zu ändernde technische Regeln

1. `models.catalog.json` darf niemals einen Scan verhindern.
2. `gpu_layers=None` darf nicht still zu CPU-only werden; stattdessen `UNPROFILED` anzeigen oder Safe-Tuning starten.
3. „Benchmark“ darf nur reale Messungen bezeichnen.
4. Jeder Filter benötigt einen maschinenlesbaren Ausschlussgrund.
5. Runtime-, Profil- und Benchmark-Konfiguration müssen dieselbe Preset-Entität verwenden.
6. Modellstatus darf nicht aus Dateinamen allein abgeleitet werden.
7. Vision/MMProj/Adapter müssen als zusammengehörige Modellgraphen geführt werden.
8. Alle Modellquellen müssen über die UI verwaltbar sein.
9. Index-Refresh muss inkrementell und reproduzierbar sein.
10. Tests müssen einen Bestand mit mindestens mehreren Sources, Shards, MMProj, LoRA, Ollama und defekten Artefakten abdecken.

## 14. Produktionsreife: zusätzliche Empfehlungen

- Scan und Benchmark als persistente Jobs mit Resume-Funktion
- Prozess-Isolation pro Modelltest
- harte Timeouts und Memory Guards
- Crash- und OOM-Erkennung
- Quarantäne statt Endlosschleifen
- Benchmark-Versionierung
- Hardware-Fingerprint pro Ergebnis
- Log-Rotation
- DB-Backups und Migrationstests
- Export eines maschinenlesbaren Model Capability Manifest
- keine pauschalen Capability-Vermutungen ohne Confidence Score
- reproduzierbare Zertifikate mit Runtime-Version, Treiber, Modellhash und Preset

## 15. Konkrete Schlussfolgerung

Die fehlenden Modelle scheitern nicht primär an deiner Hardware. Sie scheitern zuerst an einer **unvollständigen Inventarisierungs- und Integrationskette**:

- statischer Katalog statt vollständiger Discovery
- fehlender Scanner
- nur eine Modellwurzel
- inkonsistente JSON-Schemas
- Filter ohne sichtbare Ursachen
- CPU-only Default bei fehlendem GPU-Profil
- theoretische statt reale Benchmarks
- nicht angebundene Profilfunktionen

Die richtige Revision ist deshalb kein kosmetischer Runtime-Tab-Umbau, sondern ein zusammenhängendes **Model Lifecycle Subsystem** für Codee.
