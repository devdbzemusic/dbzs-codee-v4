"""Phase 3G — Follow-up and plan revision tests."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent_workbench.models import CreateRunRequest, FollowUpRequest, SetPlanRequest
from app.agent_workbench.planner import demo_readonly_steps
from app.agent_workbench.service import reset_agent_workbench_service
from app.main import app


@pytest.fixture
def followup_client(tmp_path: Path):
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    ws = tmp_path / "ws"
    ws.mkdir(parents=True, exist_ok=True)
    (ws / "README.md").write_text("# Demo", encoding="utf-8")

    svc = reset_agent_workbench_service(db_path=db_path, auto_start_worker=False)
    client = TestClient(app)
    yield client, svc, ws, db_path
    os.unlink(db_path)


class TestFollowUps:
    def test_create_followup(self, followup_client):
        _, svc, ws, _ = followup_client
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Original goal"))
        followup = svc.add_followup(run.id, FollowUpRequest(text="Also add tests"))
        assert followup.status == "pending"
        assert followup.text == "Also add tests"

        events = svc.list_events(run.id)
        assert any(e.event_type == "followup.received" for e in events)

    def test_apply_followup_revises_plan(self, followup_client):
        _, svc, ws, _ = followup_client
        run = svc.create_run(
            CreateRunRequest(workspace_root=str(ws), goal="Fix bug in module X")
        )
        svc.set_plan(run.id, SetPlanRequest(steps=demo_readonly_steps()))

        followup = svc.add_followup(run.id, FollowUpRequest(text="Include regression tests"))
        run, steps = svc.apply_followup_plan(run.id, followup.id)

        updated = svc.followups.get_followup(followup.id)
        assert updated is not None
        assert updated.status == "applied"
        assert len(steps) >= 3
        assert run.status == "ready"

        events = svc.list_events(run.id)
        assert any(e.event_type == "plan.revised" for e in events)

    def test_reject_followup(self, followup_client):
        _, svc, ws, _ = followup_client
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Goal"))
        followup = svc.add_followup(run.id, FollowUpRequest(text="Out of scope"))
        rejected = svc.followups.reject_followup(followup.id, reason="Out of scope")
        assert rejected.status == "rejected"

    def test_followup_api(self, followup_client):
        client, svc, ws, _ = followup_client
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="API followup"))

        resp = client.post(
            f"/agent-workbench/runs/{run.id}/followups",
            json={"text": "Add logging"},
        )
        assert resp.status_code == 200
        followup_id = resp.json()["followup"]["id"]

        apply_resp = client.post(
            f"/agent-workbench/runs/{run.id}/followups/{followup_id}/apply"
        )
        assert apply_resp.status_code == 200
        assert "steps" in apply_resp.json()

    def test_resume_after_recovery(self, tmp_path: Path):
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        (ws / "README.md").write_text("# Demo", encoding="utf-8")

        svc = reset_agent_workbench_service(
            db_path=db_path, simulate_llm=True, auto_start_worker=False
        )
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Recovery resume"))
        svc.set_plan(run.id, SetPlanRequest(steps=[demo_readonly_steps()[0]]))
        svc.start_run(run.id)

        svc2 = reset_agent_workbench_service(
            db_path=db_path, simulate_llm=True, auto_start_worker=False
        )
        recovered = svc2.get_run(run.id)
        assert recovered.status == "paused_recovery"

        resumed = svc2.resume_run(run.id)
        assert resumed.status == "running"
        os.unlink(db_path)
