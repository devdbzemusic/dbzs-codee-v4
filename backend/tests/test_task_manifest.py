from pathlib import Path

import pytest

from app.agent_workbench.models import AcceptWorkspaceChangesRequest, AgentRun, CreateRunRequest
from app.agent_workbench.service import AgentWorkbenchService
from app.agent_workbench.task_manifest import TaskManifestStore


def _run(root: Path) -> AgentRun:
    return AgentRun(id="run-test", workspace_root=str(root), workspace_name="test", goal="test",
                    status="paused", execution_mode="supervised", provider="local", model_id="model",
                    max_steps=5, created_at="now", updated_at="now")


def test_manifest_refresh_accepts_expected_changes_and_ignores_test_cache(tmp_path: Path) -> None:
    source = tmp_path / "source.py"
    source.write_text("value = 1\n", encoding="utf-8")
    store = TaskManifestStore()
    run = _run(tmp_path)
    store.materialize(run, [])
    source.write_text("value = 2\n", encoding="utf-8")
    assert store.validate(run) == ["source.py"]
    store.materialize(run, [])
    (tmp_path / ".pytest_cache").mkdir()
    (tmp_path / ".pytest_cache" / "state").write_text("generated", encoding="utf-8")
    assert store.validate(run) == []


def test_resume_requires_explicit_missing_manifest_baseline(tmp_path: Path) -> None:
    service = AgentWorkbenchService(db_path=str(tmp_path / "agent_workbench.db"), auto_start_worker=False)
    run = service.create_run(CreateRunRequest(workspace_root=str(tmp_path), goal="resume test"))
    service.auto_plan(run.id)
    service.start_run(run.id)
    service.pause_run(run.id)
    manifest_path = Path(run.workspace_root) / ".codee" / "tasks" / run.id / "task.json"
    manifest_path.unlink(missing_ok=True)

    with pytest.raises(ValueError, match="resume_baseline_missing"):
        service.resume_run(run.id)
    assert service.get_run(run.id).status == "migration_review_required"
    accepted = service.accept_resume_baseline(run.id)
    assert accepted.status == "paused"
    assert manifest_path.exists()
    resumed = service.resume_run(run.id)
    assert resumed.status == "running"


def test_paused_resume_requires_explicit_workspace_change_acceptance(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "source.py"
    source.write_text("value = 1\n", encoding="utf-8")
    service = AgentWorkbenchService(db_path=str(tmp_path / "agent_workbench.db"), auto_start_worker=False)
    run = service.create_run(CreateRunRequest(workspace_root=str(workspace), goal="workspace drift test"))
    service.auto_plan(run.id)
    service.start_run(run.id)
    service.pause_run(run.id)

    source.write_text("value = 2\n", encoding="utf-8")
    with pytest.raises(ValueError, match="workspace_changed: source.py"):
        service.resume_run(run.id)

    blocked = service.get_run(run.id)
    assert blocked.status == "workspace_review_required"
    assert service.get_workspace_changes(run.id) == ["source.py"]
    events = service.list_events(run.id)
    assert any(event.event_type == "run.workspace_changes_detected" for event in events)

    with pytest.raises(ValueError, match="workspace_changes_mismatch"):
        service.accept_workspace_changes(
            run.id,
            AcceptWorkspaceChangesRequest(expected_changed_files=["other.py"]),
        )

    accepted = service.accept_workspace_changes(
        run.id,
        AcceptWorkspaceChangesRequest(expected_changed_files=["source.py"]),
    )
    assert accepted.status == "paused"
    assert service.get_workspace_changes(run.id) == []
    assert any(event.event_type == "run.workspace_changes_accepted" for event in service.list_events(run.id))

    resumed = service.resume_run(run.id)
    assert resumed.status == "running"


def test_workspace_review_can_be_cleared_after_manual_revert(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "source.py"
    source.write_text("value = 1\n", encoding="utf-8")
    service = AgentWorkbenchService(db_path=str(tmp_path / "agent_workbench.db"), auto_start_worker=False)
    run = service.create_run(CreateRunRequest(workspace_root=str(workspace), goal="manual revert test"))
    service.auto_plan(run.id)
    service.start_run(run.id)
    service.pause_run(run.id)

    source.write_text("value = 2\n", encoding="utf-8")
    with pytest.raises(ValueError, match="workspace_changed: source.py"):
        service.resume_run(run.id)
    assert service.get_run(run.id).status == "workspace_review_required"

    source.write_text("value = 1\n", encoding="utf-8")
    assert service.get_workspace_changes(run.id) == []
    with pytest.raises(ValueError, match="workspace_changed: explicit workspace approval required"):
        service.resume_run(run.id)
    assert service.get_run(run.id).status == "workspace_review_required"
    accepted = service.accept_workspace_changes(
        run.id,
        AcceptWorkspaceChangesRequest(expected_changed_files=[]),
    )
    assert accepted.status == "paused"
    assert service.resume_run(run.id).status == "running"


def test_resume_does_not_overwrite_workspace_review_when_manifest_missing(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "source.py"
    source.write_text("value = 1\n", encoding="utf-8")
    service = AgentWorkbenchService(db_path=str(tmp_path / "agent_workbench.db"), auto_start_worker=False)
    run = service.create_run(CreateRunRequest(workspace_root=str(workspace), goal="workspace review test"))
    service.auto_plan(run.id)
    service.start_run(run.id)
    service.pause_run(run.id)

    source.write_text("value = 2\n", encoding="utf-8")
    with pytest.raises(ValueError, match="workspace_changed: source.py"):
        service.resume_run(run.id)
    assert service.get_run(run.id).status == "workspace_review_required"

    manifest_path = Path(run.workspace_root) / ".codee" / "tasks" / run.id / "task.json"
    manifest_path.unlink(missing_ok=True)

    with pytest.raises(ValueError, match="workspace_changed: explicit workspace approval required"):
        service.resume_run(run.id)
    assert service.get_run(run.id).status == "workspace_review_required"


def test_create_run_rolls_back_when_manifest_materialization_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = AgentWorkbenchService(db_path=str(tmp_path / "agent_workbench.db"), auto_start_worker=False)

    def fail_materialize(*args: object, **kwargs: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(service._manifests, "materialize", fail_materialize)

    with pytest.raises(RuntimeError, match="boom"):
        service.create_run(CreateRunRequest(workspace_root=str(tmp_path), goal="rollback test"))

    assert service.repo.list_runs(limit=10) == []
