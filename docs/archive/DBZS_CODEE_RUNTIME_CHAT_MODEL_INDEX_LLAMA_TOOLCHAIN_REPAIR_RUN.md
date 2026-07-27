# Division By Zeros (DBZS) Codee
# Repair Run – Runtime Chat, Model Index und llama.cpp Toolchain

## 0. Ziel

Dieser Repair Run stabilisiert zuerst die gesamte Kommunikationskette von der Chat-Eingabe bis zum lokalen llama.cpp-Prozess.

Der Schwerpunkt liegt nicht auf weiterem Feature-Ausbau, sondern auf einer kontrollierten technischen Bereinigung:

```text
Benutzereingabe
→ Task-Klassifikation
→ genau ein Model Broker
→ genau ein Zielslot
→ genau ein Modell
→ kontrollierter Kontextaufbau
→ llama-server
→ Stream
→ sichtbare Antwort und Diagnose
```

Erst wenn dieser Pfad stabil funktioniert, wird das automatische Multi-Model-Handling wieder vollständig aktiviert.

---

# 1. Beobachtetes Fehlverhalten

Aktuell funktioniert eine triviale Eingabe wie:

```text
Hallo
```

häufig zuverlässig.

Sobald eine Nachricht etwas länger oder technisch formuliert ist, treten auf:

```text
First-Token-Timeouts
Gesamt-Timeouts
Slot-Fehler
abgebrochene Streams
mehrfache Wiederholungen
nicht sichtbare Backend-Änderungen
```

Die wahrscheinlichste Ursache ist nicht primär das Modell, sondern die Kommunikationsarchitektur.

Aktuell laufen mehrere unabhängige Entscheidungs- und Verarbeitungsschritte:

```text
Frontend-Klassifikation
→ Agentenentscheidung
→ Frontend-Modellrouter
→ globaler Runtime-Check
→ Kontextaufbau
→ Orchestrierung
→ Tool-Entscheidung
→ Backend-Router
→ Backend-Slot-Router
→ llama-server
```

Mehrere Komponenten können dabei unterschiedliche Modelle oder Slots wählen.

---

# 2. Kritischer Fehler: Nachrichtenlänge aktiviert Agentenmodus

Die aktuelle Frontend-Klassifikation behandelt praktisch jede Nachricht mit mehr als ungefähr 20 Zeichen als Coding- oder Tool-Aufgabe.

Das ist falsch.

Beispiel:

```text
Kannst du mir das bitte genauer erklären?
```

darf nicht automatisch den Agentenloop auslösen.

## Neue Regel

Der Agentenloop darf nur starten bei:

```text
ausdrücklichem Agentenmodus
eindeutigem Coding-Auftrag
eindeutigem Toolauftrag
Patch-Anforderung
Review-Anforderung
Debugging-Anforderung
Dateiänderungs-Anforderung
```

Nicht ausreichend sind:

```text
Textlänge
normale technische Begriffe
allgemeine Erklärungsfragen
eine längere normale Chatnachricht
```

Die Regel `cleaned.length > 20` ist vollständig zu entfernen.

---

# 3. Ein zentraler Model Broker

Frontend und Backend dürfen nicht unabhängig voneinander neu routen.

Es muss genau eine verbindliche Routingentscheidung geben.

## Zielcontract

```typescript
export interface ModelSelectionDecision {
  taskType: ModelTaskType;
  targetAgent: ModelTargetAgent;
  slotId: RuntimeSlotId;
  modelId: string;
  modelName: string;
  providerId: "llama-cpp";
  reason: string[];
  fallbackPolicy: "strict" | "allow_local_fallback";
  contextBudgetTokens: number;
}
```

Die Entscheidung wird einmal erzeugt und unverändert durchgereicht:

```text
UI
→ Store
→ AgentRunService
→ Electron
→ Backend
→ RuntimeService
```

Das Backend darf nicht anschließend erneut anhand von Keywords einen anderen Slot wählen.

---

# 4. Verbindliche Kommunikationskette

Die neue Reihenfolge lautet:

```text
1. Nachricht annehmen
2. Task klassifizieren
3. Model Broker entscheidet Slot und Modell
4. exakt gewählten Slot prüfen
5. bei Bedarf Slot kontrolliert starten
6. Kontext mit eigenem Timeout vorbereiten
7. Modellrequest aufbauen
8. HTTP-/Streamingrequest starten
9. erst jetzt First-Token-Timer starten
10. Stream empfangen
11. Antwort auswerten
12. Run abschließen
```

Keine globale Runtime-Prüfung mehr nach dem Prinzip:

```text
Irgendeine Runtime läuft
```

Stattdessen:

```text
Der gewählte Slot läuft
und enthält das gewählte Modell
```

---

# 5. Stage-spezifische Timeouts

Der First-Token-Timer darf nicht während Routing, Kontextaufbau oder Orchestrierung laufen.

## Vorgeschlagene Timeouts

```text
Runtime-Statusprüfung: 5 Sekunden
Model-Broker-Entscheidung: 5 Sekunden
Kontextaufbau: 15 Sekunden
Orchestrierung: 15 Sekunden
Tool-Vorbereitung: 15 Sekunden
First Token: ab echtem Modellrequest
Gesamtlaufzeit: modell- und aufgabenabhängig
```

## First-Token-Regel

```text
firstTokenTimer.start()
```

darf erst unmittelbar vor dem tatsächlichen HTTP-Request an `llama-server` ausgeführt werden.

Beim ersten Stream-Delta:

```text
firstTokenTimer.stop()
```

---

# 6. Echter Abort

Der Abbruch muss vollständig durchgereicht werden:

```text
UI AbortController
→ RuntimeChatStore
→ AgentRunService
→ Electron IPC
→ Fetch AbortSignal
→ Backend StreamingResponse
→ Verbindung zu llama-server
```

Nach einem Abbruch darf kein alter Modellrequest im Hintergrund weiterlaufen.

## Abnahmekriterium

```text
Run abbrechen
→ Stream endet
→ Backend beendet Request
→ Slot bleibt gesund
→ nächste Anfrage funktioniert sofort
```

---

# 7. Retry-Regeln

Die aktuelle mehrfache automatische Wiederholung kann Fehler vervielfachen.

## Neue Regeln

### Transportfehler vor Requestbeginn

```text
maximal 1 Wiederholung
```

### First-Token-Timeout

```text
keine automatische Wiederholung
```

### Benutzerabbruch

```text
keine automatische Wiederholung
```

### HTTP 400 wegen Toolformat

```text
genau ein kontrollierter Versuch ohne Tools
```

### Leerer Stream

```text
ein Non-Streaming-Diagnoseversuch
nur wenn kein Abort und kein Timeout vorliegt
```

Keine Retry-Lawine.

---

# 8. Project Local Strict Model Index

Während der Reparatur wird nur dieser Modellordner verwendet:

```text
C:\Users\ralle\source\repos\dbzs-codee-project\models
```

## Erlaubt

```text
GGUF-Dateien innerhalb dieses Verzeichnisses
projektlokale models.catalog.json
projektlokale models.runtime.json
projektlokale models.state.json
projektlokale llama.cpp-Runtime
```

## Deaktiviert

```text
Ollama
D:\Models
F:\Models
H:\Models
Benutzer-.ollama
globale Modellsuche
externe Runtime-Verzeichnisse
Cloudmodelle
Cloud-Fallback
```

## Neuer Source Mode

```typescript
export type ModelSourceMode =
  | "project_local_strict"
  | "configured"
  | "discovery";
```

Während dieses Repair Runs gilt:

```text
project_local_strict
```

---

# 9. Pfadregeln

## Models Root

```text
C:\Users\ralle\source\repos\dbzs-codee-project\models
```

## Runtime Root

```text
C:\Users\ralle\source\repos\dbzs-codee-project\models\llama.cpp-win-runtime
```

Alle Modell- und Runtimepfade müssen innerhalb dieses Projekt-Roots liegen.

## Externe Katalogpfade

