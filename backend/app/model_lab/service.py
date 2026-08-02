from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.model_lab.hf_integration import HuggingFaceModelService
from app.model_lab.models import (
    DuplicateGroup,
    HardwareProfile,
    HardwareSnapshot,
    HuggingFaceRepoInfo,
    HuggingFaceSearchResult,
    LogicalModel,
    ModelBenchmarkMeasurement,
    ModelBenchmarkRequest,
    ModelBenchmarkRun,
    ModelBundle,
    ModelCapabilityEvidenceRecord,
    ModelCapabilityEvidenceRequest,
    ModelCertificationRecord,
    ModelCertificationRequest,
    ModelCollection,
    ModelCollectionCreate,
    ModelExecutionPolicy,
    ModelFailureRecord,
    ModelFleetReadinessEntry,
    ModelFleetRoutingEntry,
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
from app.model_lab.runtime_adapters import LlamaCppModelLabAdapter
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
        llama_cpp_adapter: LlamaCppModelLabAdapter | None = None,
    ) -> None:
        self.repository = repository or ModelLabRepository()
        self.scanner = scanner or ModelLabScanner()
        self.hf_service = hf_service or HuggingFaceModelService()
        self.llama_cpp_adapter = llama_cpp_adapter or LlamaCppModelLabAdapter()

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

    def run_scan(self, source_id: str | None = None, *, all_sources: bool = False) -> ScanResult:
        sources = self._scan_sources(source_id, all_sources=all_sources)
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
        profile = HardwareProfile(
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
        self.repository.record_hardware_snapshot(profile)
        return profile

    def list_hardware_snapshots(self, limit: int = 25) -> list[HardwareSnapshot]:
        return self.repository.list_hardware_snapshots(limit=limit)

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
        if request.adapter_id != self.llama_cpp_adapter.id:
            message = f"Probe fehlgeschlagen: RuntimeAdapter ist noch nicht implementiert: {request.adapter_id}"
            self.repository.record_failure(
                bundle_id=request.bundle_id,
                operation="probeModel",
                message=message,
                details={"adapter_id": request.adapter_id},
            )
            run = self.repository.create_probe_run(request, status="failed", message=message, error=message)
            self._record_probe_evidence(run)
            return run
        preview = self.llama_cpp_adapter.build_probe_preview(model, runtime_options=request.runtime_options)
        request_with_metrics = request.model_copy(update={"runtime_options": {**request.runtime_options, **preview}})
        blockers = preview.get("blockers") if isinstance(preview.get("blockers"), list) else []
        if blockers:
            message = f"Probe-Vorpruefung blockiert: {blockers[0]}"
            self.repository.record_failure(
                bundle_id=request.bundle_id,
                operation="probeModel",
                message=message,
                details=preview,
            )
            run = self.repository.create_probe_run(
                request_with_metrics,
                status="failed" if request.allow_start else "skipped",
                message=message,
                error=message if request.allow_start else None,
            )
            self._record_probe_evidence(run)
            return run
        if not request.allow_start:
            message = "Probe als sichere Vorpruefung gespeichert; Runtime-Start wurde nicht erlaubt."
            run = self.repository.create_probe_run(request_with_metrics, status="skipped", message=message)
            self._record_probe_evidence(run)
            return run
        message = "Runtime-Start-Gate akzeptiert; Live-Probe wird in der naechsten RuntimeAdapter-Phase ausgefuehrt."
        run = self.repository.create_probe_run(request_with_metrics, status="queued", message=message)
        self._record_probe_evidence(run)
        return run

    def benchmark_model(self, request: ModelBenchmarkRequest) -> ModelBenchmarkRun:
        message = "Benchmark-Messung gespeichert; echte Laufzeitmessung folgt ueber RuntimeAdapter-Gate."
        run = self.repository.create_benchmark_run(request, status="queued", message=message)
        self.repository.update_role_assignment_cache(request.bundle_id, benchmark_run_id=run.id)
        return run

    def certify_model(self, request: ModelCertificationRequest) -> ModelCertificationRecord:
        record = self.repository.upsert_certification(request)
        evidence_status = {
            "passed": "verified",
            "failed": "failed",
            "revoked": "revoked",
        }[record.status]
        self.repository.record_capability_evidence(
            ModelCapabilityEvidenceRequest(
                bundle_id=record.bundle_id,
                capability=f"certification:{record.certification}",
                status=evidence_status,
                evidence={
                    **record.evidence,
                    "certification": record.certification,
                    "certification_record_id": record.id,
                    "certification_status": record.status,
                },
            )
        )
        return record

    def record_capability_evidence(self, request: ModelCapabilityEvidenceRequest) -> ModelCapabilityEvidenceRecord:
        return self.repository.record_capability_evidence(request)

    def assign_model_role(self, request: ModelRoleAssignmentRequest) -> ModelRoleAssignment:
        return self.repository.assign_model_role(request)

    def list_certifications(self, bundle_id: str | None = None) -> list[ModelCertificationRecord]:
        return self.repository.list_certifications(bundle_id=bundle_id)

    def list_capability_evidence(self, bundle_id: str | None = None) -> list[ModelCapabilityEvidenceRecord]:
        return self.repository.list_capability_evidence(bundle_id=bundle_id)

    def list_role_assignments(self, role: str | None = None) -> list[ModelRoleAssignment]:
        return self.repository.list_role_assignments(role=role)

    def list_routing_map(self, role: str | None = None) -> list[ModelFleetRoutingEntry]:
        return self.repository.list_routing_map(role=role)

    def list_readiness(self, bundle_id: str | None = None) -> list[ModelFleetReadinessEntry]:
        return self.repository.list_readiness(bundle_id=bundle_id)

    def list_execution_policies(self) -> list[ModelExecutionPolicy]:
        return self.repository.list_execution_policies()

    def list_probe_runs(self, bundle_id: str | None = None) -> list[ModelProbeRun]:
        return self.repository.list_probe_runs(bundle_id=bundle_id)

    def list_benchmark_runs(self, bundle_id: str | None = None) -> list[ModelBenchmarkRun]:
        return self.repository.list_benchmark_runs(bundle_id=bundle_id)

    def list_benchmark_measurements(self, benchmark_run_id: str | None = None) -> list[ModelBenchmarkMeasurement]:
        return self.repository.list_benchmark_measurements(benchmark_run_id=benchmark_run_id)

    def list_failures(self, bundle_id: str | None = None) -> list[ModelFailureRecord]:
        return self.repository.list_failures(bundle_id=bundle_id)

    def _record_probe_evidence(self, run: ModelProbeRun) -> None:
        evidence_status = {
            "passed": "verified",
            "failed": "failed",
            "skipped": "observed",
            "queued": "observed",
            "running": "observed",
        }.get(run.status, "observed")
        self.repository.record_capability_evidence(
            ModelCapabilityEvidenceRequest(
                bundle_id=run.bundle_id,
                capability=f"runtime_probe:{run.adapter_id}",
                status=evidence_status,
                evidence={
                    "probe_run_id": run.id,
                    "probe_status": run.status,
                    "allow_start": run.allow_start,
                    "message": run.message,
                    "error": run.error,
                    "metrics": run.metrics,
                },
            )
        )

    def _scan_sources(self, source_id: str | None, *, all_sources: bool) -> list[ModelSource]:
        if source_id:
            source = self.repository.get_source(source_id)
            if source is None:
                raise ValueError(f"Modellquelle nicht gefunden: {source_id}")
            return [source]
        if not all_sources:
            raise ValueError("Scan benötigt eine source_id. Für einen bewussten Vollscan all_sources=true senden.")
        return [source for source in self.repository.list_sources() if source.enabled]

    def _mark_stale_scan_jobs(self) -> None:
        self.repository.mark_stale_scan_jobs_failed(
            older_than=datetime.now(UTC) - self.stale_scan_job_age,
            error="Scan wurde vor Abschluss unterbrochen oder vom Backend nicht beendet.",
        )

