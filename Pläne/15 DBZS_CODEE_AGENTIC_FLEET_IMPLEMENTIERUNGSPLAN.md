# DBZS Codee – Implementierungsplan für die permanente Agentenflotte

**Stand:** 01.08.2026  
**Workspace:** `D:\Models\Agentic`  
**Hardware:** Ryzen 5 5600G, 32 GB RAM, GTX 1650 SUPER 4 GB VRAM

---

# 1. Zielbild

Codee verwaltet die lokalen Agentenmodelle als dauerhaft verfügbare Flotte mit vier festen Runtime-Slots:

```text
fast_gpu
utility
orchestrator
quality_cpu
```

Der Ablauf:

```text
Nutzeranfrage
→ utility klassifiziert
→ orchestrator plant
→ fast_gpu erledigt schnelle Schritte
→ quality_cpu übernimmt komplexe Aufgaben
→ Validator prüft
→ Ergebnis zurück an UI
```

---

# 2. Reale Modellbasis

## Verfügbare Kernmodelle

| Modell | Größe | Zielrolle |
|---|---:|---|
| QwenPaw-Flash-2B | 1.453 GiB | `fast_gpu` |
| MiniCPM5-1B Agentic Tooluse | 0.641 GiB | `utility` |
| InternScience Agents-A1-4B | 2.687 GiB + 0.626 GiB MMProj | `orchestrator` |
| AgentCPM-Explore | 2.530 GiB | `quality_cpu_search` |
| Nemotron-3-Nano-4B Coding Agent | 2.642 GiB | `quality_cpu_code` |
| DeepCoder-1.5B | 1.041 GiB | `quality_cpu_algorithm` |
| DeepScaleR-1.5B | 1.041 GiB | `quality_cpu_review` |
| QwenPaw-Flash-4B | 2.856 GiB | `quality_cpu_general` |
| AgentCPM-Report | 4.625 GiB | `report_on_demand` |
| Merlin-Agent | 5.243 GiB | `research_on_demand` |
| Qwen7B SmartHome Agent | 4.361 GiB | `domain_on_demand` |
| VibeThinker Fable Nano 3B | 1.797 GiB | `experimental` |
| llama-3.2-1b-mini-agent | 0.752 GiB | `experimental_micro_agent` |

---

# 3. Verbindliche Slot-Belegung

## Slot `fast_gpu`

### Primärmodell

```text
QwenPaw-Flash-2B-Q4_K_M
```

### Aufgaben

- schnelle Nutzerreaktion
- kleine Agentenschritte
- Tool-Auswahl
- kurze Codeaufgaben
- kleine Dateisuchen
- einfache strukturierte Antworten

### Betriebszustand

```text
HOT
vollständig GPU-offloaded
```

### Startprofil

```text
ctx_size       = 4096
threads        = 6
batch_size     = 256
ubatch_size    = 128
gpu_layers     = all
cache_type_k   = q8_0
cache_type_v   = q8_0
parallel       = 1
flash_attention = auto
```

### VRAM-Budget

```text
Modellgewicht      ca. 1.45 GiB
KV/Runtime-Budget  ca. 0.7–1.0 GiB
Reserve            mindestens 0.7 GiB
Gesamtziel         maximal 3.2 GiB
```

---

## Slot `utility`

### Primärmodell

```text
MiniCPM5-1B-Agentic-Tooluse
```

### Aufgaben

- Intent-Klassifikation
- Tool-Schema-Auswahl
- Argumentnormalisierung
- JSON-Ausgabe
- kurze Zusammenfassungen
- Routing
- Health-/Statusabfragen
- Request-Vorprüfung

### Betriebszustand

```text
HOT
CPU-resident oder optional teilweise GPU
```

### Startprofil

```text
ctx_size       = 4096
threads        = 4
batch_size     = 128
ubatch_size    = 64
gpu_layers     = 0
parallel       = 2
```

### Warum CPU

Der GPU-Slot bleibt für QwenPaw frei. Das Modell ist mit 0.641 GiB klein genug, um auf der CPU permanent geladen zu bleiben.

---

## Slot `orchestrator`

### Primärmodell

```text
InternScience Agents-A1-4B
```

### Aufgaben

