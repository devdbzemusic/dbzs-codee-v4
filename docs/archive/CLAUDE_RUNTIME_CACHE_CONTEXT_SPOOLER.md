# CLAUDE TASK — Runtime Cache, Adaptive GPU Layers and Context Spooler

Repository: `devdbzemusic/dbzs-codee-project`

## Ziel

CODEE soll lokale Modelle stabiler und schneller betreiben. Die vier Zielbausteine sind:

```text
1. Runtime Resource Planner
2. Runtime Residency Cache
3. Model Context Cache
4. Context Spooler
```

Optional danach:

```text
5. llama.cpp Prompt-/KV-Cache Integration
```

Keine neue Inference Engine bauen. Bestehende Slots, Model Profiles, llama-server, Routing und Settings wiederverwenden.

## 1. Audit

Prüfe mindestens:

```text
backend/app/runtime/launch.py
backend/app/runtime/service.py
backend/app/runtime/multi_server_manager.py
backend/app/models/profiles.py
backend/app/models/profile_service.py
backend/app/models/schemas.py
backend/tests/test_runtime_service.py
backend/tests/test_nvidia_resource_fit.py
apps/desktop/src/services/runtimeSlotManager.ts
apps/desktop/src/services/runtimeBootstrap.ts
apps/desktop/src/services/modelSelectionBroker.ts
apps/desktop/src/services/runtimeSlotValidator.ts
apps/desktop/src/stores/runtimeStore.ts
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/stores/settingsStore.ts
```

Dokumentiere:

1. Wo `ctx-size` und `n_gpu_layers` gesetzt werden.
2. Welche Profilwerte beim echten Start nicht verwendet werden.
3. Wo Zeichenlimits statt Tokenbudgets verwendet werden.
4. Wann Runtimes neu gestartet werden.
5. Wie OOM, Timeout und Crash behandelt werden.
6. Ob Batch, UBatch, KV-Cache oder Prompt-Cache unterstützt werden.

## 2. Runtime Resource Planner

Implementiere `RuntimeResourcePlanner`.

```ts
export interface RuntimeResourcePlan {
  modelId: string;
  slotId: string;
  contextSize: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
  gpuLayers: number;
  batchSize: number;
  microBatchSize: number;
  parallel: number;
  threads: number;
  cacheTypeK: "f16" | "q8_0" | "q4_0";
  cacheTypeV: "f16" | "q8_0" | "q4_0";
  estimatedModelBytes: number;
  estimatedKvCacheBytes: number;
  estimatedComputeBufferBytes: number;
  estimatedTotalVramBytes: number;
  availableVramBytes?: number;
  safetyReserveBytes: number;
  hardwareMode: "cpu" | "gpu" | "hybrid";
  warnings: string[];
}
```

Der Plan berücksichtigt:

```text
Modellgröße
Quantisierung
Kontextgröße
KV-Cache-Typ
Batch/UBatch
Parallelität
freien VRAM
bereits laufende Modelle
Sicherheitsreserve
```

Für 4 GB VRAM mindestens 512–768 MB Reserve lassen.

## 3. Adaptive GPU-Layer

Nicht mehr blind `n_gpu_layers=99` setzen.

Ablauf:

```text
VRAM messen
→ Modellgröße schätzen
→ KV-Cache schätzen
→ Compute Buffer reservieren
→ GPU-Layer bestimmen
→ Teststart
→ bei OOM reduzieren
→ funktionierendes Profil speichern
```

Maximal drei OOM-Retries. Kein stiller vollständiger CPU-Fallback.

## 4. Hardware-Fingerprint

```ts
export interface HardwareFingerprint {
  os: string;
  architecture: string;
  cpuModel?: string;
  cpuThreads: number;
  ramBytes: number;
  gpuName?: string;
  gpuVendor?: string;
  vramBytes?: number;
  runtimeBackend: "cpu" | "cuda" | "vulkan" | "metal";
}
```

Autotuning-Profile nur auf kompatibler Hardware wiederverwenden.

## 5. Runtime Profiles

Mindestens:

```text
Fast
Balanced
Large Context
CPU Safe
Custom
```

Beispiel:

```text
Fast          → kleiner Kontext, mehr GPU-Layer
Balanced      → mittlerer Kontext, sichere Reserve
Large Context → größerer Kontext, weniger GPU-Layer
CPU Safe      → gpuLayers=0
```

## 6. llama.cpp Capability Detection

Vor Verwendung von Flags `llama-server --help` beziehungsweise die Runtime-Version auswerten.

Mögliche Flags:

```text
--ctx-size
--gpu-layers
--threads
--batch-size
--ubatch-size
--parallel
--cache-type-k
--cache-type-v
--cache-reuse
```

```ts
export interface LlamaRuntimeCapabilities {
  supportsBatchSize: boolean;
  supportsUbatchSize: boolean;
  supportsCacheTypeK: boolean;
  supportsCacheTypeV: boolean;
  supportsCacheReuse: boolean;
  supportsPromptCache: boolean;
}
```

