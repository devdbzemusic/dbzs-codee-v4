from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.review_gates.router as review_gate_router_module
from app.review_gates.models import ReviewGateCreateRequest
from app.review_gates.service import ReviewGateService


def test_review_gate_api_filters_and_rejects_wrong_workspace(tmp_path, monkeypatch):
    service = ReviewGateService(db_path=str(tmp_path / "review-api.sqlite3"))
    gate = service.create_gate(ReviewGateCreateRequest(
        job_id="api-job-a",
        step_number=1,
        run_id="api-run-a",
        workspace_root="C:/work/a",
        workspace_id="c:/work/a",
        proposed_changes=[{"file_path": "src/a.py", "diff": "diff"}],
    ))
    monkeypatch.setattr(review_gate_router_module, "_service", service)
    app = FastAPI()
    app.include_router(review_gate_router_module.router)
    client = TestClient(app)

    response = client.get("/review-gates/pending", params={"workspace_id": "c:/work/a"})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["gates"]] == [gate.id]
    assert response.json()["gates"][0]["scope_status"] == "scoped"

    mismatch = client.post(
        f"/review-gates/{gate.id}/approve",
        json={"reviewed_by": "runtime-chat", "workspace_id": "c:/work/b"},
    )
    assert mismatch.status_code == 409
    assert service.get_gate(gate.id).status == "pending"
