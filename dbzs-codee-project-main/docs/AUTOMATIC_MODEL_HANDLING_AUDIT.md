# AUTOMATIC MODEL HANDLING AUDIT
## Codename: Dedicated NVIDIA GPU Multi-Model Teardown

Dieses Dokument beschreibt den Audit und das detaillierte Konzept für das automatische Multi-Model-Handling auf dem Zielsystem mit dedizierter NVIDIA GTX 1650 SUPER.

---

## 1. Hardware-Ausgangszustand & Randbedingungen

Das Zielsystem hat folgende Spezifikationen und Rollenverteilungen:

| Komponente | Hardware-Spezifikation | Zugewiesene Rolle |
| :--- | :--- | :--- |
| **AMD Ryzen 5 5600G** | 6 Kerne / 12 Threads, 32 GB RAM | CPU-first Inferenz (`quality_cpu`), Backend, Build- und Test-Prozesse |
| **AMD Radeon Graphics** | Ryzen 5 5600G iGPU | Windows Desktop, Monitore, UI-Darstellung (Electron) – **Keine LLM Inferenz** |
| **NVIDIA GTX 1650 SUPER** | Discrete GPU, 4 GB VRAM | Exklusiv für Codee lokale Inferenz (`fast_gpu`), Vulkan Acceleration |

### 1.1 VRAM-Budget der NVIDIA GPU
- **VRAM Total:** 4096 MB (laut `nvidia-smi`)
- **VRAM-Sicherheitsreserve:** 512 MB (für Vulkan-Treiber, Compute-Buffer, KV-Cache, llama.cpp-Overhead, temporäre Allokationen)
- **Netto-Modellbudget:** Maximal **~3500 MB** für Modellgewichtungen und aktiven KV-Cache.

---

## 2. Ist-Zustand der Codebase & Repair Round 2 Audit

Eine detaillierte Prüfung der vorhandenen Inferenz- und Profil-Architektur zeigt:

### Repair Round 2 – Statusübersicht

- ✅ Globaler Start-Config-State wurde aus dem parallelen Startpfad entfernt; `RuntimeService.start_model` verwendet jetzt eine slot-spezifische Konfiguration pro Aufruf.
- ✅ Der Default-Profile-Pfad kann jetzt aus dem lokalen Model-Index einen realen `nvidia-gpu-cpu`-Profile-Stack erzeugen, ohne Platzhalter-IDs wie `qwen-2b` oder `coder`.
- ✅ Chat- und Stream-Anfragen verwenden jetzt einen request-spezifischen Zielkontext über `resolve_chat_target`, sodass done-Events den korrekten Slot und Modellnamen liefern.
- ✅ Der stille Fallback auf den ersten laufenden Slot wurde entfernt; standardmäßig gilt `fallback_policy="strict"`.
- ✅ Slot-spezifische Runtime-APIs sind über `/runtime/slots` und `/runtime/slots/{slot_id}/...` verfügbar.
- ✅ Die Python- und TypeScript-Contracts enthalten jetzt typed Slot-Unterstützung über `RuntimeSlotId` und `RuntimeSlotStatus`.
- ✅ Die relevanten Backend-Regressionstests und der Workspace-Build laufen erfolgreich.

1. **`RuntimeService` (`backend/app/runtime/service.py`):**
   - Verwaltet derzeit exakt einen Prozess (`self._process`).
   - Ein Aufruf von `start_model` stoppt ein eventuell bereits laufendes Modell.
   - **Problem:** Für parallelen Multi-Model-Betrieb muss der `RuntimeService` fähig sein, mehrere Prozesse in verschiedenen Slots (`fast_gpu`, `quality_cpu`, `utility`) unabhängig voneinander zu starten, zu überwachen und zu stoppen, ohne dass sie sich gegenseitig terminieren.

### Detaillierte Fehleranalyse und Schwachstellen

1. **Race Condition durch das globale Feld `_start_config_override`:**
   - Der `RuntimeService` besitzt ein globales Feld `self._start_config_override`, welches bei zeitgleichen Startanfragen von verschiedenen Threads überschrieben wird. Da `MultiServerManager` versucht, mehrere Services abzustimmen, führt dies zu verfälschten Port- und Hardwarezuweisungen.
2. **Fehlende reale Auflösung der Profil-Modell-IDs:**
   - In den vordefinierten Hardwareprofilen sind IDs wie `qwen-2b` oder `coder` hinterlegt. Das System besitzt keine robuste Auflösung (LocalModelResolver), welche diese IDs anhand des realen Model-Index auf tatsächliche im System heruntergeladene und installierte Modelle mappt.
3. **Platzhalter im Default-Profil:**
   - Ohne dynamische Erzeugung des NVIDIA-CPU-Profils aus dem real vorhandenen GGUF-Katalog belegt das System nicht-existente Pfade oder bricht ab.
