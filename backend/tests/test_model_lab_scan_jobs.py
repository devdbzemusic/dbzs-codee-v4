from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.model_lab.models import ModelSourceCreate
from app.model_lab.repository import ModelLabRepository
from app.model_lab.scanner import ModelLabScanner
from app.model_lab.service import ModelLabService


def _service(db_path: Path) -> ModelLabService:
    return ModelLabService(
        repository=ModelLabRepository(db_path=db_path),
        scanner=ModelLabScanner(),
    )


def test_model_lab_marks_stale_scan_jobs_failed(tmp_path: Path) -> None:
    service = _service(tmp_path / "test.sqlite3")
    job = service.repository.create_scan_job(None)
    service.repository.update_scan_job(
        job.id,
        status="running",
        started_at=datetime.now(UTC) - timedelta(hours=3),
    )

    jobs = service.list_jobs()

    assert jobs[0].id == job.id
    assert jobs[0].status == "failed"
    assert jobs[0].completed_at is not None
    assert "unterbrochen" in (jobs[0].error or "")


def test_model_lab_reuses_active_scan_job_for_same_scope(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    service = _service(tmp_path / "test.sqlite3")
    source = service.create_source(ModelSourceCreate(path=str(models_dir)))
    active_job = service.repository.create_scan_job(source.id)
    active_job = service.repository.update_scan_job(
        active_job.id,
        status="running",
        started_at=datetime.now(UTC),
    )

    result = service.run_scan(source.id)

    assert result.job.id == active_job.id
    assert result.job.status == "running"
    assert result.artifacts == []
    assert result.bundles == []
