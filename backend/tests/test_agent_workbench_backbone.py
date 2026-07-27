"""Phase 3A — Agent Workbench backbone tests."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

from app.agent_workbench.models import CreateRunRequest, PlanStepInput, SetPlanRequest
from app.agent_workbench.repository import AgentWorkbenchRepository
from app.agent_workbench.service import AgentWorkbenchService
from app.agent_workbench.state_machine import InvalidTransitionError, validate_run_transition


@pytest.fixture
def workbench_db(tmp_path: Path):
    db_path = str(tmp_path / "workbench.db")
    svc = AgentWorkbenchService(db_path=db_path, simulate_llm=True, auto_start_worker=False)
    yield svc


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir(parents=True, exist_ok=True)
    (ws / "README.md").write_text("# Demo", encoding="utf-8")
    return ws


class TestMigrations:
    def test_tables_created(self, workbench_db: AgentWorkbenchService):
        repo = workbench_db.repo
        conn = repo._connect()
        try:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            for name in (
                "agent_runs",
                "agent_steps",
                "agent_events",
                "agent_tool_calls",
                "agent_file_changes",
                "agent_followups",
                "host_actions",
            ):
                assert name in tables
        finally:
            conn.close()


class TestRunCrud:
    def test_create_and_get_run(self, workbench_db: AgentWorkbenchService, workspace: Path):
        run = workbench_db.create_run(
            CreateRunRequest(workspace_root=str(workspace), goal="Test goal")
        )
        assert run.status == "created"
        assert run.execution_mode == "supervised"

        fetched = workbench_db.get_run(run.id)
        assert fetched.id == run.id
        assert fetched.goal == "Test goal"

    def test_list_runs(self, workbench_db: AgentWorkbenchService, workspace: Path):
        workbench_db.create_run(CreateRunRequest(workspace_root=str(workspace), goal="A"))
        workbench_db.create_run(CreateRunRequest(workspace_root=str(workspace), goal="B"))
        runs = workbench_db.list_runs()
        assert len(runs) >= 2

    def test_missing_workspace_raises(self, workbench_db: AgentWorkbenchService):
        with pytest.raises(ValueError, match="Workspace"):
            workbench_db.create_run(
                CreateRunRequest(workspace_root="/nonexistent/path", goal="x")
            )

    def test_get_missing_run(self, workbench_db: AgentWorkbenchService):
        with pytest.raises(ValueError, match="nicht gefunden"):
            workbench_db.get_run("run-missing")


class TestPlanAndSteps:
    def test_set_plan(self, workbench_db: AgentWorkbenchService, workspace: Path):
        run = workbench_db.create_run(
            CreateRunRequest(workspace_root=str(workspace), goal="Implement feature")
        )
        run, steps = workbench_db.set_plan(
            run.id,
            SetPlanRequest(
                steps=[
                    PlanStepInput(title="Analyze", role="researcher"),
                    PlanStepInput(title="Implement", role="coder"),
                ]
            ),
        )
        assert run.status == "ready"
        assert len(steps) == 2
        assert all(s.status == "pending" for s in steps)

    def test_start_requires_plan(self, workbench_db: AgentWorkbenchService, workspace: Path):
        run = workbench_db.create_run(
            CreateRunRequest(workspace_root=str(workspace), goal="x")
        )
        with pytest.raises(ValueError, match="Plan"):
            workbench_db.start_run(run.id)


class TestTransitions:
    def test_valid_run_transitions(self):
        validate_run_transition("created", "planning")
        validate_run_transition("ready", "running")

    def test_invalid_run_transition_raises(self):
        with pytest.raises(InvalidTransitionError):
            validate_run_transition("completed", "running")

    def test_pause_and_resume(self, workbench_db: AgentWorkbenchService, workspace: Path):
        run = workbench_db.create_run(
            CreateRunRequest(workspace_root=str(workspace), goal="x")
        )
        workbench_db.set_plan(run.id, SetPlanRequest(steps=[PlanStepInput(title="S1")]))
        run = workbench_db.start_run(run.id)
        assert run.status == "running"

        run = workbench_db.pause_run(run.id)
        assert run.status == "paused"

        run = workbench_db.resume_run(run.id)
        assert run.status == "running"

    def test_cancel_from_paused(self, workbench_db: AgentWorkbenchService, workspace: Path):
        run = workbench_db.create_run(
            CreateRunRequest(workspace_root=str(workspace), goal="x")
        )
        workbench_db.set_plan(run.id, SetPlanRequest(steps=[PlanStepInput(title="S1")]))
        workbench_db.start_run(run.id)
        workbench_db.pause_run(run.id)
        run = workbench_db.cancel_run(run.id)
        assert run.status == "cancelled"

    def test_invalid_pause_from_created(self, workbench_db: AgentWorkbenchService, workspace: Path):
        run = workbench_db.create_run(
            CreateRunRequest(workspace_root=str(workspace), goal="x")
        )
        with pytest.raises(InvalidTransitionError):
            workbench_db.pause_run(run.id)


class TestActiveStep:
    def test_max_one_active_step(self, workbench_db: AgentWorkbenchService, workspace: Path):
        run = workbench_db.create_run(
            CreateRunRequest(workspace_root=str(workspace), goal="x")
        )
        run, steps = workbench_db.set_plan(
            run.id,
            SetPlanRequest(steps=[
                PlanStepInput(title="A"),
                PlanStepInput(title="B"),
            ]),
        )
        workbench_db.start_run(run.id)
        workbench_db.activate_step(run.id, steps[0].id)

        with pytest.raises(InvalidTransitionError):
            workbench_db.activate_step(run.id, steps[1].id)


class TestRecovery:
    def test_recovery_marks_running_as_paused_recovery(
        self, workspace: Path, tmp_path: Path
    ):
        db_path = str(tmp_path / "recovery.db")
        svc1 = AgentWorkbenchService(db_path=db_path, auto_start_worker=False)
        run = svc1.create_run(CreateRunRequest(workspace_root=str(workspace), goal="x"))
        svc1.set_plan(run.id, SetPlanRequest(steps=[PlanStepInput(title="S1")]))
        svc1.start_run(run.id)

        svc2 = AgentWorkbenchService(db_path=db_path, auto_start_worker=False)
        recovered = svc2.get_run(run.id)
        assert recovered.status == "paused_recovery"

        events = svc2.list_events(run.id)
        assert any(e.event_type == "run.recovered" for e in events)
