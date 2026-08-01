from fastapi import APIRouter, Depends, HTTPException

from app.model_lab.models import (
    CollectionMembershipRequest,
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
    ScanRequest,
    ScanResult,
)
from app.model_lab.service import ModelLabService

router = APIRouter(prefix="/model-lab", tags=["model-lab"])


def get_model_lab_service() -> ModelLabService:
    return ModelLabService()


@router.get("/sources")
def list_sources(service: ModelLabService = Depends(get_model_lab_service)) -> list[ModelSource]:
    return service.list_sources()


@router.get("/source-candidates")
def list_source_candidates(service: ModelLabService = Depends(get_model_lab_service)) -> list[ModelSourceCandidate]:
    return service.list_source_candidates()


@router.post("/sources")
def create_source(
    request: ModelSourceCreate,
    service: ModelLabService = Depends(get_model_lab_service),
) -> ModelSource:
    try:
        return service.create_source(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/scan")
def run_scan(
    request: ScanRequest | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> ScanResult:
    try:
        return service.run_scan(
            source_id=request.source_id if request else None,
            all_sources=request.all_sources if request else False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/jobs")
def list_jobs(service: ModelLabService = Depends(get_model_lab_service)) -> list[ScanJob]:
    return service.list_jobs()


@router.get("/models")
def list_models(service: ModelLabService = Depends(get_model_lab_service)) -> list[ModelLabModel]:
    return service.list_models()


@router.get("/models/{bundle_id}")
def get_model(
    bundle_id: str,
    service: ModelLabService = Depends(get_model_lab_service),
) -> ModelLabModel:
    model = service.get_model(bundle_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model bundle not found")
    return model


@router.put("/models/{bundle_id}/metadata")
def update_model_metadata(
    bundle_id: str,
    request: ModelMetadataUpdate,
    service: ModelLabService = Depends(get_model_lab_service),
) -> ModelBundle:
    try:
        return service.update_model_metadata(bundle_id, request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/collections")
def list_collections(service: ModelLabService = Depends(get_model_lab_service)) -> list[ModelCollection]:
    return service.list_collections()


@router.post("/collections")
def create_collection(
    request: ModelCollectionCreate,
    service: ModelLabService = Depends(get_model_lab_service),
) -> ModelCollection:
    try:
        return service.create_collection(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/collections/{collection_id}/members")
def add_collection_member(
    collection_id: str,
    request: CollectionMembershipRequest,
    service: ModelLabService = Depends(get_model_lab_service),
) -> dict[str, str]:
    try:
        service.add_to_collection(collection_id, request.bundle_id)
        return {"status": "ok"}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/collections/{collection_id}/members/{bundle_id}")
def remove_collection_member(
    collection_id: str,
    bundle_id: str,
    service: ModelLabService = Depends(get_model_lab_service),
) -> dict[str, str]:
    service.remove_from_collection(collection_id, bundle_id)
    return {"status": "ok"}


@router.get("/duplicates")
def find_duplicates(service: ModelLabService = Depends(get_model_lab_service)) -> list[DuplicateGroup]:
    return service.find_duplicates()


@router.get("/hf/search")
def search_huggingface(
    query: str,
    category: str = "",
    limit: int = 25,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[HuggingFaceSearchResult]:
    return service.search_huggingface(query, category=category, limit=max(1, min(limit, 100)))


@router.get("/hf/repos/{repo_id:path}")
def get_huggingface_repo_info(
    repo_id: str,
    revision: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> HuggingFaceRepoInfo:
    info = service.get_huggingface_repo_info(repo_id, revision=revision)
    if info is None:
        raise HTTPException(status_code=404, detail="HuggingFace repository not found or API unavailable")
    return info


@router.get("/hardware")
def get_hardware(service: ModelLabService = Depends(get_model_lab_service)) -> HardwareProfile:
    return service.collect_hardware()


@router.get("/hardware-snapshots")
def list_hardware_snapshots(
    limit: int = 25,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[HardwareSnapshot]:
    return service.list_hardware_snapshots(limit=limit)


@router.get("/logical-models")
def list_logical_models(service: ModelLabService = Depends(get_model_lab_service)) -> list[LogicalModel]:
    return service.list_logical_models()


@router.get("/logical-models/{logical_model_id}")
def get_logical_model(
    logical_model_id: str,
    service: ModelLabService = Depends(get_model_lab_service),
) -> LogicalModel:
    model = service.get_logical_model(logical_model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Logical model not found")
    return model


@router.get("/variants")
def list_model_variants(
    logical_model_id: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelVariant]:
    return service.list_model_variants(logical_model_id=logical_model_id)


@router.get("/runtime-adapters")
def list_runtime_adapters(service: ModelLabService = Depends(get_model_lab_service)) -> list[RuntimeAdapterRecord]:
    return service.list_runtime_adapters()


@router.get("/runtime-presets")
def list_runtime_presets(service: ModelLabService = Depends(get_model_lab_service)) -> list[RuntimePresetRecord]:
    return service.list_runtime_presets()


@router.post("/probe")
def probe_model(
    request: ModelProbeRequest,
    service: ModelLabService = Depends(get_model_lab_service),
) -> ModelProbeRun:
    try:
        return service.probe_model(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/probe-runs")
def list_probe_runs(
    bundle_id: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelProbeRun]:
    return service.list_probe_runs(bundle_id=bundle_id)


@router.post("/benchmark")
def benchmark_model(
    request: ModelBenchmarkRequest,
    service: ModelLabService = Depends(get_model_lab_service),
) -> ModelBenchmarkRun:
    try:
        return service.benchmark_model(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/benchmark-runs")
def list_benchmark_runs(
    bundle_id: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelBenchmarkRun]:
    return service.list_benchmark_runs(bundle_id=bundle_id)


@router.get("/benchmark-measurements")
def list_benchmark_measurements(
    benchmark_run_id: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelBenchmarkMeasurement]:
    return service.list_benchmark_measurements(benchmark_run_id=benchmark_run_id)


@router.post("/certifications")
def certify_model(
    request: ModelCertificationRequest,
    service: ModelLabService = Depends(get_model_lab_service),
) -> ModelCertificationRecord:
    try:
        return service.certify_model(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/certifications")
def list_certifications(
    bundle_id: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelCertificationRecord]:
    return service.list_certifications(bundle_id=bundle_id)


@router.post("/capability-evidence")
def record_capability_evidence(
    request: ModelCapabilityEvidenceRequest,
    service: ModelLabService = Depends(get_model_lab_service),
) -> ModelCapabilityEvidenceRecord:
    try:
        return service.record_capability_evidence(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/capability-evidence")
def list_capability_evidence(
    bundle_id: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelCapabilityEvidenceRecord]:
    return service.list_capability_evidence(bundle_id=bundle_id)


@router.post("/role-assignments")
def assign_model_role(
    request: ModelRoleAssignmentRequest,
    service: ModelLabService = Depends(get_model_lab_service),
) -> ModelRoleAssignment:
    try:
        return service.assign_model_role(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/role-assignments")
def list_role_assignments(
    role: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelRoleAssignment]:
    return service.list_role_assignments(role=role)


@router.get("/routing-map")
def list_routing_map(
    role: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelFleetRoutingEntry]:
    return service.list_routing_map(role=role)


@router.get("/execution-policies")
def list_execution_policies(
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelExecutionPolicy]:
    return service.list_execution_policies()


@router.get("/failures")
def list_failures(
    bundle_id: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelFailureRecord]:
    return service.list_failures(bundle_id=bundle_id)

