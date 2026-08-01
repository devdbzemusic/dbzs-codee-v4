from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.model_lab.hf_integration import HuggingFaceModelService
from app.model_lab.models import DuplicateGroup, HardwareProfile, HuggingFaceRepoInfo, HuggingFaceSearchResult, ModelBundle, ModelCollection, ModelCollectionCreate, ModelLabModel, ModelMetadataUpdate, ModelSource, ModelSourceCreate, ScanJob, ScanResult
from app.model_lab.repository import ModelLabRepository
from app.model_lab.scanner import ModelLabScanner
from app.runtime.gpu_detect import detect_gpu
from app.runtime.hardware_fingerprint import collect_hardware_fingerprint, fingerprint_hash


class ModelLabService:
    def __init__(
        self,
        repository: ModelLabRepository | None = None,
        scanner: ModelLabScanner | None = None,
        hf_service: HuggingFaceModelService | None = None,
    ) -> None:
        self.repository = repository or ModelLabRepository()
        self.scanner = scanner or ModelLabScanner()
        self.hf_service = hf_service or HuggingFaceModelService()

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

    def update_model_metadata(self, bundle_id: str, update: ModelMetadataUpdate) -> ModelBundle:
        return self.repository.update_model_metadata(bundle_id, update)

    def list_collections(self) -> list[ModelCollection]:
        return self.repository.list_collections()

    def create_collection(self, request: ModelCollectionCreate) -> ModelCollection:
        if not request.name.strip():
            raise ValueError("Collection-Name fehlt.")
        return self.repository.create_collection(request)

    def add_to_collection(self, collection_id: str, bundle_id: str) -> None:
        self.repository.add_to_collection(collection_id, bundle_id)

    def remove_from_collection(self, collection_id: str, bundle_id: str) -> None:
        self.repository.remove_from_collection(collection_id, bundle_id)

    def find_duplicates(self) -> list[DuplicateGroup]:
        return self.repository.find_duplicates()

    def search_huggingface(self, query: str, *, category: str = "", limit: int = 25) -> list[HuggingFaceSearchResult]:
        return self.hf_service.search_models(query, category=category, limit=limit)

    def get_huggingface_repo_info(self, repo_id: str, *, revision: str | None = None) -> HuggingFaceRepoInfo | None:
        return self.hf_service.get_repo_info(repo_id, revision=revision)

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

