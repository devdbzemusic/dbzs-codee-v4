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


def test_model_lab_scan_reports_progress_incrementally(tmp_path: Path) -> None:
    # Root-cause fix for the scan looking hung: scan_source() hashes every
    # candidate file's full content with no feedback until the whole scan
    # finished, so a large source's job row sat at total_files=0 for the
    # entire (potentially very long) run. This proves progress actually
    # lands in the DB mid-scan, not just at the end.
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    for name in ["a.gguf", "b.gguf", "c.gguf"]:
        (models_dir / name).write_bytes(b"not a real gguf but scanner only hashes bytes")

    service = _service(tmp_path / "test.sqlite3")
    source = service.create_source(ModelSourceCreate(path=str(models_dir)))

    observed_totals: list[int] = []
    original_report = service.repository.report_scan_progress

    def _spy_report(job_id: str, *, total_files: int, message: str) -> None:
        original_report(job_id, total_files=total_files, message=message)
        # Assert the write actually landed in the DB synchronously, not just
        # that the method was called with the right arguments.
        row = next(j for j in service.repository.list_jobs() if j.id == job_id)
        assert row.total_files == total_files
        assert row.progress_message == message
        observed_totals.append(total_files)

    service.repository.report_scan_progress = _spy_report  # type: ignore[method-assign]

    result = service.run_scan(source.id)

    assert result.job.status == "completed"
    assert result.job.total_files == 3
    # Initial 0/3 call plus one call per file = 4 progress reports.
    assert observed_totals == [0, 1, 2, 3]


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
