# Phase 2C+ Architektur-Entwurf

## Übersicht

**Phase 2C+** erweitert DBZS Codee von einem **single-step Agent-Tool** zu einem **autonomen Multi-Step-Worker** mit Review-Gates.

### Ziel

Agenten können komplexe Aufgaben in mehreren Schritten bearbeiten, bis:
- Das Ziel erreicht ist
- Ein Review-Gate den Prozess stoppt
- Maximale Schritte/Zeit erreicht sind
- Der User manuell abbricht

---

## Ist-Zustand (Phase 2B)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ User Input  │────▶│  Agent Run   │────▶│  Single     │
│ (Job)       │     │  Once        │     │  Output     │
└─────────────┘     └──────────────┘     └─────────────┘
```

**Limitationen:**
- Agent läuft nur 1x pro Job
- Keine Schleife für iterative Verbesserungen
- User muss jeden Schritt manuell triggern
- Kein automatischer Review-Process

---

## Soll-Zustand (Phase 2C+)

```
┌─────────────┐     ┌──────────────────────────────────────┐
│ User Input  │────▶│  Autonomous Agent Loop               │
│ (Job)       │     │                                      │
└─────────────┘     │  ┌────────┐     ┌──────────────┐    │
                    │  │ Step N │────▶│ Review Gate  │    │
                    │  └────────┘     └──────────────┘    │
                    │       │                  │           │
                    │       ▼                  ▼           │
                    │  ┌────────┐     ┌──────────────┐    │
                    │  │ Done?  │◀────│ Auto-Apply   │    │
                    │  └────────┘     │ or Wait      │    │
                    │       │          └──────────────┘    │
                    │       │yes                           │
                    │       ▼                              │
                    │  ┌────────┐                          │
                    │  │ Finish │                          │
                    │  └────────┘                          │
                    └──────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Final Output   │
                    │  + All Patches  │
                    └─────────────────┘
```

---

## Kernkomponenten

### 1. Autonomous Loop Controller

**Zweck:** Steuert die Ausführungsschleife eines Agenten

**Verantwortlichkeiten:**
- Job als "multi-step" markieren
- Schritt-Zähler verwalten
- Abbruchbedingungen prüfen
- Next-Step-Decision treffen

**Schnittstellen:**
```python
class AutonomousLoopController:
    def __init__(self, job_id: str, max_steps: int = 10, max_runtime_seconds: int = 3600):
        self.job_id = job_id
        self.step_count = 0
        self.max_steps = max_steps
        self.max_runtime_seconds = max_runtime_seconds
        self.start_time = datetime.now()
    
    def can_continue(self) -> bool:
        """Prüft ob Loop weiterlaufen darf"""
        if self.step_count >= self.max_steps:
            return False
        if (datetime.now() - self.start_time).total_seconds() > self.max_runtime_seconds:
            return False
        if self._is_user_stopped():
            return False
        return True
    
    def next_step(self) -> dict:
        """Erhöht Schrittzähler, gibt Step-Metadata zurück"""
        self.step_count += 1
        return {
            "step": self.step_count,
            "job_id": self.job_id,
            "started_at": datetime.now().isoformat()
        }
    
    def mark_complete(self, success: bool, reason: str):
        """Markiert Loop als abgeschlossen"""
        # Log final state
        pass
```

---

### 2. Review Gate System

**Zweck:** User-Freigabe für Patches vor Apply

**Review-Modi:**
| Modus | Beschreibung | Use Case |
|-------|--------------|----------|
| `auto_apply` | Patches werden sofort angewendet | Vertrauenswürdige Agents,低风险 Tasks |
| `require_approval` | Jeder Patch wartet auf Freigabe | Production-Code, sensible Änderungen |
| `hybrid` | Auto bis N Patches, dann Approval | Größere Refactorings |

**Review-Entity:**
```typescript
interface ReviewGate {
  id: string;
  job_id: string;
  step_number: number;
  proposed_changes: ProposedChange[];
  status: "pending" | "approved" | "rejected" | "modified";
  created_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  review_comment?: string;
  auto_apply_timeout_seconds?: number;  // Timeout für Auto-Approve
}