Ein Katalogeintrag außerhalb des Projektordners wird abgelehnt:

```text
model_outside_project_root
```

Kein stilles Umleiten auf externe oder gleichnamige Dateien.

---

# 10. Stabile Modell-IDs

Modell-IDs dürfen nicht vom absoluten Windows-Pfad abhängen.

## Richtig

```text
gguf/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf
```

wird zur stabilen ID-Grundlage.

Beispiel:

```python
relative_path = model_path.relative_to(models_dir)
model_id = stable_id(relative_path.as_posix().lower())
```

Dadurch bleiben IDs stabil, wenn das Repository verschoben wird.

---

# 11. Model Index und Runtime Registry trennen

## Model Index

Enthält ausschließlich Modellinformationen:

```text
GGUF-Datei
relativer Pfad
absoluter Pfad
Größe
Quantisierung
Architektur
Rollen
Fähigkeiten
Kontext
Kompatibilität
Health-Status
```

## Llama Runtime Tool Registry

Enthält ausschließlich ausführbare llama.cpp-Werkzeuge:

```text
Executable
Pfad
Version
Verfügbarkeit
Aufgabe
Execution Mode
letzter Test
letzter Exit-Code
```

Model Index und Runtime Registry dürfen nicht vermischt werden.

---

# 12. llama.cpp Toolchain

## P0 – sofort integrieren

```text
llama-server.exe
llama-cli.exe
llama-bench.exe
llama-tokenize.exe
```

## P1 – danach

```text
llama-batched-bench.exe
llama-perplexity.exe
llama-gguf-split.exe
```

## P2 – später

```text
llama-quantize.exe
llama-imatrix.exe
RPC-Werkzeuge
TTS-Werkzeuge
Multimodal-/MTMD-Werkzeuge
```

---

# 13. Rollen der Werkzeuge

## llama-server

```text
Chat
Streaming
Agenten
Tool Calling
Embedding-API
dauerhafter Dienst
```

## llama-cli

```text
direkter Modelltest
Chat-Template-Test
Smoketest
Router und Backend umgehen
```

## llama-bench

```text
CPU-/GPU-Benchmark
Prompt-Durchsatz
Generationstempo
GPU-Layer-Vergleich
Hardwareprofil
```

## llama-tokenize

```text
reale Prompt-Tokenzahl
Kontextbudget
Überlaufprüfung
```

## llama-batched-bench

```text
Batching
Parallelität
Durchsatz
UBatch-Tests
```

## llama-perplexity

```text
Quantisierungen desselben Modells vergleichen
Qualitätsindikator
```

## llama-gguf-split

```text
gesplittete GGUF-Dateien prüfen
zusammenführen
verwalten
```

## llama-quantize

```text
eigene kleinere Quantisierungen erzeugen
```

## llama-imatrix

```text
Importance Matrix erzeugen
Quantisierungsqualität verbessern
```

---

# 14. Runtime Tool Registry Contract

```typescript
export type LlamaRuntimeToolId =
  | "server"
  | "cli"
  | "bench"
  | "batched_bench"
  | "tokenize"
  | "perplexity"
  | "gguf_split"
  | "quantize"
  | "imatrix"
  | "rpc"
  | "tts"
  | "multimodal";

export interface LlamaRuntimeTool {
  id: LlamaRuntimeToolId;
  executableName: string;
  executablePath: string;
  available: boolean;
  version: string | null;
  capabilities: string[];
  executionMode: "service" | "job";
  lastTestAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
}
```

---

# 15. Manager-Struktur

## LlamaServerManager

Verantwortlich für:

```text
dauerhafte llama-server-Prozesse
Ports
Slots
Start
Stop
Health
Readiness
Streaming
Logs
```

## LlamaJobRunner

Verantwortlich für:

```text
llama-cli
llama-bench
llama-tokenize
llama-perplexity
kurze kontrollierte Prozesse
Timeout
stdout
stderr
Exit-Code
Abort
```

## LlamaModelWorkshop

Verantwortlich für:

```text
llama-quantize
llama-imatrix
llama-gguf-split
lange Offline-Jobs
Fortschritt
Artefakte
Abbruch
```

---

# 16. Runtime Bundle Discovery

Codee muss das projektlokale Runtime-Verzeichnis inventarisieren.

```text
C:\Users\ralle\source\repos\dbzs-codee-project\models\llama.cpp-win-runtime
```

## Zu erfassen

```text
*.exe
*.dll
Runtime-Version
Build-Information
CPU-Backend
Vulkan-Backend
OpenSSL-Abhängigkeiten
```

## Beispielausgabe

```json
{
  "runtimeRoot": "C:/Users/ralle/source/repos/dbzs-codee-project/models/llama.cpp-win-runtime",
  "version": "detected-version",
  "backend": {
    "cpu": true,
    "vulkan": true
  },
  "tools": {
    "server": true,
    "cli": true,
    "bench": true,
    "tokenize": true,
    "perplexity": false
  }
}
```

Keine erfundenen Fähigkeiten.

---

# 17. Diagnosekette

Jedes Modell muss auf vier getrennten Ebenen getestet werden.

## Ebene A – llama-cli

```text
Modell laden
Prompt senden
Chat-Template prüfen
Exit-Code prüfen
```

## Ebene B – llama-server direkt

```text
Server starten
Health prüfen
direkten HTTP-Request senden
Streaming prüfen
First Token messen
```

## Ebene C – Codee Backend

```text
festes Modell
fester Slot
kein Frontend-Router
kein Agentenloop
Backend-Transport prüfen
```

## Ebene D – vollständige UI

```text
UI
→ Model Broker
→ Kontext
→ Agent
→ Backend
→ llama-server
```

## Fehlerzuordnung

```text
CLI scheitert
→ Modell, Template, Parameter oder Runtime

CLI läuft, Server scheitert
→ Server, HTTP, Streaming oder Startparameter

Server läuft, Backend scheitert
→ Python-Transport oder Backend-Routing

Backend läuft, UI scheitert
→ Electron, Preload, Store, Agentenloop oder UI-Timeout
```

---

# 18. Tokenbudget mit llama-tokenize

Vor einer großen Anfrage soll Codee die reale Tokenzahl bestimmen.

Zu tokenisieren:

```text
Systemprompts
Chatverlauf
aktive Datei
Workspace-Kontext
Toolbeschreibungen
Memory
Orchestrierung
erwartete Antwortreserve
```

## Ergebnis

```typescript
export interface PromptBudget {
  promptTokens: number;
  reservedResponseTokens: number;
  totalTokens: number;
  contextLimit: number;
  fits: boolean;
  requiredReductionTokens: number;
}
```

Bei Überlauf:

```text
Kontext reduzieren
Verlauf komprimieren
Dateiinhalt kürzen
irrelevante Tools entfernen
oder klaren Fehler anzeigen
```

---

# 19. Echte Benchmarks mit llama-bench

Codee soll reale Modellprofile erzeugen.

Beispiel:

```json
{
  "modelId": "qwen25-coder-3b-q4km",
  "device": "nvidia-vulkan",
  "contextSize": 8192,
  "gpuLayers": 32,
  "promptTokensPerSecond": 105.4,
  "generationTokensPerSecond": 21.7,
  "stable": true
}
```

Für CPU:

```json
{
  "modelId": "qwen25-coder-7b-q4km",
  "device": "cpu",
  "threads": 5,
  "contextSize": 8192,
  "generationTokensPerSecond": 5.4,
  "stable": true
}
```

Der bisherige mathematische Fit-Score darf nicht als echter Benchmark bezeichnet werden.

---

# 20. UI-Verkabelung

Die gesamte Kette muss geschlossen werden:

```text
Backend API
→ Electron IPC
→ Preload Bridge
→ BackendClient
→ Store
→ React UI
```

## Runtime Slots

```text
Fast GPU
Quality CPU
Utility
```

Je Slot sichtbar:

```text
Status
Modell
Port
PID
Gerät
GPU-Layer
Kontext
First Token
Tokens/s
Start
Stopp
Logs
Diagnose
```

