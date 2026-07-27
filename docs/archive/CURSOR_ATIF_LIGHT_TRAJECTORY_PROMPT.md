# Cursor Prompt — DBZS Codee: ATIF-light Trajectory + Review-Gate Hardening

Du arbeitest im Repository:

`devdbzemusic/dbzs-codee-project`

Ziel dieses Tasks:
DBZS Codee soll Agentenläufe nachvollziehbar protokollieren. Baue ein kompaktes, lokales `ATIF-light` Trajectory-System ein, das Multi-Step-Agenten, Review-Gates und spätere Debug-/Replay-Funktionen vorbereitet.

Wichtig:
- Kein großer Architektur-Umbau.
- Keine destruktiven Git-Operationen.
- Keine Secrets loggen.
- Workspace-Boundary-Regeln beibehalten.
- Bestehende UI/Optik respektieren.
- Bestehende Tests nicht brechen.
- Neue Funktionen klein, testbar und sauber integrieren.

────────────────────────────────────────
1. Kontext
────────────────────────────────────────

Das Projekt ist eine Electron + React + FastAPI Desktop-Umgebung für lokale AI-Orchestrierung, Runtime-Management und modulare Agenten-Workflows.

Vorhandene relevante Bausteine:

Backend:
- `backend/app/main.py`
- `backend/app/agent_loop/autonomous_controller.py`
- `backend/app/review_gates/`
- `backend/app/job_spooler/`
- `backend/app/agents/`
- `backend/app/agent_runner/`

Desktop:
- `apps/desktop/src/components/ReviewGatePanel.tsx`
- `apps/desktop/src/services/reviewGateService.ts`
- `apps/desktop/src/stores/`
- `apps/desktop/src/components/JobMonitorPanel.tsx`

Der vorhandene `AutonomousLoopController` verwaltet bereits:
- `job_id`
- `step_count`
- `max_steps`
- `started_at`
- `last_step_at`
- `terminated_at`
- `termination_reason`
- `termination_code`

Die vorhandenen Review-Gates verwalten bereits:
- Pending Gates
- Proposed Changes
- Approve
- Reject
- Auto-Apply-Check

Jetzt fehlt eine saubere, kompakte Trajectory-Schicht:
„Was hat der Agent wann warum getan?“

────────────────────────────────────────
2. Zielbild
────────────────────────────────────────

Implementiere ein minimales lokales Trajectory-System:

`ATIF-light = kompaktes JSON-kompatibles Agentenlauf-Protokoll`

Jeder relevante Agenten-/Review-/Loop-Schritt soll einen Event-Eintrag erzeugen.

Beispiel:

```json
{
  "schema_version": "atif-light-v1",
  "id": "traj_...",
  "job_id": "job_...",
  "step_number": 2,
  "event_type": "review_gate_created",
  "agent_role": "coder",
  "model": "qwen3-8b-q4_k_m",
  "summary": "Patch proposal requires user review",
  "files": ["backend/app/runtime/service.py"],
  "risk_level": "medium",
  "metadata": {
    "review_gate_id": "rg-job_123-2",
    "proposed_changes_count": 1
  },
  "created_at": "2026-06-18T12:00:00Z"
}
```

────────────────────────────────────────
3. Backend-Implementierung
────────────────────────────────────────

Lege neues Modul an:

```text
backend/app/trajectories/
  __init__.py
  models.py
  service.py
  router.py
```

Nutze SQLite oder JSONL unter dem App-Data-Verzeichnis.
Bevorzugt SQLite, wenn es zum bestehenden Stil passt.

Tabelle:

```sql
CREATE TABLE IF NOT EXISTS trajectory_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  step_number INTEGER,
  event_type TEXT NOT NULL,
  agent_role TEXT,
  model TEXT,
  summary TEXT NOT NULL,
  files_json TEXT NOT NULL DEFAULT '[]',
  risk_level TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```

Event Types:

```text
job_created
loop_started
step_started
step_completed
tool_call
finding
patch_proposed
review_gate_created
review_approved
review_rejected
auto_apply_checked
error
completed
cancelled
```

Risk Level:

```text
none
low
medium
high
critical
```

Modelle in `models.py`:

- `TrajectoryEvent`
- `TrajectoryEventCreate`
- `TrajectoryEventListResponse`

Service in `service.py`:

- `record_event(request: TrajectoryEventCreate) -> TrajectoryEvent`
- `list_events_for_job(job_id: str) -> list[TrajectoryEvent]`
- `list_recent_events(limit: int = 100) -> list[TrajectoryEvent]`
- `delete_events_for_job(job_id: str) -> bool` optional

Router in `router.py`:

```text
POST /trajectories/events
GET  /trajectories/jobs/{job_id}
GET  /trajectories/recent?limit=100
```

In `backend/app/main.py` registrieren:

```python
from app.trajectories.router import router as trajectories_router
fastapi_app.include_router(trajectories_router)
```

────────────────────────────────────────
4. Hook-Punkte
────────────────────────────────────────

Baue Events an minimal-invasiven Stellen ein.

A) `AutonomousLoopController.next_step()`

Beim erfolgreichen Step-Start:

```text
event_type: step_started
summary: "Autonomous loop step started"
job_id
step_number
metadata: { "max_steps": ..., "max_runtime_seconds": ... }
```

Bei `mark_complete()`:

```text
event_type: completed / cancelled / error
summary: termination reason
metadata: { "termination_reason": ..., "termination_code": ... }
```

