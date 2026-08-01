from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.model_lab.hf_integration import HuggingFaceModelService
from app.model_lab.models import (
    DuplicateGroup,
    HardwareProfile,
    HuggingFaceRepoInfo,
    HuggingFaceSearchResult,
    LogicalModel,
    ModelBenchmarkRequest,
    ModelBenchmarkRun,
    ModelBundle,
    ModelCertificationRecord,
    ModelCertificationRequest,
    ModelCollection,
    ModelCollectionCreate,
    ModelFailureRecord,
    ModelLabModel,
    ModelMetadataUpdate,
    ModelProbeRequest,
    ModelProbeRun,
    ModelRoleAssignment,
    ModelRoleAssignmentRequest,
    ModelSource,
    ModelSourceCandidate,
    ModelSourceCreate,
    ModelVariant,
    RuntimeAdapterRecord,
    RuntimePresetRecord,
    ScanJob,
    ScanResult,
)
from app.model_lab.repository import ModelLabRepository
from app.model_lab.scanner import ModelLabScanner
from app.runtime.gpu_detect import detect_gpu
from app.runtime.hardware_fingerprint import collect_hardware_fingerprint, fingerprint_hash


class ModelLabService:
    stale_scan_job_age = timedelta(hours=2)
    source_candidates = (
        ("D:/Models/Agentic", "Agentic Model Fleet", True, "Plan-15-Startquelle fuer produktive Agentenmodelle."),
        ("D:/Models", "Lokale Modellbibliothek", False, "Breite lokale Modellablage."),
        ("F:/Models", "Externe Modellbibliothek F:", False, "Optionaler externer Modellpfad."),
        ("H:/Models", "Externe Modellbibliothek H:", False, "Optionaler externer Modellpfad."),
        ("C:/dev/prj/models/gguf", "GGUF-Arbeitsablage", False, "Optionaler Entwicklungs-/GGUF-Pfad."),
    )

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

    def list_source_candidates(self) -> list[ModelSourceCandidate]:
        registered = {Path(source.path).resolve() for source in self.repository.list_sources()}
        candidates: list[ModelSourceCandidate] = []
        for raw_path, label, recommended, reason in self.source_candidates:
            path = Path(raw_path)
            resolved = path.resolve()
            candidates.append(
                ModelSourceCandidate(
                    path=str(resolved),
                    label=label,
                    exists=path.exists() and path.is_dir(),
                    recommended=recommended,
                    reason=reason,
                    already_registered=resolved in registered,
                )
            )
        return candidates

    def run_scan(self, source_id: str | None = None) -> ScanResult:
        sources = self._scan_sources(source_id)
        self._mark_stale_scan_jobs()
        active_job = self.repository.get_active_scan_job(source_id)
        if active_job is not None:
            return ScanResult(job=active_job, artifacts=[], bundles=[])

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
        self._mark_stale_scan_jobs()
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

    def list_logical_models(self) -> list[LogicalModel]:
        return self.repository.list_logical_models()

    def get_logical_model(self, logical_model_id: str) -> LogicalModel | None:
        return self.repository.get_logical_model(logical_model_id)

    def list_model_variants(self, logical_model_id: str | None = None) -> list[ModelVariant]:
        return self.repository.list_model_variants(logical_model_id=logical_model_id)

    def list_runtime_adapters(self) -> list[RuntimeAdapterRecord]:
        return self.repository.list_runtime_adapters()

    def list_runtime_presets(self) -> list[RuntimePresetRecord]:
        return self.repository.list_runtime_presets()

    def probe_model(self, request: ModelProbeRequest) -> ModelProbeRun:
        model = self.repository.get_model(request.bundle_id)
        if model is None:
            raise ValueError(f"Model bundle nicht gefunden: {request.bundle_id}")
        primary = next((artifact for artifact in model.artifacts if artifact.artifact_id == model.bundle.primary_artifact_id), None)
        if primary is None:
            message = "Probe uebersprungen: Bundle hat kein startbares Primaerartefakt."
            self.repository.record_failure(bundle_id=request.bundle_id, operation="probeModel", message=message)
            return self.repository.create_probe_run(request, status="skipped", message=message)
        if request.adapter_id == "llama.cpp" and primary.format != "gguf":
            message = f"Probe fehlgeschlagen: llama.cpp unterstuetzt dieses Format nicht: {primary.format}"
            self.repository.record_failure(
                bundle_id=request.bundle_id,
                operation="probeModel",
                message=message,
                details={"format": primary.format, "artifact_id": primary.artifact_id},
            )
            return self.repository.create_probe_run(request, status="failed", message=message, error=message)
        if not request.allow_start:
            message = "Probe als sichere Vorpruefung gespeichert; Runtime-Start wurde nicht erlaubt."
            return self.repository.create_probe_run(request, status="skipped", message=message)
        message = "Runtime-Start-Gate akzeptiert; Live-Probe wird in der naechsten RuntimeAdapter-Phase ausgefuehrt."
        return self.repository.create_probe_run(request, status="queued", message=message)

    def benchmark_model(self, request: ModelBenchmarkRequest) -> ModelBenchmarkRun:
        message = "Benchmark-Messung gespeichert; echte Laufzeitmessung folgt ueber RuntimeAdapter-Gate."
        return self.repository.create_benchmark_run(request, status="queued", message=message)

    def certify_model(self, request: ModelCertificationRequest) -> ModelCertificationRecord:
        return self.repository.upsert_certification(request)

    def assign_model_role(self, request: ModelRoleAssignmentRequest) -> ModelRoleAssignment:
        return self.repository.assign_model_role(request)

    def list_certifications(self, bundle_id: str | None = None) -> list[ModelCertificationRecord]:
        return self.repository.list_certifications(bundle_id=bundle_id)

    def list_role_assignments(self, role: str | None = None) -> list[ModelRoleAssignment]:
        return self.repository.list_role_assignments(role=role)

    def list_probe_runs(self, bundle_id: str | None = None) -> list[ModelProbeRun]:
        return self.repository.list_probe_runs(bundle_id=bundle_id)

    def list_benchmark_runs(self, bundle_id: str | None = None) -> list[ModelBenchmarkRun]:
        return self.repository.list_benchmark_runs(bundle_id=bundle_id)

    def list_failures(self, bundle_id: str | None = None) -> list[ModelFailureRecord]:
        return self.repository.list_failures(bundle_id=bundle_id)

    def _scan_sources(self, source_id: str | None) -> list[ModelSource]:
        if source_id:
            source = self.repository.get_source(source_id)
            if source is None:
                raise ValueError(f"Modellquelle nicht gefunden: {source_id}")
            return [source]
        return [source for source in self.repository.list_sources() if source.enabled]

    def _mark_stale_scan_jobs(self) -> None:
        self.repository.mark_stale_scan_jobs_failed(
            older_than=datetime.now(UTC) - self.stale_scan_job_age,
            error="Scan wurde vor Abschluss unterbrochen oder vom Backend nicht beendet.",
        )

