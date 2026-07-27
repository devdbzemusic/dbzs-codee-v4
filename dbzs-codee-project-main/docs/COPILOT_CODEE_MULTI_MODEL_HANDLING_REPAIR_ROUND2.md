# COPILOT-IMPLEMENTIERUNGSAUFTRAG
# Division By Zeros (DBZS) Codee
## Automatic Multi-Model Handling – Repair Round 2

## Auftrag

Der aktuelle `main`-Stand enthält bereits einen Backend-Prototyp für paralleles CPU-/GPU-Model-Handling:

```text
fast_gpu     → Port 8081 → kleines Modell auf NVIDIA GTX 1650 SUPER
quality_cpu  → Port 8082 → Qwen2.5-Coder-7B vollständig auf CPU/RAM
utility      → Port 8083 → Embedding/Reranker
```

Vorhanden sind unter anderem:

```text
backend/app/runtime/service.py
backend/app/runtime/schemas.py
backend/app/runtime/gpu_detect.py
backend/app/runtime/multi_server_manager.py
backend/app/models/profiles.py
backend/app/models/profile_service.py
backend/app/api/model_profiles.py
backend/tests/test_nvidia_resource_fit.py
docs/AUTOMATIC_MODEL_HANDLING_AUDIT.md
```

Der aktuelle Stand ist noch nicht produktionsreif. Dieser Auftrag repariert die verbleibenden kritischen Defekte und schließt den Multi-Model-Pfad technisch sauber.

Keine neue Parallelarchitektur bauen. Vorhandene Services, Profile, APIs und Tests erweitern.

---

# 1. Audit zuerst aktualisieren

Erweitere vor jeder Sourcecodeänderung:

```text
docs/AUTOMATIC_MODEL_HANDLING_AUDIT.md
```

Dokumentiere darin konkret:

1. Race Condition durch das globale Feld `_start_config_override`
2. fehlende reale Auflösung der Profil-Modell-IDs
3. Platzhalter wie `qwen-2b` und `coder`
4. stiller Fallback auf `running_slots[0]`
5. falsche Stream-Metadaten durch `service.status()`
6. unvollständige TypeScript-Contracts für `slot_id`
7. fehlender echter GPU-Layer-Benchmark
8. fehlende Utility-On-Demand-Logik
9. fehlende Eskalation und Model-Handover
10. fehlende Desktop-Integration für Runtime-Slots
11. fehlende echte CPU-/GPU-Abnahmetests

Keine Implementierung beginnen, bevor das Audit aktualisiert wurde.

---

# 2. P0 – Race Condition entfernen

Aktuell wird bei parallelen Starts ein gemeinsames Feld verwendet:

```python
self._start_config_override = config
```

`MultiServerManager` startet mehrere Modelle parallel über `asyncio.to_thread()`. Dadurch können Port, GPU-Layer, Threads und Kontext zwischen den Starts vertauscht werden.

## Ziel

Jeder Start erhält eine eigene unveränderliche Konfiguration.

## Bevorzugte API

```python
def start_model(
    self,
    model_id: str,
    *,
    slot_id: str | None = None,
    config: dict[str, object] | None = None,
) -> RuntimeStatus:
    ...
```

```python
def start_model_with_config(
    self,
    model_id: str,
    config: dict[str, object],
    *,
    slot_id: str | None = None,
) -> RuntimeStatus:
    return self.start_model(
        model_id,
        slot_id=slot_id,
        config=dict(config),
    )
```

Entferne den globalen Start-Config-State aus dem parallelen Startpfad.

## Tests

- paralleler Start auf Port 8081 und 8082
- unterschiedliche `n_gpu_layers`
- keine gegenseitige Überschreibung
- `fast_gpu` bleibt GPU
- `quality_cpu` bleibt CPU-only

---

# 3. P0 – Reale Modell-IDs auflösen

Das Default-Profil darf keine erfundenen IDs wie `qwen-2b` oder `coder` verwenden.

Implementiere einen Resolver:

```python
class LocalModelResolver:
    def resolve_fast_gpu_model(self, index: ModelIndex) -> IndexedModel | None:
        ...

    def resolve_quality_cpu_model(self, index: ModelIndex) -> IndexedModel | None:
        ...

    def resolve_utility_model(
        self,
        index: ModelIndex,
        role: Literal["embedding", "reranker"],
    ) -> IndexedModel | None:
        ...
```

## Auswahl `fast_gpu`

Priorität:

```text
1. Qwen3.5-2B GGUF
2. Qwen2.5-Coder-3B-Instruct Q4_K_M
3. Qwen2.5-Coder-3B-Instruct Q5_K_M
4. kleinstes geeignetes lokales Chat-/Code-Modell innerhalb des VRAM-Budgets
```