Keine nicht unterstützten Flags blind setzen.

## 7. Runtime Residency Cache

```ts
export interface RuntimeResidencyEntry {
  slotId: string;
  modelId: string;
  processId: number;
  endpoint: string;
  launchFingerprint: string;
  contextSize: number;
  gpuLayers: number;
  batchSize: number;
  microBatchSize: number;
  parallel: number;
  cacheTypeK: string;
  cacheTypeV: string;
  state: "warming" | "ready" | "busy" | "idle" | "evicting" | "error";
  activeRequests: number;
  startedAt: string;
  lastUsedAt: string;
  idleSince?: string;
}
```

Wiederverwenden nur bei identischem Launch Fingerprint:

```text
modelId
model hash
runtime version
contextSize
gpuLayers
batch/ubatch
parallel
cache types
chat template
runtime backend
```

Policies:

```text
keep_resident
idle_evict
manual
```

Default:

```text
Chat CPU: keep_resident
Coding GPU: keep_resident
Utility: idle_evict
```

Keine doppelten llama-server-Prozesse.

## 8. Model Context Cache

```ts
export interface ModelContextCacheEntry {
  key: string;
  modelId: string;
  role: "chat" | "coding" | "review" | "plan" | "debug";
  workspaceId: string;
  systemPromptHash: string;
  toolContractHash: string;
  projectMemoryHash: string;
  architectureHash?: string;
  agentsFileHash?: string;
  tokenCount: number;
  sections: ContextSection[];
  createdAt: string;
  lastUsedAt: string;
  expiresAt?: string;
}
```

Cachebare Inhalte:

```text
Systemprompt
Rollenprompt
Toolbeschreibungen
AGENTS.md
Architecture Summary
Repository Map
Project Memory
Coding Standards
```

Invalidierung bei Modell-, Rollen-, Workspace-, Prompt-, Tool- oder Projektdokumentänderung. Hash-basiert, nicht nur per TTL.

## 9. Context Spooler

Implementiere `ContextSpooler` mit:

```text
Mandatory Lane
Active Task Lane
Relevant Code Lane
Recent Conversation Lane
Retrieved Memory Lane
Overflow Lane
```

### Mandatory

```text
Systemprompt
Agentenrolle
Sicherheitsregeln
aktueller Nutzerauftrag
Tool Contracts
Approval Regeln
```

### Active Task

```text
aktueller/freigegebener Plan
aktiver Patch
letzte Testfehler
letzte Toolresultate
aktive Datei
betroffene Symbole
```

### Relevant Code

Keine pauschalen Komplettdateien. Lade:

```text
betroffene Funktionen
Imports
zugehörige Tests
direkte Abhängigkeiten
Konfiguration
```

Ziel: 3–5 relevante Dateien beziehungsweise Ausschnitte.

### History

Nicht einfach die letzten N Nachrichten. Relevante Entscheidungen, Korrekturen und Fehler priorisieren. Alte Turns zusammenfassen.

### Overflow

Auslagern in SQLite/JSONL/Logdateien und nur Referenzen in den Prompt übernehmen.

## 10. Tokenbudget

```ts
export interface RuntimeTokenBudget {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
  safetyReserveTokens: number;
  maxSystemTokens: number;
  maxTaskTokens: number;
  maxCodeTokens: number;
  maxHistoryTokens: number;
  maxMemoryTokens: number;
}
```

Für 4096 Tokens beispielsweise:

```text
Output Reserve: 900
Tool Reserve:   300
Safety:         200
Max Input:     2696
```

Regel:

```text
input + output reserve + tool reserve + safety <= context window
```

Antwortreserve niemals zugunsten von zusätzlichem Kontext kürzen.

## 11. Tokenizer

Nutze einen modellkompatiblen Tokenizer oder llama.cpp Tokenize Endpoint. Zeichenabschätzung nur als konservativer Fallback.

## 12. Context Manifest

```ts
export interface ContextManifest {
  requestId: string;
  modelId: string;
  role: string;
  contextWindowTokens: number;
  inputTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
  safetyReserveTokens: number;
  sections: Array<{
    type: string;
    source: string;
    tokenCount: number;
    priority: number;
    cached: boolean;
    truncated: boolean;
  }>;
  cacheHits: number;
  cacheMisses: number;
  droppedSections: string[];
}
```

## 13. Tool Output Layering

```ts
export interface ToolOutputLayers {
  displaySummary: string;
  agentContext: string;
  fullLogRef?: string;
}
```

```text
displaySummary → 300–500 Zeichen für UI
agentContext   → relevante Fehlerzeilen, mehrere Tausend Zeichen
fullLogRef     → vollständiges Log
```

Keine Reparaturschleife nur mit einer extrem gekürzten Fehlermeldung.

## 14. Prompt-/KV-Cache

