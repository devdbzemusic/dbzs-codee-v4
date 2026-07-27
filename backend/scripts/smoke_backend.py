"""Backend smoke checks for Phase 0 manual acceptance (no live server required)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.main import app


def main() -> None:
    client = TestClient(app)

    health = client.get("/health")
    assert health.status_code == 200, health.text
    assert health.json()["status"] == "ok"

    jobs = client.get("/job-spooler")
    assert jobs.status_code == 200, jobs.text
    assert isinstance(jobs.json(), list)

    profiles = client.get("/model-profiles/list")
    assert profiles.status_code == 200, profiles.text
    assert "profiles" in profiles.json()

    profile_health = client.get("/model-profiles/health")
    assert profile_health.status_code == 200, profile_health.text

    runner_status = client.get("/agent-runner/status")
    assert runner_status.status_code == 200, runner_status.text
    assert runner_status.json()["state"] == "idle"

    enqueue = client.post(
        "/job-spooler/enqueue",
        json={
            "title": "Smoke Test Job",
            "task_type": "verification",
            "priority": 1,
            "assigned_agent_role": "coder",
            "input_payload": {"source": "smoke"},
            "max_attempts": 1,
        },
    )
    assert enqueue.status_code == 200, enqueue.text
    job_id = enqueue.json()["id"]

    detail = client.get(f"/job-spooler/{job_id}/detail")
    assert detail.status_code == 200, detail.text
    assert detail.json()["job"]["id"] == job_id

    print("smoke-backend: OK")
    print(f"  health: {health.json()}")
    print(f"  jobs listed: {len(jobs.json())}")
    print(f"  profiles: {len(profiles.json()['profiles'])}")
    print(f"  agent-runner: {runner_status.json()['state']}")
    print(f"  enqueue/detail: {job_id}")


if __name__ == "__main__":
    main()