## Auswahl `quality_cpu`

Priorität:

```text
1. Qwen2.5-Coder-7B-Instruct Q4_K_M
2. anderes lokales 7B-Coder-Modell
3. bestes lokales Code-Modell über 4 GB
```

## Auswahl `utility`

```text
Embedding: Qwen3-Embedding-0.6B
Reranker:  Qwen3-Reranker-0.6B
```

Fehlt ein Modell, liefere einen klaren Fehler `required_model_missing`. Kein erfundener Alias und kein stiller Ersatz.

---

# 4. Default-Profil dynamisch erzeugen

Beim Aktivieren oder Starten des Profils:

```text
Model Index lesen
→ reale Modelle auflösen
→ konkretes Profil erzeugen
→ Ressourcen validieren
→ starten
```

Implementiere beispielsweise:

```python
def build_nvidia_cpu_profile_from_index(
    index: ModelIndex,
    *,
    fast_gpu_port: int = 8081,
    quality_cpu_port: int = 8082,
    utility_port: int = 8083,
) -> ServerProfile:
    ...
```

Das erzeugte Profil muss ausschließlich reale lokale Modell-IDs enthalten.

---

# 5. P0 – Request-spezifische Stream-Metadaten

Der Streaming-Endpunkt darf nach Abschluss nicht global `service.status()` verwenden.

Bei parallelen CPU-/GPU-Anfragen kann sonst das falsche Modell im `done`-Event erscheinen.

## Ziel

Der konkrete Request hält seinen Zielkontext fest:

```python
@dataclass
class RuntimeStreamContext:
    slot_id: str
    model_id: str | None
    model_name: str | None
    endpoint: str
```

Ergänze eine Methode:

```python
def resolve_chat_target(
    self,
    chat_request: RuntimeChatRequest,
) -> RuntimeStreamContext:
    ...
```

Das `done`-Event muss enthalten:

```json
{
  "type": "done",
  "slot_id": "quality_cpu",
  "model_id": "...",
  "model_name": "..."
}
```

---

# 6. P0 – Stillen Slot-Fallback entfernen

Der aktuelle Fallback auf den ersten laufenden Slot ist unzulässig.

Ergänze:

```python
fallback_policy: Literal[
    "strict",
    "allow_local_fallback",
] = "strict"
```

## `strict`

```text
Zielslot nicht aktiv
→ Fehler target_slot_unavailable
→ kein anderer Slot
```

## `allow_local_fallback`

```text
geeigneten lokalen Fallback explizit auswählen
→ Grund und Zielslot im Ergebnis speichern
→ niemals running_slots[0]
```

Der Desktop-Chat verwendet standardmäßig `strict`.

---

# 7. Slot-spezifische API

Ergänze:

```text
GET  /runtime/slots
GET  /runtime/slots/{slot_id}/status
GET  /runtime/slots/{slot_id}/logs
POST /runtime/slots/{slot_id}/start
POST /runtime/slots/{slot_id}/stop
POST /runtime/slots/{slot_id}/probe
```

Contracts:

```python
RuntimeSlotId = Literal["fast_gpu", "quality_cpu", "utility"]

class RuntimeSlotStatus(BaseModel):
    slot_id: RuntimeSlotId
    state: RuntimeState
    provider: RuntimeProvider | None
    model_id: str | None
    model_name: str | None
    port: int
    pid: int | None
    endpoint: str | None
    device_policy: Literal["gpu", "cpu", "auto"]
    gpu_layers: int | None
    context_size: int | None
    message: str
    stderr_tail: str
    stdout_tail: str
```

Bestehende Single-Runtime-Endpunkte kompatibel halten.

---

# 8. TypeScript-Contracts angleichen

Ergänze in `@dbzs/shared`:

```typescript
export type RuntimeSlotId =
  | "fast_gpu"
  | "quality_cpu"
  | "utility";
```

`RuntimeStatus` erhält:

```typescript
slot_id?: RuntimeSlotId | null;
```

Ergänze:

```typescript
export interface RuntimeSlotStatus extends RuntimeStatus {
  slot_id: RuntimeSlotId;
  device_policy: "gpu" | "cpu" | "auto";
  gpu_layers: number | null;
  context_size: number | null;
}

export interface RuntimeChatStreamDonePayload {
  slot_id: RuntimeSlotId | null;
  model_id: string | null;
  model_name: string | null;
}
```

Keine `any`-Casts als Ersatz für fehlende Contracts.

---

# 9. Echter GPU-Layer-Benchmark

Der bisherige Profilscore ist nur eine Schätzung. Benenne ihn entsprechend um oder kennzeichne ihn eindeutig als `profile fit estimation`.

Implementiere zusätzlich einen echten Benchmarkdienst:

```python
class GpuLayerBenchmarkService:
    def benchmark_model(
        self,
        model_id: str,
        *,
        context_size: int,
        layer_candidates: list[int],
    ) -> GpuLayerBenchmarkResult:
        ...
```

Ablauf:

```text
1. Kandidat starten
2. Endpoint prüfen
3. kurzen Prompt senden
4. First-Token-Zeit messen
5. Tokens/s messen
6. Prozessstabilität prüfen
7. VRAM erfassen, falls verfügbar
8. Prozess sauber stoppen
9. nächsten Kandidaten testen
```

Kandidaten beispielsweise:

```text
8 → 16 → 24 → 32 → vollständig
```

Bei OOM, Vulkan-Fehler, Readiness-Timeout oder Prozessabbruch letzten stabilen Wert behalten.

Benchmarkprofil speichern pro:

```text
model_id
quantization
context_size
llama.cpp version
GPU
```

---

# 10. Ressourcenberechnung verbessern

Berücksichtige:

```text
reale Dateigröße
reale Modell-Layerzahl, sofern verfügbar
Context Size
KV-Cache-Typ
Batch Size
UBatch Size
aktueller freier VRAM
andere laufende Runtimes
Sicherheitsreserve
```

Contract:

```python
class RuntimeResourceEstimate(BaseModel):
    model_ram_mb: float
    model_vram_mb: float
    kv_cache_ram_mb: float
    kv_cache_vram_mb: float
    compute_buffer_mb: float
    driver_reserve_mb: float
    total_ram_mb: float
    total_vram_mb: float
    available_ram_mb: float | None
    available_vram_mb: float | None
    fits_ram: bool
    fits_vram: bool
    confidence: Literal["low", "medium", "high"]
    warnings: list[str]
```

Keine Aussage `safe`, wenn die Confidence nur `low` ist.

---

# 11. Routing und Automatikmodi

Implementiere feinere Aufgabentypen:

```text
casual_chat
status
summarize
intent_routing
planning
small_code_change
large_code_change
debugging
review
architecture
embedding
reranking
```

Berücksichtige:

```text
Workspace-Kontext
Dateikontext
Anzahl Dateien
Agent-Modus
Tool-Profil
Patch-/Review-/Debug-Anforderung
vorherige Fehlversuche
```

Automatikmodi:

```text
Auto – Schnell
Auto – Ausgewogen
Auto – Qualität
Manuell
```

- Schnell: `fast_gpu`, kein automatischer 7B-Start
- Ausgewogen: kleine Aufgaben GPU, komplexe Aufgaben CPU
- Qualität: Coding/Review/Debugging bevorzugt CPU
- Manuell: keine automatische Umschaltung

Jede Modellentscheidung muss im Chat-Run sichtbar begründet werden.

---

# 12. Eskalation und Model-Handover

Implementiere:

```typescript
export interface ModelHandover {
  sourceModelId: string;
  sourceSlotId: RuntimeSlotId;
  targetModelId: string;
  targetSlotId: RuntimeSlotId;
  goal: string;
  completedSteps: string[];
  relevantFiles: string[];
  proposedChanges: string[];
  testResults: string[];
  unresolvedErrors: string[];
  contextSummary: string;
}
```

Eskalation:

```text
fast_gpu
→ maximal 2 Fehlversuche
→ quality_cpu vorschlagen
→ Handover erzeugen
→ Wechselgrund sichtbar anzeigen
```

Kein endloses Modell-Pingpong.

---

# 13. Utility Runtime

Embedding und Reranking on demand:

```text
Anfrage
→ Utility auf CPU starten
→ ausführen
→ nach 60 Sekunden Leerlauf stoppen
```

GPU nur nach bestandenem Ressourcencheck. Solange `fast_gpu` aktiv ist, Utility standardmäßig CPU-first.

---

# 14. Desktop-Integration

Ergänze Renderer, Store, BackendClient, Preload und Electron-IPC für:

```text
Runtime Slots anzeigen
Slot starten
Slot stoppen
Slot prüfen
Slot-Logs anzeigen
Profil starten/stoppen
Profil-Fit anzeigen
echten Layer-Benchmark starten
```

UI-Bereiche:

```text
Fast GPU
Quality CPU
Utility
```

Je Slot anzeigen:

```text
Status
Modell
Port
PID
Gerät
GPU-Layer
Kontext
RAM
VRAM
First Token
Tokens/s
Start
Stopp
Logs
Benchmark
```

Keine Backend-Funktion ohne sichtbaren Bedienpfad.

---

# 15. Tests

Mindestens testen:

## Thread Safety

- paralleler Start `fast_gpu` + `quality_cpu`
- getrennte Konfigurationen
- kein globaler Override

## Model Resolution

