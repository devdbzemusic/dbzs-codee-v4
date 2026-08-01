from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.model_lab.models import HardwareProfile, ModelLabModel, ModelSource, ModelSourceCreate, ScanJob, ScanResult
from app.model_lab.repository import ModelLabRepository
from app.model_lab.scanner import ModelLabScanner
from app.runtime.gpu_detect import detect_gpu
from app.runtime.hardware_fingerprint import collect_hardware_fingerprint, fingerprint_hash


class ModelLabService:
    def __init__(
        self,
        repository: ModelLabRepository | None = None,
        scanner: ModelLabScanner | None = None,
    ) -> None:
        self.repository = repository or ModelLabRepository()
        self.scanner = scanner or ModelLabScanner()

    def create_source(self, request: ModelSourceCreate) -> ModelSource:
        source_path = Path(request.path).expanduser()
        if not source_path.exists() or not source_path.is_dir():
            raise ValueError(f"Modellquelle existiert nicht oder ist kein Ordner: {source_path}")
        return self.repository.create_source(request)

    def list_sources(self) -> list[ModelSource]:
        return self.repository.list_sources()

    def run_scan(self, source_id: str | None = None) -> ScanResult:
        sources = self._scan_sources(source_id)
        job = self.repository.create_scan_job(source_id)
        started_at = datetime.now(UTC)
        self.repository.update_scan_job(job.id, status="running", started_at=started_at)
        all_artifacts = []
        all_bundles = []
        total_files = 0
        try:
            for source in sources:
                output = self.scanner.scan_source(source)
                self.repository.save_scan_output(
                    source=source,
                    artifacts=output.artifacts,
                    bundles=output.bundles,
                )
                total_files += output.total_files
                all_artifacts.extend(output.artifacts)
                all_bundles.extend(output.bundles)
            job = self.repository.update_scan_job(
                job.id,
                status="completed",
                total_files=total_files,
                artifact_count=len(all_artifacts),
                bundle_count=len(all_bundles),
                completed_at=datetime.now(UTC),
            )
            return ScanResult(job=job, artifacts=all_artifacts, bundles=all_bundles)
        except Exception as exc:
            for source in sources:
                self.repository.mark_source_failed(source, str(exc))
            job = self.repository.update_scan_job(
                job.id,
                status="failed",
                total_files=total_files,
                artifact_count=len(all_artifacts),
                bundle_count=len(all_bundles),
                error=str(exc),
                completed_at=datetime.now(UTC),
            )
            return ScanResult(job=job, artifacts=all_artifacts, bundles=all_bundles)

    def list_jobs(self) -> list[ScanJob]:
        return self.repository.list_jobs()

    def list_models(self) -> list[ModelLabModel]:
        return self.repository.list_models()

    def get_model(self, bundle_id: str) -> ModelLabModel | None:
        return self.repository.get_model(bundle_id)

    def collect_hardware(self) -> HardwareProfile:
        gpu = detect_gpu()
        fingerprint = collect_hardware_fingerprint(gpu)
        return HardwareProfile(
            fingerprint_hash=fingerprint_hash(fingerprint),
            os=fingerprint.os,
            architecture=fingerprint.architecture,
            cpu_model=fingerprint.cpu_model,
            cpu_threads=fingerprint.cpu_threads,
            ram_bytes=fingerprint.ram_bytes,
            gpu_name=fingerprint.gpu_name,
            gpu_vendor=fingerprint.gpu_vendor,
            vram_bytes=fingerprint.vram_bytes,
            runtime_backend=fingerprint.runtime_backend,
            collected_at=datetime.now(UTC),
        )

    def _scan_sources(self, source_id: str | None) -> list[ModelSource]:
        if source_id:
            source = self.repository.get_source(source_id)
            if source is None:
                raise ValueError(f"Modellquelle nicht gefunden: {source_id}")
            return [source]
        return [source for source in self.repository.list_sources() if source.enabled]

