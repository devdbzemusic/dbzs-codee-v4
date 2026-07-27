"""Phase 3B — Event spine, worker, SSE replay tests."""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent_workbench.models import CreateRunRequest, PlanStepInput, SetPlanRequest
from app.agent_workbench.planner import demo_readonly_steps
from app.agent_workbench.service import reset_agent_workbench_service
from app.main import app


@pytest.fixture
def client_and_service(tmp_path: Path):
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    ws = tmp_path / "ws"
    ws.mkdir(parents=True, exist_ok=True)
    (ws / "README.md").write_text("# Demo workspace", encoding="utf-8")

    svc = reset_agent_workbench_service(
        db_path=db_path,
        simulate_llm=True,
        auto_start_worker=True,
    )
    client = TestClient(app)
    yield client, svc, ws, db_path
    svc._worker.stop() if svc._worker else None
    os.unlink(db_path)


def _wait_for_run_status(svc, run_id: str, status: str, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = svc.get_run(run_id)
        if run.status == status:
            return
        time.sleep(0.1)
    raise AssertionError(f"Run did not reach status {status}, got {svc.get_run(run_id).status}")


class TestEventSequence:
    def test_monotonic_event_sequence(self, client_and_service):
        client, svc, ws, _ = client_and_service
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Demo"))
        assert run.status == "created"
        events = svc.list_events(run.id)
        assert len(events) >= 1
        assert events[0].event_type == "run.created"
        assert events[0].sequence == 1


class TestDemoWorkerRun:
    def test_three_readonly_demo_steps_complete(self, client_and_service):
        client, svc, ws, _ = client_and_service
        run = svc.create_run(
            CreateRunRequest(
                workspace_root=str(ws),
                goal="Demo run",
                execution_mode="read_only",
                max_steps=5,
            )
        )
        steps_input = demo_readonly_steps()
        svc.set_plan(run.id, SetPlanRequest(steps=steps_input))
        svc.start_run(run.id)

        _wait_for_run_status(svc, run.id, "completed", timeout=15.0)

        events = svc.list_events(run.id)
        sequences = [e.sequence for e in events]
        assert sequences == sorted(sequences)
        assert len(set(sequences)) == len(sequences)

        event_types = [e.event_type for e in events]
        assert "run.created" in event_types
        assert "run.started" in event_types
        assert "run.completed" in event_types
        assert event_types.count("step.started") == 3
        assert event_types.count("step.completed") == 3

        steps = svc.list_steps(run.id)
        assert all(s.status == "completed" for s in steps)


class TestPauseResumeCancel:
    def test_pause_and_resume(self, tmp_path: Path):
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        svc = reset_agent_workbench_service(
            db_path=db_path, simulate_llm=True, auto_start_worker=False
        )
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Pause test"))
        svc.set_plan(run.id, SetPlanRequest(steps=demo_readonly_steps()))
        svc.start_run(run.id)
        svc.pause_run(run.id)
        assert svc.get_run(run.id).status == "paused"
        svc.resume_run(run.id)
        assert svc.get_run(run.id).status == "running"
        os.unlink(db_path)

    def test_cancel_run(self, tmp_path: Path):
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        svc = reset_agent_workbench_service(
            db_path=db_path, simulate_llm=True, auto_start_worker=False
        )
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Cancel test"))
        svc.set_plan(
            run.id,
            SetPlanRequest(steps=[PlanStepInput(title="Demo: Workspace auflisten")]),
        )
        svc.start_run(run.id)
        svc.cancel_run(run.id)
        assert svc.get_run(run.id).status == "cancelled"
        os.unlink(db_path)


class TestSseReplay:
    def test_sse_replays_events_after_sequence(self, client_and_service):
        client, svc, ws, _ = client_and_service
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="SSE"))
        svc.set_plan(run.id, SetPlanRequest(steps=demo_readonly_steps()))
        svc.start_run(run.id)
        _wait_for_run_status(svc, run.id, "completed", timeout=15.0)

        all_events = svc.list_events(run.id)
        mid = len(all_events) // 2
        after_seq = all_events[mid - 1].sequence if mid > 0 else 0

        response = client.get(f"/agent-workbench/runs/{run.id}/stream?after_sequence={after_seq}")
        assert response.status_code == 200

        body = response.text
        data_lines = [line for line in body.split("\n") if line.startswith("data: ")]
        assert len(data_lines) >= 1

        parsed = [json.loads(line[6:]) for line in data_lines]
        replay_sequences = [p["sequence"] for p in parsed]
        assert all(s > after_seq for s in replay_sequences)

    def test_events_api_pagination(self, client_and_service):
        client, svc, ws, _ = client_and_service
        run = svc.create_run(CreateRunRequest(workspace_root=str(ws), goal="Events API"))
        response = client.get(f"/agent-workbench/runs/{run.id}/events")
        assert response.status_code == 200
        assert "events" in response.json()