B) `ReviewGateService.create_gate()`

Nach Erstellung:

```text
event_type: review_gate_created
summary: "Review gate created for proposed changes"
job_id
step_number
files: affected file paths
risk_level: highest proposed risk
metadata:
  review_gate_id
  proposed_changes_count
  risk_factors
```

C) `ReviewGateService.approve_gate()`

```text
event_type: review_approved
summary: "Review gate approved"
metadata:
  review_gate_id
  reviewed_by
  review_comment
```

D) `ReviewGateService.reject_gate()`

```text
event_type: review_rejected
summary: "Review gate rejected"
metadata:
  review_gate_id
  reviewed_by
  rejection_reason
```

E) `ReviewGateService.check_auto_apply()`

Nur bei abgelaufenem Timeout oder Statuswechsel loggen, nicht bei jedem Poll spammen.

```text
event_type: auto_apply_checked
summary: "Auto-apply timeout reached"
```

────────────────────────────────────────
5. Frontend-Minimum
────────────────────────────────────────

Baue erstmal keine große neue UI, sondern eine kleine, robuste Erweiterung:

A) Neuer Service:

```text
apps/desktop/src/services/trajectoryService.ts
```

Funktionen:

```ts
listJobTrajectory(jobId: string): Promise<TrajectoryEvent[]>
listRecentTrajectories(limit?: number): Promise<TrajectoryEvent[]>
```

B) Optional kleine Komponente:

```text
apps/desktop/src/components/TrajectoryMiniPanel.tsx
```

Zweck:
- zeigt letzte 5 Events eines Jobs
- kompakt
- keine große Designänderung
- kann später in JobMonitorPanel eingebunden werden

Wenn JobMonitor-Integration zu riskant ist:
- Komponente anlegen
- Service + Tests liefern
- Integration als TODO dokumentieren

────────────────────────────────────────
6. Tests
────────────────────────────────────────

Backend-Tests ergänzen:

```text
backend/tests/test_trajectories.py
```

Testfälle:
- Event kann geschrieben werden
- Events pro Job werden korrekt gelesen
- Recent Events liefern sortiert die neuesten Einträge
- Metadata/Files JSON roundtrip funktioniert
- ReviewGateService erzeugt Event bei create/approve/reject
- AutonomousLoopController erzeugt Event bei next_step/mark_complete

Wenn bestehende Konstruktoren schwer testbar sind:
- Service optional injizierbar machen
- Default-Verhalten kompatibel halten

Frontend-Tests nur wenn bestehende Teststruktur leicht anschließbar ist:
- trajectoryService fetch mapping
- TrajectoryMiniPanel rendert Event-Liste

────────────────────────────────────────
7. Dokumentation aktualisieren
────────────────────────────────────────

Aktualisiere mindestens:

```text
README.md
HANDOVER.md
CHANGELOG.md
LATER_TODO.MD
```

Wichtig:
Die Doku darf nicht mehr behaupten, Phase 2C sei nur geplant, wenn Code bereits vorhanden ist.

Formulierungsvorschlag:

```text
Phase 2C status:
Implemented foundation, hardening in progress.

Completed:
- AutonomousLoopController
- ReviewGate backend
- ReviewGate API
- Initial ReviewGatePanel
- ATIF-light trajectory backend

Needs hardening:
- Full visual Review Cockpit
- Deeper JobMonitor integration
- Replay/export tooling
- E2E coverage for autonomous loop + review gates
```

────────────────────────────────────────
8. Definition of Done
────────────────────────────────────────

Der Task ist fertig, wenn:

- `backend/app/trajectories/` existiert
- Router in `backend/app/main.py` registriert ist
- Trajectory Events per API geschrieben/gelesen werden können
- AutonomousLoopController loggt Step-Start und Completion
- ReviewGateService loggt Create/Approve/Reject
- Tests für Backend grün sind
- Bestehende Tests nicht gebrochen werden
- README/HANDOVER/CHANGELOG/LATER_TODO aktualisiert sind
- Keine Secrets oder absolute privaten Pfade geloggt werden

Lokal ausführen:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke-test
```

Falls ein kompletter `pnpm test` wegen lokaler Umgebung scheitert:
- Fehler exakt dokumentieren
- mindestens betroffene Backend-Tests gezielt laufen lassen:

```powershell
cd backend
uv run pytest tests/test_trajectories.py -q
```

────────────────────────────────────────
9. Arbeitsweise für Cursor
────────────────────────────────────────

Vorgehen:

1. Erst bestehende Dateien lesen:
   - `backend/app/main.py`
   - `backend/app/agent_loop/autonomous_controller.py`
   - `backend/app/review_gates/service.py`
   - `backend/app/review_gates/models.py`
   - `backend/tests/`
   - `apps/desktop/src/services/`
   - `apps/desktop/src/components/ReviewGatePanel.tsx`

2. Dann Minimal-Backend implementieren.

3. Dann Hooks einbauen.

4. Dann Tests schreiben.

5. Dann Doku synchronisieren.

6. Danach finalen Bericht ausgeben:
   - Dateien geändert
   - Neue Endpoints
   - Tests ausgeführt
   - Offene Risiken
   - Nächste empfohlene Schritte

Nicht machen:
- Keine komplette UI neu designen.
- Keine Provider-Architektur anfassen.
- Keine Runtime-Startlogik umbauen.
- Keine Secrets ausgeben.
- Keine destruktiven Git-Befehle.
- Keine Massen-Refactors.
