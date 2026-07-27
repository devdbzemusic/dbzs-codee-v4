from pathlib import Path

from fastapi.testclient import TestClient

from app.api.job_spooler import get_job_spooler_service  # type: ignore[import-not-found]
from app.job_spooler.service import JobSpoolerService  # type: ignore[import-not-found]
from app.main import app  # type: ignore[import-not-found]


def test_job_spooler_enqueue_claim_waypoint_complete_detail(tmp_path: Path) -> None:
    service = JobSpoolerService(db_path=tmp_path / "job_spooler.sqlite3")
    app.dependency_overrides[get_job_spooler_service] = lambda: service
    client = TestClient(app)

    enqueue_response = client.post(
        "/job-spooler/enqueue",
        json={
            "title": "Implementiere Build-Button",
            "task_type": "feature",
            "priority": 2,
            "assigned_agent_role": "coder",
            "input_payload": {"source": "assistant_suggestion"},
            "max_attempts": 3,
        },
    )
    assert enqueue_response.status_code == 200
    job_id = enqueue_response.json()["id"]

    claim_response = client.post(
        "/job-spooler/claim",
        json={"worker_id": "worker-coder-1", "supported_roles": ["coder"], "lease_seconds": 120},
    )
    assert claim_response.status_code == 200
    assert claim_response.json()["job"]["id"] == job_id

    waypoint_response = client.post(
        f"/job-spooler/{job_id}/waypoints",
        json={
            "worker_id": "worker-coder-1",
            "waypoint": "started",
            "message": "Implementierung gestartet",
            "progress": 10,
            "metadata": {"module": "runtime_chat"},
        },
    )
    assert waypoint_response.status_code == 200

    artifact_response = client.post(
        f"/job-spooler/{job_id}/artifacts",
        json={
            "worker_id": "worker-coder-1",
            "kind": "intermediate",
            "name": "patch-v1",
            "content": "diff --git a/file b/file",
            "metadata": {"size": 1},
        },
    )
    assert artifact_response.status_code == 200

    complete_response = client.post(
        f"/job-spooler/{job_id}/complete",
        json={
            "worker_id": "worker-coder-1",
            "output_payload": {"files_changed": 2, "tests": "passed"},
            "summary": "Fertiggestellt",
        },
    )
    assert complete_response.status_code == 200
    assert complete_response.json()["status"] == "completed"

    detail_response = client.get(f"/job-spooler/{job_id}/detail")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["job"]["id"] == job_id
    assert len(detail["events"]) >= 3
    assert len(detail["artifacts"]) == 1

    app.dependency_overrides.clear()


def test_job_spooler_verify_with_reranker_marks_failed(tmp_path: Path) -> None:
    service = JobSpoolerService(db_path=tmp_path / "job_spooler.sqlite3")
    app.dependency_overrides[get_job_spooler_service] = lambda: service
    client = TestClient(app)

    enqueue_response = client.post(
        "/job-spooler/enqueue",
        json={
            "title": "Review Ergebnis",
            "task_type": "verification",
            "priority": 1,
            "assigned_agent_role": "reviewer",
            "input_payload": {"candidate": "output-A"},
            "max_attempts": 2,
        },
    )
    job_id = enqueue_response.json()["id"]

    claim_response = client.post(
        "/job-spooler/claim",
        json={"worker_id": "worker-reviewer-1", "supported_roles": ["reviewer"], "lease_seconds": 120},
    )
    assert claim_response.status_code == 200

    verify_response = client.post(
        f"/job-spooler/{job_id}/verify",
        json={
            "worker_id": "worker-reviewer-1",
            "verdict": "failed",
            "reranker_score": 0.34,
            "reason": "Ranking zu schwach",
            "evidence": {"top_k": ["alt-A", "alt-B"]},
        },
    )
    assert verify_response.status_code == 200

    get_response = client.get(f"/job-spooler/{job_id}")
    assert get_response.status_code == 200
    assert get_response.json()["status"] == "failed"

    app.dependency_overrides.clear()
