"""Phase 3E — Patch proposal, review gate, and apply loop tests."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

from app.agent_workbench.file_changes import FileChangeService
from app.agent_workbench.host_actions import HostActionService
from app.agent_workbench.models import CreateRunRequest, PlanStepInput, ProposeFileChangeRequest, SetPlanRequest
from app.agent_workbench.repository import AgentWorkbenchRepository
from app.agent_workbench.service import AgentWorkbenchService
from app.review_gates.service import ReviewGateService


@pytest.fixture
def patch_setup(tmp_path: Path):
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    rg_fd, rg_path = tempfile.mkstemp(suffix=".db")
    os.close(rg_fd)

    ws = tmp_path / "workspace"
    ws.mkdir(parents=True, exist_ok=True)
    src = ws / "src"
    src.mkdir(parents=True, exist_ok=True)
    (src / "app.py").write_text("def old(): pass\n", encoding="utf-8")

    review_gates = ReviewGateService(db_path=rg_path)
    repo = AgentWorkbenchRepository(db_path=db_path)
    file_changes = FileChangeService(repo, review_gate_service=review_gates)
    host_actions = HostActionService(repo)
    svc = AgentWorkbenchService(db_path=db_path, auto_start_worker=False)

    yield svc, file_changes, host_actions, review_gates, ws, repo
    os.unlink(db_path)
    os.unlink(rg_path)


class TestFileChangeProposal:
    def test_propose_creates_review_gate(self, patch_setup):
        svc, file_changes, _, review_gates, ws, _ = patch_setup
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Fix bug"))
        run, steps = svc.set_plan(
            run.id,
            SetPlanRequest(steps=[PlanStepInput(title="Fix", role="coder")]),
        )

        change = file_changes.propose_change(
            run_id=run.id,
            step_id=steps[0].id,
            workspace_root=str(ws),
            request=ProposeFileChangeRequest(
                file_path="src/app.py",
                operation="modify",
                summary="Update function",
                proposed_content="def new(): pass\n",
            ),
            job_id=run.id,
        )
        assert change.status == "waiting_review"
        assert change.review_gate_id is not None

        gate = review_gates.get_gate(change.review_gate_id)
        assert gate.run_id == run.id
        assert gate.step_id == steps[0].id
        assert gate.status == "pending"

    def test_hash_mismatch_raises(self, patch_setup):
        _, file_changes, _, _, ws, repo = patch_setup
        with pytest.raises(ValueError, match="Hash"):
            file_changes.propose_change(
                run_id="run-1",
                step_id="step-1",
                workspace_root=str(ws),
                request=ProposeFileChangeRequest(
                    file_path="src/app.py",
                    operation="modify",
                    summary="Bad hash",
                    proposed_content="x",
                    expected_before_hash="sha256:wrong",
                ),
            )


class TestReviewApproveApply:
    def test_approve_and_queue_host_action(self, patch_setup):
        svc, file_changes, host_actions, review_gates, ws, _ = patch_setup
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Patch"))
        run, steps = svc.set_plan(
            run.id,
            SetPlanRequest(steps=[PlanStepInput(title="Patch step")]),
        )

        change = file_changes.propose_change(
            run_id=run.id,
            step_id=steps[0].id,
            workspace_root=str(ws),
            request=ProposeFileChangeRequest(
                file_path="src/app.py",
                operation="modify",
                summary="Fix",
                proposed_content="def new(): pass\n",
            ),
        )

        approved = file_changes.approve_change(change.id)
        assert approved.status == "approved"

        gate = review_gates.get_gate(change.review_gate_id)
        assert gate.status == "approved"

        action = file_changes.create_apply_host_action(
            host_actions,
            approved,
            proposed_content="def new(): pass\n",
        )
        assert action.action_type == "apply_patch"
        assert action.status == "pending"

    def test_reject_change(self, patch_setup):
        svc, file_changes, _, review_gates, ws, _ = patch_setup
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Reject"))
        run, steps = svc.set_plan(run.id, SetPlanRequest(steps=[PlanStepInput(title="S")]))

        change = file_changes.propose_change(
            run_id=run.id,
            step_id=steps[0].id,
            workspace_root=str(ws),
            request=ProposeFileChangeRequest(
                file_path="src/app.py",
                operation="modify",
                summary="Reject me",
                proposed_content="def rejected(): pass\n",
            ),
        )

        rejected = file_changes.reject_change(change.id, reason="Not needed")
        assert rejected.status == "rejected"
        gate = review_gates.get_gate(change.review_gate_id)
        assert gate.status == "rejected"


class TestApplyComplete:
    def test_host_apply_marks_applied(self, patch_setup):
        svc, file_changes, host_actions, _, ws, _ = patch_setup
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Apply"))
        run, steps = svc.set_plan(run.id, SetPlanRequest(steps=[PlanStepInput(title="S")]))

        change = file_changes.propose_change(
            run_id=run.id,
            step_id=steps[0].id,
            workspace_root=str(ws),
            request=ProposeFileChangeRequest(
                file_path="src/app.py",
                operation="modify",
                summary="Apply",
                proposed_content="def applied(): pass\n",
            ),
        )
        file_changes.approve_change(change.id)
        action = file_changes.create_apply_host_action(
            host_actions, change, proposed_content="def applied(): pass\n"
        )

        host_actions.claim(action.id)
        host_actions.complete(action.id, result={"restore_point_id": "rp-1"})
        applied = file_changes.mark_applied(change.id, restore_point_id="rp-1")
        assert applied.status == "applied"
        assert applied.restore_point_id == "rp-1"