- Aufgabe zerlegen
- Rollen auswählen
- Plan erzeugen
- Sicherheitsstufe bestimmen
- Toolrechte prüfen
- Zwischenergebnisse bewerten
- Eskalation auslösen
- Abschlussantwort zusammenführen

### Betriebszustand

```text
HOT
CPU-resident
MMProj nur bei Vision-Aufgaben laden
```

### Startprofil

```text
ctx_size       = 8192
threads        = 6
batch_size     = 128
ubatch_size    = 64
gpu_layers     = 0
parallel       = 1
```

### Sonderregel Vision

```text
Textmodus:
  Basismodell geladen
  MMProj nicht geladen

Visionmodus:
  MMProj temporär zuschalten
  fast_gpu bei VRAM-Druck pausieren oder temporär entladen
```

---

## Slot `quality_cpu`

### Betriebsart

Nur **ein Qualitätsmodell gleichzeitig HOT**.

```text
1 HOT
1 WARM
Rest COLD
```

### Aufgabenrouting

| Aufgabe | Modell |
|---|---|
| Repository-Recherche | AgentCPM-Explore |
| Code/Patch | Nemotron-3-Nano-4B |
| Algorithmik | DeepCoder-1.5B |
| Review/Reasoning | DeepScaleR-1.5B |
| allgemeine Qualität | QwenPaw-Flash-4B |
| Langbericht | AgentCPM-Report |
| wissenschaftliche Recherche | Merlin-Agent |
| Smart Home | Qwen7B-SmartHome-Agent |

### Standardprofil

```text
ctx_size       = 4096
threads        = 6
batch_size     = 128
ubatch_size    = 64
gpu_layers     = 0–8 opportunistisch
parallel       = 1
```

### Idle-Eviction

```text
10 Minuten  → Kandidat für Entladung
20 Minuten  → automatisch entladen
Jobende bei Report/Domain-Agent → sofort entladen
```

---

# 4. Permanenter Residency-Plan

## HOT

```text
QwenPaw-Flash-2B       fast_gpu
MiniCPM5-1B            utility
Agents-A1-4B           orchestrator
```

## WARM

```text
AgentCPM-Explore
Nemotron-3-Nano-4B
DeepCoder-1.5B
DeepScaleR-1.5B
```

## COLD / ON DEMAND

```text
QwenPaw-Flash-4B
AgentCPM-Report
Merlin-Agent
Qwen7B-SmartHome-Agent
VibeThinker-Fable-Nano
llama-3.2-1b-mini-agent
```

---

# 5. RAM-Budget

## Zielaufteilung

```text
Windows + Codee + Backend      8–10 GB
Agents-A1-4B HOT               3–5 GB
MiniCPM5-1B HOT                1–2 GB
QwenPaw Host-/Runtime-Anteil   1–2 GB
Quality-Modell HOT             3–7 GB
Dateicache / Reserve           6–8 GB
```

## Schutzregeln

```text
RAM > 80 %  → keine neuen Quality-Starts
RAM > 85 %  → WARM-Modelle freigeben
RAM > 90 %  → Quality-Modell entladen
RAM > 95 %  → Notfallmodus, nur utility + fast_gpu
```

---

# 6. Runtime-Zustände

```text
STOPPED
STARTING
READY
BUSY
DRAINING
DEGRADED
ERROR
QUARANTINED
```

## Übergänge

```text
STOPPED → STARTING → READY → BUSY → READY
READY → DRAINING → STOPPED
BUSY → DEGRADED → RECOVERY → READY
ERROR → RESTARTING → READY oder QUARANTINED
```

---

# 7. Lease-System

Jeder Auftrag reserviert einen Slot.

```ts
interface ModelLeaseRequest {
  requestId: string;
  role: string;
  requiredCapabilities: string[];
  preferredSlot: "fast_gpu" | "utility" | "orchestrator" | "quality_cpu";
  maxLatencyMs?: number;
  minQualityScore?: number;
}
```

Antwort:

```ts
interface ModelLease {
  leaseId: string;
  slotId: string;
  modelId: string;
  acquiredAt: string;
  expiresAt: string;
}
```

## Nutzen

- keine konkurrierenden Modellstarts
- saubere Cancellation
- kontrollierte Slotbelegung
- Queueing
- Health-Tracking
- kein Prozesschaos

---

# 8. Routing-Entscheidung

## Stufe 1 – Utility

MiniCPM klassifiziert:

```json
{
  "intent": "repository_debug",
  "complexity": "high",
  "risk": "read_only",
  "requiredCapabilities": [
    "repository_search",
    "coding",
    "reasoning"
  ]
}
```

## Stufe 2 – Orchestrator

Agents-A1 erstellt einen Plan:

```text
1. Repository durchsuchen
2. Ursache bestimmen
3. Patch erzeugen
4. Tests ausführen
5. Ergebnis reviewen
```

## Stufe 3 – Router

```text
Search       → AgentCPM-Explore
Patch        → Nemotron
Review       → DeepScaleR
Fast response→ QwenPaw-2B
```

---

# 9. Eskalationsregeln

Von `fast_gpu` zu `quality_cpu`, wenn:

```text
Konfidenz < 0.65
mehr als 1 Datei betroffen
Kontext > 4096 Tokens
Compilerfehler
Unit-Test-Fehler
ungültiger Tool Call
zweiter Fehlversuch
Sicherheitslevel > READ_ONLY
```

Von `quality_cpu` zu `orchestrator`, wenn:

```text
Plan unklar
mehrere Rollen nötig
Toolkonflikt
Ressourcen knapp
Policy-Verstoß
```

---

# 10. Parallelität

```text
fast_gpu      max_parallel = 1
utility       max_parallel = 2
orchestrator  max_parallel = 1
quality_cpu   max_parallel = 1
```

Prioritäten:

```text
P0 Benutzerinteraktion
P1 aktiver Agentenjob
P2 Validierung
P3 Hintergrundbenchmark
P4 Scan / Enrichment
```

P3 und P4 pausieren bei P0/P1.

---

# 11. Watchdog und Health

Jede Runtime meldet:

```text
Heartbeat
RAM
VRAM
CPU
GPU
Queue
TTFT
Prompt Token/s
Decode Token/s
letzter Fehler
letzte erfolgreiche Anfrage
```

Regeln:

```text
15 s ohne Heartbeat  → DEGRADED
30 s ohne Heartbeat  → Neustart
3 Neustarts / 10 min → QUARANTINED
VRAM > 95 %          → keine neuen Requests
RAM > 90 %           → Quality-Modell entladen
Queue > 5            → Fallback oder Eskalation
```

---

# 12. Backend-Struktur

```text
backend/app/runtime_fleet/
  __init__.py
  schemas.py
  slot_manager.py
  lease_manager.py
  fleet_service.py
  process_supervisor.py
  health_monitor.py
  resource_budget.py
  residency_policy.py
  router.py
  escalation.py
  metrics.py
  api.py
```

## Verantwortlichkeiten

```text
FleetService          Gesamtsteuerung
SlotManager           Slotstatus und Modellbelegung
LeaseManager          Reservierungen
ProcessSupervisor     Prozesse und Ports
HealthMonitor         Heartbeats und Recovery
ResourceBudget        RAM/VRAM-Grenzen
ResidencyPolicy       HOT/WARM/COLD
ModelRouter           Rollen- und Modellauswahl
EscalationService     Qualitätseskalation
```

---

# 13. SQLite-Tabellen

```text
runtime_fleet_slots
runtime_instances
runtime_leases
runtime_health_samples
runtime_failures
runtime_residency_state
runtime_role_assignments
runtime_routing_decisions
runtime_queue_items
```

---

# 14. API

```text
GET    /runtime-fleet/status
GET    /runtime-fleet/slots
GET    /runtime-fleet/instances
POST   /runtime-fleet/leases
DELETE /runtime-fleet/leases/{leaseId}
POST   /runtime-fleet/slots/{slotId}/start
POST   /runtime-fleet/slots/{slotId}/stop
POST   /runtime-fleet/slots/{slotId}/swap
POST   /runtime-fleet/route
GET    /runtime-fleet/events
GET    /runtime-fleet/metrics
```

---

# 15. Desktop-Bridge

```ts
interface RuntimeFleetBridge {
  getFleetStatus(): Promise<BridgeResult<FleetStatusDto>>;
  listRuntimeSlots(): Promise<BridgeResult<RuntimeSlotDto[]>>;
  acquireModelLease(
    request: AcquireModelLeaseRequest
  ): Promise<BridgeResult<ModelLeaseDto>>;
  releaseModelLease(
    leaseId: string
  ): Promise<BridgeResult<void>>;
  routeAgentTask(
    request: RouteAgentTaskRequest
  ): Promise<BridgeResult<RouteDecisionDto>>;
  swapSlotModel(
    request: SwapSlotModelRequest
  ): Promise<BridgeResult<RuntimeSlotDto>>;
}
```