interface ProposedChange {
  file_path: string;
  old_content: string;
  new_content: string;
  diff: string;
  risk_level: "low" | "medium" | "high";
  risk_factors: string[];  // z.B. ["large_diff", "config_file", "test_missing"]
}
```

**API-Endpoints:**
```python
# Backend (FastAPI)
POST   /review-gates/{id}/approve   # Freigeben
POST   /review-gates/{id}/reject    # Ablehnen
PUT    /review-gates/{id}/modify    # Mit Änderungen freigeben
GET    /review-gates/pending        # Alle offenen Reviews
```

---

### 3. Loop Termination Conditions

**Abbruchgründe:**

| Grund | Code | Beschreibung |
|-------|------|--------------|
| `goal_achieved` | 0 | Agent meldet Ziel erreicht |
| `max_steps_reached` | 1 | Maximale Schrittzahl erreicht |
| `timeout` | 2 | Maximale Laufzeit überschritten |
| `user_stopped` | 3 | User hat manuell gestoppt |
| `review_rejected` | 4 | Review-Gate abgelehnt |
| `error` | 99 | Unbehandelter Fehler |

**Termination-Event:**
```typescript
interface LoopTerminationEvent {
  job_id: string;
  reason: string;
  reason_code: number;
  steps_completed: number;
  patches_applied: number;
  patches_pending: number;
  final_status: "success" | "partial" | "failed";
  summary: string;
  artifacts: JobArtifact[];
}
```

---

### 4. Agent Communication Protocol

**Erweiterte Job-Payload:**
```typescript
interface JobEnqueueRequest {
  title: string;
  task_type: "coding" | "review" | "testing" | "docs";
  priority: number;
  assigned_agent_role: "coder" | "reviewer" | "tester";
  
  // NEU in Phase 2C+:
  execution_mode: "single_step" | "autonomous_loop";
  review_mode: "auto_apply" | "require_approval" | "hybrid";
  max_steps?: number;  // Default: 10
  max_runtime_seconds?: number;  // Default: 3600
  goal_description: string;  // Was bedeutet "fertig"?
  success_criteria?: string[];  // Konkrete Kriterien
}
```

**Agent-Output (pro Step):**
```typescript
interface AgentStepOutput {
  step_number: number;
  actions_taken: string[];
  patches_proposed: ProposedChange[];
  goal_progress_percent: number;
  is_goal_achieved: boolean;
  next_step_description: string;
  blocking_issues?: string[];
}
```

---

## Architektur-Änderungen

### Backend

```
backend/app/
├── agent_loop/
│   ├── __init__.py
│   ├── service.py              # Bestehende Single-Run-Logik
│   └── autonomous_controller.py  # NEU: Loop-Controller
├── review_gates/
│   ├── __init__.py
│   ├── service.py              # Review-Verwaltung
│   ├── router.py               # API-Endpoints
│   └── models.py               # DB-Models (SQLite)
├── job_spooler/
│   └── service.py              # Erweitern um execution_mode
└── agents/
    └── service.py              # Agent execution mit Loop-Support
```

### Desktop

```
apps/desktop/src/
├── components/
│   ├── ReviewGatePanel.tsx       # NEU: Review-UI
│   ├── AutonomousJobWizard.tsx   # NEU: Job-Erstellung mit Loop-Config
│   └── JobMonitorPanel.tsx       # Erweitern um Loop-Status
├── stores/
│   ├── reviewGateStore.ts        # NEU: Review-State
│   └── jobSpoolerStore.ts        # Erweitern um Loop-Actions
└── services/
    └── reviewGateService.ts      # NEU: IPC/API-Client
```

---

## Datenbank-Schema (SQLite)

```sql
-- Review Gates
CREATE TABLE review_gates (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'modified')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_comment TEXT,
  auto_apply_timeout_seconds INTEGER,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- Proposed Changes (pro Review Gate)
CREATE TABLE proposed_changes (
  id TEXT PRIMARY KEY,
  review_gate_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  old_content TEXT,
  new_content TEXT,
  diff TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  risk_factors TEXT,  -- JSON array
  FOREIGN KEY (review_gate_id) REFERENCES review_gates(id)
);

