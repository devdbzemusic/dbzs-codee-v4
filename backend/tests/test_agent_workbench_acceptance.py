"""Pack acceptance — drei erfolgreiche Runs + Recovery (Daily-Use Gates, automatisiert)."""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

import pytest

from app.agent_workbench.models import (
    CreateRunRequest,
    PlanStepInput,
    ProposeFileChangeRequest,
    SetPlanRequest,
)
from app.agent_workbench.planner import demo_readonly_steps
from app.agent_workbench.service import AgentWorkbenchService, reset_agent_workbench_service
from app.review_gates.service import ReviewGateService


def _wait_for_status(svc: AgentWorkbenchService, run_id: str, status: str, timeout: float = 15.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if svc.get_run(run_id).status == status:
            return
        time.sleep(0.1)
    raise AssertionError(f"Run {run_id} did not reach {status}, got {svc.get_run(run_id).status}")


@pytest.fixture
def acceptance_workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "demo-ws"
    ws.mkdir(parents=True, exist_ok=True)
    (ws / "README.md").write_text("# Acceptance workspace\n", encoding="utf-8")
    return ws


class TestDailyUseAcceptance:
    """Automatisierte Abdeckung der Pack-Checkliste (ohne Electron/LLM)."""

    def test_three_successful_readonly_runs(self, acceptance_workspace: Path) -> None:
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            svc = reset_agent_workbench_service(
                db_path=db_path,
                simulate_llm=True,
                auto_start_worker=True,
            )
            completed_ids: list[str] = []
            for index in range(3):
                run = svc.create_run(
                    CreateRunRequest(
                        workspace_root=str(acceptance_workspace),
                        goal=f"Acceptance run {index + 1}",
                        execution_mode="read_only",
                    )
                )
                svc.set_plan(run.id, SetPlanRequest(steps=demo_readonly_steps()))
                svc.start_run(run.id)
                _wait_for_status(svc, run.id, "completed")
                completed_ids.append(run.id)

            assert len(completed_ids) == 3
            for run_id in completed_ids:
                steps = svc.list_steps(run_id)
                assert len(steps) == 3
                assert all(step.status == "completed" for step in steps)
        finally:
            svc._worker.stop() if svc._worker else None
            os.unlink(db_path)

    def test_waiting_review_survives_backend_restart(self, acceptance_workspace: Path) -> None:
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        rg_fd, rg_path = tempfile.mkstemp(suffix=".db")
        os.close(rg_fd)
        try:
            from app.agent_workbench.file_changes import FileChangeService
            from app.agent_workbench.repository import AgentWorkbenchRepository

            review_gates = ReviewGateService(db_path=rg_path)
            repo = AgentWorkbenchRepository(db_path=db_path)
            file_changes = FileChangeService(repo, review_gate_service=review_gates)
            svc = AgentWorkbenchService(db_path=db_path, auto_start_worker=False)

            src = acceptance_workspace / "src"
            src.mkdir(parents=True, exist_ok=True)
            (src / "app.py").write_text("def old(): pass\n", encoding="utf-8")

            run = svc.create_run(
                CreateRunRequest(workspace_root=str(acceptance_workspace), goal="Review persistence")
            )
            run, steps = svc.set_plan(
                run.id,
                SetPlanRequest(steps=[PlanStepInput(title="Patch", role="coder")]),
            )

            change = file_changes.propose_change(
                run_id=run.id,
                step_id=steps[0].id,
                workspace_root=str(acceptance_workspace),
                request=ProposeFileChangeRequest(
                    file_path="src/app.py",
                    operation="modify",
                    summary="Await review",
                    proposed_content="def new(): pass\n",
                ),
                job_id=run.id,
            )
            assert change.status == "waiting_review"

            svc2 = AgentWorkbenchService(db_path=db_path, auto_start_worker=False)
            reloaded = svc2.repo.get_file_change(change.id)
            assert reloaded is not None
            assert reloaded.status == "waiting_review"
            gate = review_gates.get_gate(reloaded.review_gate_id)
            assert gate.status == "pending"
            assert gate.run_id == run.id
        finally:
            os.unlink(db_path)
            os.unlink(rg_path)

    def test_recovery_run_resumes_after_backend_restart(self, acceptance_workspace: Path) -> None:
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            svc = reset_agent_workbench_service(
                db_path=db_path,
                simulate_llm=True,
                auto_start_worker=False,
            )
            run = svc.create_run(
                CreateRunRequest(workspace_root=str(acceptance_workspace), goal="Recovery acceptance")
            )
            svc.set_plan(run.id, SetPlanRequest(steps=[demo_readonly_steps()[0]]))
            svc.start_run(run.id)

            svc2 = reset_agent_workbench_service(
                db_path=db_path,
                simulate_llm=True,
                auto_start_worker=False,
            )
            recovered = svc2.get_run(run.id)
            assert recovered.status == "paused_recovery"

            resumed = svc2.resume_run(run.id)
            assert resumed.status == "running"
        finally:
            os.unlink(db_path)