4. **Stiller Fallback auf `running_slots[0]`:**
   - Ist der gewünschte Ziel-Slot für eine Anfrage nicht bereit oder offline, weicht das System unbemerkt auf irgendeinen beliebigen gerade laufenden Slot aus, was schwerwiegende Störungen und Verwechslungen verursacht. Wir benötigen eine explizite Fallback-Policy (`strict` vs `allow_local_fallback`).
5. **Falsche Stream-Metadaten durch `service.status()`:**
   - Der Streaming-Endpunkt liest den Status nach dem Stream-Abschluss rein global aus `service.status()`. Bei parallelen GPU/CPU-Anfragen führt dies dazu, dass im `done`-Event falsche Modellnamen und Slots an den Client geschickt werden. Jede Streaming-Verbindung benötigt einen request-spezifischen `RuntimeStreamContext`.
6. **Unvollständige TypeScript-Contracts für `slot_id`:**
   - Die Typdefinitionen zwischen Python und TypeScript (Electron / Frontend UI) sind asynchron. Es fehlen verlässliche TypeScript-Typen für Slots (`fast_gpu`, `quality_cpu`, `utility`), was zu `any`-Casts führt.
7. **Fehlender echter GPU-Layer-Benchmark:**
   - Bislang basieren die GPU-Schichten auf Schätzungen. Ein echter, sequenziell arbeitender In-Process-Benchmark zur iterativen Ermittlung stabiler GPU-Schichten (z.B. 8 -> 16 -> 24 -> 32 -> Full) fehlt völlig.
8. **Fehlende Utility-On-Demand-Logik:**
   - Embeddings und Reranker müssen bedarfsgesteuert geladen und nach 60 Sekunden Inaktivität (Idle Unload) wieder entladen werden, um VRAM und RAM zu schonen.
9. **Fehlende Eskalation und Model-Handover:**
   - Es existiert kein Mechanismus, der fehlerhafte Versuche der `fast_gpu` (z.B. fehlerhafter Code-Output) an die robustere `quality_cpu` mit einem strukturierten Handover-Objekt überleitet.
10. **Fehlende Desktop-Integration für Runtime-Slots:**
    - Es mangelt an einem vollständigen Bedienfeld und Cockpit im Electron-Client, das alle Parameter der 3 Slots (CPU-Layer, Kontext, RAM, VRAM, T/s, First Token) steuerbar macht.
11. **Fehlende echte CPU-/GPU-Abnahmetests:**
    - Die Verifikation muss echte simultane Aufrufe und den Benchmark physisch abdecken.

2. **`MultiServerManager` (`backend/app/runtime/multi_server_manager.py`):**
   - Unterstützt bereits das gleichzeitige Starten mehrerer Modellserver (über Profile).
   - Registriert PIDs in `self._process_pids` und überwacht die Ressourcennutzung mit `psutil`.
   - **Problem:** Ruft intern `RuntimeService.start_model_with_config` auf, was bei mehreren Modellen zu Kollisionen auf Modulebene führt. Der `MultiServerManager` muss eng mit einem Slot-basierten `RuntimeService` harmonieren.

3. **GPU-Erkennung (`backend/app/runtime/gpu_detect.py`):**
   - Verwendet `nvidia-smi` und `rocm-smi`, liefert aber nur die erste gefundene GPU zurück.
   - **Problem:** Auf Systemen mit AMD iGPU + NVIDIA dGPU kann es zu Fehlerkennungen kommen, wenn die AMD-Grafik fälschlicherweise als primäre Compute-GPU identifiziert wird. Es muss sichergestellt werden, dass die NVIDIA GPU als Compute-GPU und die AMD iGPU als Display-GPU eingestuft wird.

---

## 3. Zielarchitektur: Drei Runtime-Slots

Codee verwaltet die Modelle in drei getrennten Slots mit dedizierten Portzuweisungen und Geräte-Policies:

```text
+---------------------------------------------------------------------------------+
|                               DBZS Codee Backend                                |
+---------------------------------------+-----------------------------------------+
                                        |
          +-----------------------------+-----------------------------+
          |                             |                             |
          v                             v                             v
   [Slot: fast_gpu]             [Slot: quality_cpu]            [Slot: utility]
   Port: 8081                   Port: 8082                     Port: 8083
   Device: NVIDIA GPU           Device: CPU Only               Device: CPU (On Demand)
   Modell: Qwen3.5-2B (GPU)     Modell: Qwen2.5-Coder-7B (CPU) Modell: Embedding/Reranker
```

### 3.1 Slot-Konfigurationen

1. **`fast_gpu` (Port 8081):**
   - **Geräte-Policy:** Dedizierte NVIDIA GPU (Vulkan).
   - **Zielmodelle:** `Qwen3.5-2B Q5_K_M` (~1.65 GB), `Qwen2.5-Coder-3B Q4_K_M` (~2.1 GB).
   - **Aufgaben:** Normaler Chat, Intent-Erkennung, Router, Zusammenfassungen, schnelle Analysen.
   - **Kontext:** 8192 Tokens.