- reale Modell-ID gefunden
- fehlende Rolle ergibt klaren Fehler
- keine Platzhalter-ID wird gestartet

## Stream Metadata

- parallele Streams melden jeweils richtigen Slot und Modellnamen

## Strict Routing

- Zielslot offline
- kein zufälliger Fallback

## Explicit Fallback

- nur mit `allow_local_fallback`
- Fallbackgrund vorhanden

## GPU Benchmark

- Kandidaten nacheinander
- letzter stabiler Wert gespeichert
- Prozesse immer beendet

## Utility

- on demand
- CPU-first
- Idle-Unload

## Handover

- maximal zwei Versuche
- strukturierter Wechsel auf `quality_cpu`

---

# 16. Manuelle Abnahme

## Test A – Modellauflösung

```text
lokalen Model Index einlesen
→ nvidia-gpu-cpu Profil erzeugen
```

Erwartung: reale IDs, keine Aliasse.

## Test B – paralleler Start

```text
fast_gpu Port 8081
quality_cpu Port 8082
```

Erwartung: beide Prozesse laufen, keine Config-Race.

## Test C – parallele Chats

```text
Hallo → fast_gpu
Multi-File-Analyse → quality_cpu
```

Erwartung: richtige Slots und `done`-Metadaten.

## Test D – Slot offline

```text
quality_cpu aus
Coding-Aufgabe
fallback_policy = strict
```

Erwartung: `target_slot_unavailable`, kein stiller GPU-Fallback.

## Test E – Layer-Benchmark

Erwartung: stabile Layerzahl, First Token, Tokens/s, VRAM, sauberer Teardown.

## Test F – Utility

Erwartung: Utility startet, arbeitet und wird nach Idle entladen.

---

# 17. Qualitätsgates

```powershell
pnpm typecheck
pnpm --filter @dbzs/desktop test
pnpm build
```

Backend:

```powershell
cd backend
uv run pytest -q
uv run pytest -q tests/test_nvidia_resource_fit.py
uv run pytest -q tests/test_model_profiles_api.py
```

Nicht ausgeführte Tests als `NOT RUN` dokumentieren.

Keine Aussage `vollständig implementiert` oder `verifiziert`, solange die manuellen Tests A–F nicht durchgeführt wurden.

---

# 18. Commit-Reihenfolge

```text
docs(models): update automatic model handling audit
fix(runtime): remove shared start config race
feat(models): resolve real local models for runtime slots
fix(runtime): return request-specific slot and model metadata
fix(runtime): remove silent slot fallback
feat(runtime): expose typed slot APIs
feat(shared): align runtime slot contracts
feat(models): add real gpu layer benchmark
feat(models): improve resource estimation confidence
feat(models): add handling modes routing and handover
feat(runtime): add on-demand utility lifecycle
feat(ui): add runtime slot cockpit
test(models): cover parallel starts routing metadata and fallback
docs(models): document verified multi-model workflow
```

---

# 19. Definition of Done

- [ ] Kein globaler Start-Config-State mehr
- [ ] Parallele Starts threadsicher
- [ ] Default-Profil verwendet reale Modell-IDs
- [ ] `fast_gpu` und `quality_cpu` unabhängig
- [ ] `quality_cpu` garantiert 0 GPU-Layer
- [ ] Stream-Metadaten gehören zum konkreten Request
- [ ] Kein zufälliger stiller Slot-Fallback
- [ ] Slot-APIs vollständig typisiert
- [ ] Python- und TypeScript-Contracts synchron
- [ ] Echter GPU-Layer-Benchmark vorhanden
- [ ] Ressourcenestimate mit Confidence und aktuellen Budgets
- [ ] Automatikmodi funktionieren
- [ ] Modellentscheidung sichtbar begründet
- [ ] Handover und Eskalation begrenzt
- [ ] Utility on demand
- [ ] Desktop-Slot-Cockpit bedienbar
- [ ] Typecheck, Tests und Build grün
- [ ] Manuelle Tests A–F dokumentiert

---

# 20. Abschlussbericht

Liefere am Ende:

```text
1. Gefundene Defekte
2. Race-Condition-Reparatur
3. Modellauflösung
4. Slot-Architektur
5. Stream-Metadaten
6. Fallback-Policy
7. GPU-Layer-Benchmark
8. Ressourcenberechnung
9. Routingmodi
10. Handover und Eskalation
11. Utility Runtime
12. Desktop-Integration
13. Testresultate
14. Manueller Test A: PASS
15. Manueller Test B: PASS
16. Manueller Test C: PASS
17. Manueller Test D: PASS
18. Manueller Test E: PASS
19. Manueller Test F: PASS
20. Bekannte Restprobleme
21. Ehrlicher Readiness-Status
```