## Model Index

```text
Source Mode
Models Root
Runtime Root
gefundene GGUF-Dateien
abgelehnte externe Pfade
Katalogfehler
Index-Neuaufbau
```

## llama.cpp Tools

```text
Executable
Version
verfügbar
Aufgabe
letzter Test
Exit-Code
Start Test
```

## Chat Run

```text
Task Type
Zielagent
gewähltes Modell
gewählter Slot
Routinggrund
Kontextgröße
Tokenbudget
aktuelle Stage
aktiver Timeout
```

---

# 21. Multi-Model-Betrieb nach Stabilisierung

Die Zielbelegung bleibt:

```text
fast_gpu:
kleines 2B-/3B-Modell auf GTX 1650 SUPER

quality_cpu:
7B-Coder auf CPU/RAM

utility:
Embedding/Reranker on demand
```

Diese Automatik wird erst vollständig aktiviert, wenn der Single-Spine-Test stabil ist.

---

# 22. Implementierungsphasen

## Phase 0 – Scope Freeze

```text
keine neuen Modelle
keine neuen Agenten
keine zusätzliche Routerlogik
keine Cloudintegration
```

## Phase 1 – Communication Spine

```text
Agentenloop-Klassifikation reparieren
einen zentralen Model Broker einführen
Zielslotprüfung
Stage-Timeouts
echter Abort
Retry-Regeln
```

## Phase 2 – Project Local Strict Index

```text
ein Models Root
Ollama aus
externe Pfade aus
stabile IDs
Pfadvalidierung
```

## Phase 3 – Runtime Tool Registry

```text
Executables inventarisieren
Versionen erkennen
P0-Werkzeuge integrieren
```

## Phase 4 – Diagnosejobs

```text
llama-cli
llama-server direkt
llama-bench
llama-tokenize
```

## Phase 5 – UI-Verkabelung

```text
Slot-Cockpit
Model-Index-Ansicht
Runtime-Tool-Ansicht
Run-Transparenz
```

## Phase 6 – Multi-Model-Reaktivierung

```text
2B/3B GPU
7B CPU
kontrollierte Eskalation
Utility on demand
```

## Phase 7 – Erweiterte Werkzeuge

```text
batched-bench
perplexity
gguf-split
quantize
imatrix
```

---

# 23. Tests

## Test 1 – einfacher Chat

Eingabe:

```text
Hallo
```

Erwartung:

```text
Fast Path
kein Agentenloop
Antwort
```

## Test 2 – längere normale Frage

Eingabe:

```text
Kannst du mir ausführlich erklären, wie der aktuelle Model Index arbeitet?
```

Erwartung:

```text
normaler Chat
kein Agentenloop nur wegen Textlänge
kein Timeout
```

## Test 3 – Coding-Aufgabe

Eingabe:

```text
Prüfe runtimeChatStore.ts und nenne die Ursache des frühen Timeouts.
```

Erwartung:

```text
Coding Task
quality_cpu
Zielslot vorher geprüft
First-Token-Timer erst beim Modellrequest
```

## Test 4 – Zielslot offline

Erwartung:

```text
target_slot_unavailable
kein stiller Wechsel
Startoption in UI
```

## Test 5 – llama-cli

```text
gleiches Modell
gleicher Prompt
direkter CLI-Test
```

## Test 6 – llama-server direkt

```text
gleicher Prompt
direkter HTTP-Test
```

## Test 7 – Project Local Strict

Erwartung:

```text
nur Modelle unter:
C:\Users\ralle\source\repos\dbzs-codee-project\models
```

## Test 8 – Runtime Registry

Erwartung:

```text
alle vorhandenen llama-Executables inventarisiert
keine erfundenen Werkzeuge
```

## Test 9 – Abort

Erwartung:

```text
UI stoppt
Fetch stoppt
Backend-Stream stoppt
Slot bleibt gesund
nächste Anfrage funktioniert
```

## Test 10 – Tokenbudget

Erwartung:

```text
reale Tokenzahl
Überlauf wird vor Request erkannt
```

## Test 11 – Benchmark

Erwartung:

```text
llama-bench läuft
reale Messwerte werden gespeichert
```

---

# 24. Qualitätsgates

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

Zusätzlich:

```text
CLI-Test
Server-Direkttest
Backend-Test
UI-End-to-End-Test
```

Nicht ausgeführte Tests als `NOT RUN` dokumentieren.

---

# 25. Definition of Done

- [ ] Die Regel `cleaned.length > 20` ist entfernt.
- [ ] Längere normale Nachrichten bleiben normaler Chat.
- [ ] Es existiert genau ein verbindlicher Model Broker.
- [ ] Frontend und Backend routen nicht unabhängig.
- [ ] Zielslot und Modell stehen vor dem Request fest.
- [ ] Der exakt gewählte Slot wird geprüft.
- [ ] First-Token-Timer startet erst beim echten Modellrequest.
- [ ] Routing, Kontext und Orchestrierung haben eigene Timeouts.
- [ ] Abort erreicht den Transport und Backend-Stream.
- [ ] Keine Retry-Lawine.
- [ ] Nur der projektlokale Modellordner wird indexiert.
- [ ] Ollama und externe Modellquellen sind deaktiviert.
- [ ] Externe Katalogpfade werden abgelehnt.
- [ ] Modell-IDs basieren auf relativen Pfaden.
- [ ] Model Index und Runtime Registry sind getrennt.
- [ ] llama-server, llama-cli, llama-bench und llama-tokenize sind integriert.
- [ ] CLI-, Server-, Backend- und UI-Diagnose sind getrennt verfügbar.
- [ ] Runtime Slots sind in der UI sichtbar.
- [ ] Model Index ist in der UI sichtbar.
- [ ] Runtime Tool Registry ist in der UI sichtbar.
- [ ] Typecheck, Tests und Build sind grün.
- [ ] Manuelle Tests sind dokumentiert.

---

# 26. Commit-Reihenfolge

```text
docs(runtime): define communication spine repair scope
fix(chat): remove message-length agent-loop trigger
feat(routing): add single authoritative model broker
fix(runtime): validate selected target slot before request
fix(chat): move first-token timer to transport start
fix(chat): propagate abort through electron backend and llama stream
fix(chat): replace retry cascade with explicit retry policy
feat(models): add project-local-strict source mode
fix(models): reject model paths outside project root
fix(models): generate stable ids from relative paths
feat(runtime): add llama runtime tool registry
feat(runtime): add llama cli diagnostic runner
feat(runtime): add llama bench runner
feat(runtime): add llama tokenize prompt budgeting
feat(ui): expose runtime slots model index and llama tools
test(runtime): cover direct cli server backend and ui paths
docs(runtime): document verified local llama workflow
```

---

# 27. Abschlussbericht

Am Ende liefern:

```text
1. Ausgangsfehler
2. reparierte Kommunikationskette
3. Agentenloop-Entscheidung
4. zentraler Model Broker
5. Stage-Timeouts
6. Abort-Pfad
7. Retry-Policy
8. Project Local Strict Index
9. Pfadvalidierung
10. stabile Modell-IDs
11. Runtime Tool Registry
12. llama-cli-Diagnose
13. llama-server-Direkttest
14. llama-bench-Ergebnisse
15. llama-tokenize-Budget
16. UI-Verkabelung
17. Testresultate
18. manuelle Abnahmetests
19. bekannte Restprobleme
20. ehrlicher Readiness-Status
```

---

# 28. Abschlussregel

Dieser Repair Run ist kein weiterer Feature-Ausbau.

Er ist abgeschlossen, wenn der folgende Pfad zuverlässig funktioniert:

```text
Benutzereingabe
→ eine Routingentscheidung
→ ein Modell
→ ein Slot
→ ein lokaler llama-server
→ kontrollierter Stream
→ sichtbare Antwort
```

Danach kann das automatische Multi-Model-Handling kontrolliert wieder aktiviert und erweitert werden.
