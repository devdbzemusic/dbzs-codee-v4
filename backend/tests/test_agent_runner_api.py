from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent_runner.service import AgentRunnerService
from app.api.agent_runner import get_runner
from app.job_spooler.models import JobEnqueueRequest
from app.job_spooler.service import JobSpoolerService
from app.main import app


@pytest.fixture
def runner_setup(tmp_path: Path):
    jobs = JobSpoolerService(db_path=tmp_path / "jobs.sqlite3")
    runner = AgentRunnerService(job_spooler=jobs)
    app.dependency_overrides[get_runner] = lambda: runner
    client = TestClient(app)
    yield client, runner, jobs, tmp_path
    app.dependency_overrides.clear()


def test_agent_runner_idle_when_no_jobs(runner_setup) -> None:
    client, _, _, _ = runner_setup
    status = client.get("/agent-runner/status")
    assert status.status_code == 200
    assert status.json()["state"] == "idle"

    result = client.post(
        "/agent-runner/run-once",
        json={"agent_id": "agent-coder-1", "supported_roles": ["coder"]},
    )
    assert result.status_code == 200
    body = result.json()
    assert body["state"] == "idle"
    assert body["job_id"] is None


def test_agent_runner_happy_path(runner_setup) -> None:
    client, _, jobs, tmp_path = runner_setup
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    (workspace / "README.md").write_text("# Demo\n", encoding="utf-8")
    (workspace / "package.json").write_text('{"name":"demo"}', encoding="utf-8")

    enqueue = jobs.enqueue_job(
        JobEnqueueRequest(
            title="Analyze workspace",
            task_type="analysis",
            assigned_agent_role="coder",
            input_payload={"workspace_root": str(workspace)},
        )
    )

    result = client.post(
        "/agent-runner/run-once",
        json={"agent_id": "agent-coder-1", "supported_roles": ["coder"]},
    )
    assert result.status_code == 200
    body = result.json()
    assert body["job_id"] == enqueue.id
    assert body["state"] == "idle"
    assert "context_pack.md" in body["artifacts"]

    detail = jobs.get_job_detail(enqueue.id)
    assert detail.job.status == "completed"
    assert any(event.waypoint == "started" for event in detail.events)
    assert any(artifact.name == "run_summary.md" for artifact in detail.artifacts)


def test_agent_runner_fails_without_workspace(runner_setup) -> None:
    client, _, jobs, _ = runner_setup
    job = jobs.enqueue_job(
        JobEnqueueRequest(
            title="Missing workspace",
            assigned_agent_role="coder",
            input_payload={},
        )
    )

    result = client.post(
        "/agent-runner/run-once",
        json={"agent_id": "agent-coder-1", "supported_roles": ["coder"]},
    )
    assert result.status_code == 200
    assert result.json()["state"] == "failed"
    assert jobs.get_job(job.id).status == "failed"

