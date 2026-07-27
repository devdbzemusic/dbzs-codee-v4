from pathlib import Path

from fastapi.testclient import TestClient

from app.agent_workbench.models import CreateRunRequest
from app.agent_workbench.service import reset_agent_workbench_service
from app.main import app


def test_accept_resume_baseline_not_required_returns_validation_status(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "README.md").write_text("# Demo\n", encoding="utf-8")
    service = reset_agent_workbench_service(
        db_path=str(tmp_path / "agent_workbench.db"),
        auto_start_worker=False,
    )
    run = service.create_run(CreateRunRequest(workspace_root=str(workspace), goal="status mapping"))

    response = TestClient(app).post(f"/agent-workbench/runs/{run.id}/accept-resume-baseline")

    assert response.status_code == 422
    assert response.json()["detail"] == "resume_baseline_not_required"


def test_workspace_changes_api_exposes_and_accepts_paused_drift(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "source.py"
    source.write_text("value = 1\n", encoding="utf-8")
    service = reset_agent_workbench_service(
        db_path=str(tmp_path / "agent_workbench.db"),
        auto_start_worker=False,
    )
    run = service.create_run(CreateRunRequest(workspace_root=str(workspace), goal="workspace drift"))
    service.auto_plan(run.id)
    service.start_run(run.id)
    service.pause_run(run.id)
    source.write_text("value = 2\n", encoding="utf-8")

    resume_response = TestClient(app).post(f"/agent-workbench/runs/{run.id}/resume")
    assert resume_response.status_code == 409
    assert service.get_run(run.id).status == "workspace_review_required"

    changes_response = TestClient(app).get(f"/agent-workbench/runs/{run.id}/workspace-changes")
    assert changes_response.status_code == 200
    assert changes_response.json() == {"changed_files": ["source.py"]}

    accept_response = TestClient(app).post(
        f"/agent-workbench/runs/{run.id}/accept-workspace-changes",
        json={"expected_changed_files": ["source.py"]},
    )
    assert accept_response.status_code == 200
    assert accept_response.json()["run"]["status"] == "paused"