---

# 16. UI

## Fleet Dashboard

Anzeige:

```text
Slot
Modell
Status
RAM
VRAM
Queue
TTFT
Tokens/s
Health
letzte Aufgabe
```

## Aktionen

```text
Start
Stop
Swap
Pin HOT
Set WARM
Drain
Restart
Quarantine
Benchmark
```

---

# 17. Implementierungsphasen

## Phase 1 – Slot-Grundsystem

1. `runtime_fleet`-Modul anlegen
2. Slot-Schema
3. SQLite-Migrationen
4. SlotManager
5. FleetService
6. Status-API
7. UI-Grundansicht

**Abnahme:**

```text
Vier Slots sichtbar
Slotzustände persistiert
Modelle manuell startbar/stopbar
```

## Phase 2 – Prozessaufsicht

1. ProcessSupervisor
2. Portvergabe
3. Logstream
4. Readiness-Checks
5. Heartbeats
6. Restart-Regeln

**Abnahme:**

```text
Runtime-Absturz wird erkannt
automatischer Neustart funktioniert
Logs sichtbar
```

## Phase 3 – Residency

1. HOT/WARM/COLD
2. LRU-Eviction
3. RAM-/VRAM-Budgets
4. Idle-Timer
5. On-Demand-Starts

**Abnahme:**

```text
Drei Kernmodelle permanent HOT
Quality-Modell wird dynamisch gewechselt
RAM-Grenzen werden eingehalten
```

## Phase 4 – Lease und Queue

1. LeaseManager
2. Request-IDs
3. Slotreservierung
4. Queue
5. Cancellation
6. Timeout

**Abnahme:**

```text
keine Doppelstarts
saubere Task-Abbrüche
Prioritätswarteschlange funktioniert
```

## Phase 5 – Router

1. Rollenmodell
2. Capability-Filter
3. Policy-Filter
4. Hardware-Fit
5. Fallback
6. Eskalation

**Abnahme:**

```text
Aufgaben landen beim richtigen Modell
nur zertifizierte Modelle werden gewählt
Fallback funktioniert
```

## Phase 6 – Agentenkette

1. Utility-Klassifikation
2. Orchestrator-Plan
3. Quality-Worker
4. Validator
5. Ergebnisaggregation

**Abnahme:**

```text
Repository-Debugging läuft Ende-zu-Ende
Patch wird getestet
Review wird erzeugt
```

---

# 18. Erste produktive Konfiguration

```text
fast_gpu:
  QwenPaw-Flash-2B
  HOT
  full GPU

utility:
  MiniCPM5-1B
  HOT
  CPU

orchestrator:
  Agents-A1-4B
  HOT
  CPU

quality_cpu:
  dynamisch
  zunächst AgentCPM-Explore
```

Danach ergänzen:

```text
Nemotron für Code
DeepScaleR für Review
DeepCoder für Algorithmik
AgentCPM-Report für Berichte
```

---

# 19. Definition of Done

- drei Kernmodelle bleiben stabil HOT
- `fast_gpu` bleibt reaktionsfähig
- `quality_cpu` kann Modelle wechseln
- RAM/VRAM-Budgets werden eingehalten
- jeder Job besitzt eine Lease
- kein Modellstart kollidiert mit einem anderen
- Runtime-Abstürze werden erkannt
- Router verwendet nur zertifizierte Modelle
- Tool Calls werden validiert
- UI zeigt Flottenstatus live
- alle Zustände sind in SQLite persistiert
- Bridge ist typisiert
- Hintergrundjobs pausieren bei Nutzerinteraktion

---

# 20. Klare Umsetzungsempfehlung

Beginne nicht mit dem kompletten Router.

Reihenfolge:

```text
1. Slots
2. Prozesse
3. Health
4. HOT/WARM/COLD
5. Lease
6. Queue
7. Router
8. Agentenkette
```

Damit entsteht zuerst eine stabile Runtime-Basis. Erst danach kommt intelligente Orchestrierung.