2. **`quality_cpu` (Port 8082):**
   - **Geräte-Policy:** Reiner CPU-Betrieb (`--n-gpu-layers 0`).
   - **Zielmodell:** `Qwen2.5-Coder-7B-Instruct Q4_K_M` (~4.8 GB).
   - **Aufgaben:** Komplexe Coding-Tasks, Multi-File-Analysen, Debugging, Reviews.
   - **Kontext:** 8192 Tokens.

3. **`utility` (Port 8083):**
   - **Geräte-Policy:** CPU-first (On-demand geladen, sofort nach Inferenz entladen).
   - **Zielmodelle:** `Qwen3-Embedding-0.6B`, `Qwen3-Reranker-0.6B`.
   - **Aufgaben:** RAG, Dokumentensuche, Reranking.

---

## 4. Ressourcenmodell & Berechnungsformel

Um VRAM-Overcommitments auf der 4 GB GTX 1650 SUPER zu verhindern, wird folgendes Berechnungsmodell für jeden GPU-Start angewendet:

$$\text{VRAM}_{\text{geschätzt}} = \text{Dateigröße}_{\text{Modell}} + \text{VRAM}_{\text{KV-Cache}} + \text{Compute-Buffer} + \text{Treiber-Reserve}$$

Dabei gilt:
- **Modell-VRAM:** Entspricht der GGUF-Dateigröße, multipliziert mit dem Anteil der auf die GPU ausgelagerten Layer ($\frac{N_{\text{gpu\_layers}}}{N_{\text{total\_layers}}}$).
- **KV-Cache VRAM:** Berechnet auf Basis der Kontextgröße ($N_{\text{ctx}}$), Batch-Größe und Cache-Typ (z. B. `q8_0` benötigt ca. 8-Bit pro Key/Value-Eintrag).
- **Treiber-Reserve:** Konstanter Wert von **512 MB**.
- **Entscheidungskriterium:** Ein Modell darf nur auf die NVIDIA GPU geladen werden, wenn die geschätzte VRAM-Belegung den freien VRAM abzüglich der 512 MB Sicherheitsreserve nicht überschreitet. Andernfalls wird ein CPU-Fallback erzwungen.

---

## 5. Implementierungs- und Integrationsplan

### Schritt A: Erweiterung des Modells
- Definition der Datenstrukturen `RuntimeSlotId` und `RuntimeSlot` in `app.runtime.schemas`.
- Anpassung von `RuntimeStatus` zur Aufnahme von Slot-Informationen und Ressourcendetails.

### Schritt B: Slot-Awareness in `RuntimeService`
- Umbau von `self._process` zu `self._slots: dict[RuntimeSlotId, ManagedProcess]`.
- Anpassung der API-Endpunkte unter `/runtime` (oder Erweiterung um Slot-Parameter), damit Anfragen wie `/runtime/chat` gezielt an den richtigen Slot geroutet werden.

### Schritt C: GPU-Erkennung anpassen
- In `gpu_detect.py` sicherstellen, dass bei der Auflistung von GPUs die AMD Radeon iGPU als "Display-only" und die NVIDIA GTX als "Compute-capable" markiert wird.

### Schritt D: Eskalation und Handover implementieren
- Mechanismen zur automatischen Weiterleitung von Aufgaben an den `quality_cpu`-Slot bereitstellen, wenn der `fast_gpu`-Slot die Aufgabe nach zwei Versuchen (z. B. wegen Syntaxfehlern im Code) nicht lösen kann.
- Implementierung eines strukturierten `ModelHandover`-Objekts zur Übergabe des komprimierten Zustands.

---

## 6. Verifikationsplan (QA Gates)

### Automatisierte Tests
- **Hardware-Profiler Test:** Erkennung von AMD iGPU und NVIDIA dGPU validieren.
- **Ressourcen-Fit Test:** VRAM-Kalkulation und Fallback auf CPU bei Überschreitung des Budgets testen.
- **Parallelbetriebs-Test:** Starten beider Server (Port 8081 und 8082) und zeitgleiche Abfrage.
- **Routing-Test:** Intent-Routing basierend auf Komplexität verifizieren.

### Manuelle Tests (Abnahmeprotokoll)
- **Test 1:** GPU-Rollenprüfung im System.
- **Test 2:** Start von `Qwen3.5-2B` auf `fast_gpu` (Port 8081).
- **Test 3:** Start von `Qwen2.5-Coder-7B` auf `quality_cpu` (Port 8082).
- **Test 4:** Gleichzeitiges Senden von Chat-Anfragen an beide Ports.
- **Test 5:** On-demand Aufruf des Embedding-Modells.