-- Loop State (pro Job)
CREATE TABLE job_loop_state (
  job_id TEXT PRIMARY KEY,
  step_count INTEGER DEFAULT 0,
  max_steps INTEGER DEFAULT 10,
  started_at TEXT NOT NULL,
  last_step_at TEXT,
  terminated_at TEXT,
  termination_reason TEXT,
  termination_code INTEGER,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

---

## Implementierungs-Phasen

### Phase 2C.1: Loop Controller (Backend)
- [ ] `autonomous_controller.py` implementieren
- [ ] Job-Schema um `execution_mode` erweitern
- [ ] Agent-Loop um Step-Counter erweitern
- [ ] Termination-Conditions implementieren
- [ ] Tests schreiben

### Phase 2C.2: Review Gates (Backend)
- [ ] `review_gates/` Module erstellen
- [ ] SQLite-Models + Migration
- [ ] API-Endpoints (`/review-gates/*`)
- [ ] Auto-Apply-Timeout-Logik
- [ ] Tests schreiben

### Phase 2C.3: Desktop UI
- [ ] `ReviewGatePanel.tsx` Komponente
- [ ] `AutonomousJobWizard.tsx` für Job-Erstellung
- [ ] IPC-Bridge für Review-Actions
- [ ] JobMonitor um Loop-Status erweitern
- [ ] Tests schreiben

### Phase 2C.4: Integration
- [ ] End-to-End-Tests (Loop mit Review)
- [ ] Performance-Tests (max_steps=10)
- [ ] Dokumentation
- [ ] Smoke-Tests erweitern

---

## Risiken & Gegenmaßnahmen

| Risiko | Wahrscheinlichkeit | Impact | Gegenmaßnahme |
|--------|-------------------|--------|---------------|
| Endlosschleifen | Mittel | Hoch | Hard-Limit `max_steps`, Timeout |
| User vergisst Review | Mittel | Mittel | Auto-Approve-Timeout, Toast-Erinnerung |
| Zu viele Patches | Hoch | Mittel | Batch-Reviews, Progress-Indikator |
| Performance-Probleme | Niedrig | Mittel | Step-Delay, Background-Processing |
| State-Inkonsistenz | Niedrig | Hoch | DB-Transactions, Idempotenz |

---

## Erfolgskriterien

**Funktional:**
- [ ] Agent kann 10 Steps autonom ausführen
- [ ] Review-Gates blockieren Apply bis Freigabe
- [ ] User kann Loop manuell stoppen
- [ ] Loop terminiert bei `max_steps`
- [ ] Alle Patches werden korrekt getrackt

**UX:**
- [ ] Review-Panel zeigt Diffs klar an
- [ ] Toast bei neuem Review-Gate
- [ ] Loop-Status im JobMonitor sichtbar
- [ ] Abbruchgrund wird protokolliert

**Technisch:**
- [ ] Typecheck grün
- [ ] Alle Tests grün (Backend + Desktop)
- [ ] CI-Pipeline erweitert
- [ ] Dokumentation vollständig

---

## Offene Fragen

1. **Soll Auto-Apply konfigurierbar pro Agent sein?**
   - Pro: Flexibler, Agents können spezialisiert werden
   - Contra: Komplexität in Config

2. **Wie mit konfliktären Patches umgehen?**
   - Option A: Späterer Patch verwirft früheren
   - Option B: Merge-Conflict markieren, User-Eingriff

3. **Soll Loop-State persistent sein?**
   - Pro: App-Neustart überleben
   - Contra: Komplexität, Cleanup-Probleme

---

## Nächste Schritte

1. **Design-Review** mit Stakeholdern
2. **Offene Fragen klären**
3. **Phase 2C.1 beginnen** (Loop Controller)
4. **Parallel:** `docs/QUICKSTART.md` erstellen

---

## Referenzen

- `HANDOVER.md` — Abschnitt "Phase 2C+"
- `backend/app/agent_loop/service.py` — Bestehende Loop-Logik
- `apps/desktop/src/components/JobMonitorPanel.tsx` — UI-Erweiterung
- `docs/AGENT_RUNNER_PHASE_2A.md` — Vorgänger-Design
