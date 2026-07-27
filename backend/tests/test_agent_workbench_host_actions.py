"""Phase 3D — Host action bridge tests."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent_workbench.host_actions import HostActionService
from app.agent_workbench.repository import AgentWorkbenchRepository
from app.agent_workbench.service import reset_agent_workbench_service
from app.agent_workbench.state_machine import InvalidTransitionError
from app.main import app


@pytest.fixture
def host_setup(tmp_path: Path):
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    repo = AgentWorkbenchRepository(db_path=db_path)
    host_svc = HostActionService(repo)
    svc = reset_agent_workbench_service(db_path=db_path, auto_start_worker=False)
    client = TestClient(app)
    yield host_svc, repo, svc, client, db_path
    os.unlink(db_path)


class TestHostActionLifecycle:
    def test_create_claim_complete(self, host_setup):
        host_svc, repo, _, _, _ = host_setup
        action = host_svc.create_action(
            run_id="run-1",
            step_id="step-1",
            action_type="apply_patch",
            payload={"file_path": "src/a.ts"},
        )
        assert action.status == "pending"

        claimed = host_svc.claim(action.id, "desktop-primary")
        assert claimed.status == "claimed"
        assert claimed.executor_id == "desktop-primary"

        completed = host_svc.complete(action.id, result={"applied": True})
        assert completed.status == "completed"

    def test_claim_is_idempotent(self, host_setup):
        host_svc, _, _, _, _ = host_setup
        action = host_svc.create_action(
            run_id="run-1",
            step_id="step-1",
            action_type="refresh_workspace",
            payload={},
        )
        first = host_svc.claim(action.id, "desktop-primary")
        second = host_svc.claim(action.id, "desktop-primary")
        assert first.id == second.id
        assert second.status == "claimed"

    def test_complete_is_idempotent(self, host_setup):
        host_svc, _, _, _, _ = host_setup
        action = host_svc.create_action(
            run_id="run-1",
            step_id="step-1",
            action_type="run_command",
            payload={"command_id": "pnpm.test"},
        )
        host_svc.claim(action.id)
        first = host_svc.complete(action.id, result={"exit_code": 0})
        second = host_svc.complete(action.id, result={"exit_code": 0})
        assert first.status == "completed"
        assert second.status == "completed"

    def test_fail_action(self, host_setup):
        host_svc, _, _, _, _ = host_setup
        action = host_svc.create_action(
            run_id="run-1",
            step_id="step-1",
            action_type="apply_patch",
            payload={},
        )
        host_svc.claim(action.id)
        failed = host_svc.fail(action.id, error_message="Hash mismatch")
        assert failed.status == "failed"
        assert failed.error_message == "Hash mismatch"

    def test_max_one_claimed(self, host_setup):
        host_svc, _, _, _, _ = host_setup
        a1 = host_svc.create_action(
            run_id="run-1", step_id="step-1", action_type="apply_patch", payload={}
        )
        a2 = host_svc.create_action(
            run_id="run-1", step_id="step-1", action_type="apply_patch", payload={}
        )
        host_svc.claim(a1.id)
        with pytest.raises(InvalidTransitionError):
            host_svc.claim(a2.id)


class TestHostActionApi:
    def test_next_claim_complete_via_api(self, host_setup):
        host_svc, _, _, client, _ = host_setup
        action = host_svc.create_action(
            run_id="run-api",
            step_id="step-api",
            action_type="git_commit",
            payload={"message": "test"},
        )

        next_resp = client.get("/agent-workbench/host-actions/next")
        assert next_resp.status_code == 200
        assert next_resp.json()["action"]["id"] == action.id

        claim_resp = client.post(
            f"/agent-workbench/host-actions/{action.id}/claim",
            json={"executor_id": "desktop-primary"},
        )
        assert claim_resp.status_code == 200
        assert claim_resp.json()["action"]["status"] == "claimed"

        complete_resp = client.post(
            f"/agent-workbench/host-actions/{action.id}/complete",
            json={"result": {"commit": "abc123"}},
        )
        assert complete_resp.status_code == 200
        assert complete_resp.json()["action"]["status"] == "completed"

    def test_fail_via_api(self, host_setup):
        host_svc, _, _, client, _ = host_setup
        action = host_svc.create_action(
            run_id="run-fail",
            step_id="step-fail",
            action_type="run_command",
            payload={},
        )
        client.post(f"/agent-workbench/host-actions/{action.id}/claim", json={})
        resp = client.post(
            f"/agent-workbench/host-actions/{action.id}/fail",
            json={"error_message": "Command failed"},
        )
        assert resp.status_code == 200
        assert resp.json()["action"]["status"] == "failed"

    def test_unknown_action_404(self, host_setup):
        _, _, _, client, _ = host_setup
        resp = client.post("/agent-workbench/host-actions/ha-missing/claim", json={})
        assert resp.status_code == 404