Erst nach Resource Planner, Residency Cache und Spooler integrieren.

Ziele:

```text
stabile Prompt-Präfixe wiederverwenden
Cache Hit/Miss messen
bei geänderten Prompts korrekt invalidieren
keine Cross-Model-Wiederverwendung
```

## 15. UI

In Modelle & Backend anzeigen:

```text
Profil: Balanced
Kontext: 4096
Antwortreserve: 900
GPU-Layer: Auto · aktuell 22
Batch: 128
UBatch: 64
KV Cache: K q8_0 / V q8_0
VRAM: 3.18 / 4.00 GB
Reserve: 640 MB
Runtime Cache: Resident
Context Cache Hit Rate: 68 %
```

Buttons:

```text
[Neu vermessen]
[Profil speichern]
[Cache leeren]
[Runtime neu starten]
[Diagnose anzeigen]
```

Pro Request optional das Kontextbudget anzeigen.

## 16. Acceptance Tests

### GPU Autotuning

```text
zu viele Layer
→ OOM
→ Layer reduzieren
→ erfolgreicher Start
→ Profil speichern
→ nächster Start ohne erneute OOM-Schleife
```

### Residency

```text
mehrere Requests
→ Runtime bleibt geladen
→ kein Neustart
→ Cache Hit
```

### Context Spooler

Gegeben:

```text
20 Dateien
lange History
großes Tool Log
4096 Kontextfenster
```

Erwartung:

```text
Mandatory vollständig
Antwortreserve geschützt
relevante Ausschnitte
History zusammengefasst
Tool Log ausgelagert
Budget eingehalten
```

### Context Cache

```text
gleicher Workspace/Rolle/Prompt
→ Cache Hit
AGENTS.md geändert
→ Cache invalidiert
```

## 17. Pflicht-Tests

1. GPU-Layer dynamisch berechnet
2. VRAM-Reserve eingehalten
3. OOM-Retry begrenzt
4. Profil persistiert
5. Launch Fingerprint korrekt
6. kompatible Runtime wiederverwendet
7. inkompatible Runtime neu gestartet
8. keine doppelten Prozesse
9. Context Cache Hit
10. Hash-Invalidierung
11. Tokenbudget eingehalten
12. Antwortreserve geschützt
13. Codeausschnitte priorisiert
14. History zusammengefasst
15. Tool Logs ausgelagert
16. Context Manifest korrekt
17. Cache-Flags nur capability-basiert
18. UI zeigt reale Werte
19. Cache leeren funktioniert
20. Hardwareprofile getrennt

## 18. Testkommandos

```powershell
pnpm test:runtime-cache
pnpm test:context-spooler
pnpm test:resource-planner
```

Backend:

```powershell
pytest backend/tests/test_runtime_resource_planner.py
pytest backend/tests/test_runtime_residency_cache.py
pytest backend/tests/test_context_spooler.py
```

## 19. Definition of Done

1. Kontextgröße und GPU-Layer werden gemeinsam geplant.
2. VRAM-Fit erfolgt vor dem Start.
3. OOM wird automatisch und begrenzt korrigiert.
4. funktionierende Profile werden pro Hardware gespeichert.
5. Runtimes werden resident wiederverwendet.
6. keine doppelten Prozesse entstehen.
7. Context Cache verwendet stabile Projektpräfixe wieder.
8. Context Spooler erzwingt ein Tokenbudget.
9. Antwortreserve bleibt immer geschützt.
10. relevante Codeausschnitte ersetzen pauschale Komplettdateien.
11. Tool-Logs werden nicht sinnlos gekürzt.
12. Context Manifest und Cache-Statistiken sind sichtbar.
13. llama.cpp Cache-Features werden nur capability-basiert aktiviert.
14. Acceptance Tests beweisen alle Ebenen.

## 20. Arbeitsweise

Feature Branch:

```text
feat/runtime-cache-context-spooler
```

Phasen:

```text
1. Audit + Resource Planner
2. Runtime Residency Cache
3. Context Cache
4. Context Spooler
5. Prompt-/KV-Cache
6. UI + Telemetrie
```

Keine Direktcommits auf `main`.

## 21. Empfohlene Commits

```text
feat(runtime): add adaptive resource planner
feat(runtime): add gpu autotuning and oom recovery
feat(runtime): add resident model cache
feat(context): add reusable model context cache
feat(context): add token-budgeted context spooler
feat(runtime): detect llama cache capabilities
feat(ui): show runtime and context cache diagnostics
test(runtime): verify cache and spooler behavior
docs(architecture): document runtime cache and context spooler
```

## 22. Abschlussbericht

Liefern:

1. Root Cause
2. Ist- und Zielarchitektur
3. Resource Planner
4. Runtime Cache
5. Context Cache
6. Context Spooler
7. llama.cpp Cache-Integration
8. geänderte Dateien
9. Messwerte
10. Testresultate
11. bekannte Einschränkungen
12. nächste Optimierung
