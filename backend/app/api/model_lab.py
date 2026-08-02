from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

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
    ModelFleetReadinessEntry,
    ModelFleetRoutingEntry,
    ModelLabModel,
    ModelMetadataUpdate,
    ModelProbeRequest,
    ModelProbeRun,
    ModelResidencyIntent,
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
from app.model_lab.repository import ModelLabRepository, get_shared_model_lab_repository
from app.model_lab.service import ModelLabService
from app.models.discovery_mode import get_model_discovery_mode
from app.models.index_service import ModelIndexService
from app.models.model_lab_bridge import resolve_bundle_to_model_id
from app.settings.models import SettingsRevisionConflict
from app.settings.service import get_settings_service

router = APIRouter(prefix="/model-lab", tags=["model-lab"])


def get_model_lab_service() -> ModelLabService:
    return ModelLabService()


def _apply_role_assignment_to_settings(
    request: ModelRoleAssignmentRequest, model_lab_repo: ModelLabRepository
) -> None:
    """Closes the Model-Lab -> Settings gap: assigning a bundle to a role with a
    concrete settings_field must actually make it selectable there, not just record
    an internal assignment row (Workflow-Bruch-Audit WF-12 "UI vor operativer
    Authority"). Best-effort: logs and returns without raising if the bundle can't
    yet be resolved to a runtime model id (e.g. runtime bridge just enabled, index
    not rebuilt yet) or if the settings revision changed concurrently — the role
    assignment itself must still succeed either way.

    Takes the same ModelLabRepository instance the calling endpoint's service uses
    (rather than the shared singleton) so it respects test/dependency overrides."""
    if not request.settings_field or not request.enabled:
        return
    settings_service = get_settings_service()
    index_service = ModelIndexService(
        discovery_mode=get_model_discovery_mode(),
        model_lab_repository=model_lab_repo,
        settings_service=settings_service,
    )
    model_index = index_service.load_cached_index() or index_service.build_index()
    model_id = resolve_bundle_to_model_id(
        request.bundle_id,
        model_lab_repo=model_lab_repo,
        model_index=model_index,
    )
    if not model_id:
        print(
            f"[model-lab] role assignment for bundle '{request.bundle_id}' could not be "
            f"applied to settings.{request.settings_field}: bundle not resolvable in the "
            "current runtime model index."
        )
        return
    current = settings_service.load()
    try:
        settings_service.patch(current.revision, {request.settings_field: model_id})
    except SettingsRevisionConflict:
        print(
            f"[model-lab] settings revision changed concurrently; role assignment for "
            f"'{request.bundle_id}' was saved, but settings.{request.settings_field} was "
            "not updated automatically."
        )


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
        assignment = service.assign_model_role(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _apply_role_assignment_to_settings(request, service.repository)
    return assignment


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


@router.get("/readiness")
def list_readiness(
    bundle_id: str | None = None,
    service: ModelLabService = Depends(get_model_lab_service),
) -> list[ModelFleetReadinessEntry]:
    return service.list_readiness(bundle_id=bundle_id)


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


# ---------------------------------------------------------------------------
# Plan 16, Stufe 4 – Residency-Default-Vorschlagslogik
# ---------------------------------------------------------------------------

class ResidencySuggestion(BaseModel):
    bundle_id: str
    suggested_intent: ModelResidencyIntent
    reason: str


@router.get("/models/{bundle_id}/residency-suggestion")
def get_residency_suggestion(
    bundle_id: str,
    repository: ModelLabRepository = Depends(get_shared_model_lab_repository),
) -> ResidencySuggestion:
    """Non-binding residency intent suggestion for a specific bundle.

    Returns a computed suggestion based on modalities, health status, and
    certification state. The caller may apply it or ignore it — this endpoint
    never writes to the database.
    """
    model = repository.get_model(bundle_id)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Bundle '{bundle_id}' nicht gefunden.")

    suggested = repository.suggest_residency_intent(bundle_id)

    # Build a human-readable explanation alongside the suggestion.
    health_status = model.bundle.health.status if model.bundle.health else "unknown"
    modalities = model.bundle.modalities or []

    if health_status in ("error", "incomplete"):
        reason = f"Health-Status '{health_status}' — manuell belassen (Neustart würde silent fehlschlagen)."
    elif "vision" in modalities or "multimodal" in modalities:
        reason = "Vision-/Multimodal-Modell — idle_evict gibt VRAM frei ohne Neustart zu blockieren."
    else:
        certifications = repository.list_certifications(bundle_id=bundle_id)
        if any(c.passed for c in certifications):
            reason = "Zertifiziertes Modell — idle_evict da Neustart verifiziert stabil."
        else:
            reason = "Noch nicht zertifiziert — manuell belassen bis Zertifizierung vorliegt."

    return ResidencySuggestion(
        bundle_id=bundle_id,
        suggested_intent=suggested,
        reason=reason,
    )


class ResidencyDefaultsResult(BaseModel):
    applied: int
    skipped: int
    assignments: list[dict]


# Standard-Slot-Zuordnung (Plan 16, Stufe 4): Modell-ID-Substring → (Slot, Rolle)
_SLOT_DEFAULTS: list[tuple[str, str, str]] = [
    ("QwenPaw",         "fast_gpu",         "primary_worker"),
    ("InternScience_Agents", "orchestrator_cpu", "orchestrator"),
    ("MiniCPM5",        "utility",          "utility"),
    ("InternScience",   "vision_gpu",       "vision_worker"),
]


@router.post("/apply-residency-defaults")
def apply_residency_defaults(
    repository: ModelLabRepository = Depends(get_shared_model_lab_repository),
) -> ResidencyDefaultsResult:
    """Applies Plan-16 standard slot assignments for known model families.

    Only sets residency_intent when the bundle has no existing role assignment
    yet — never overwrites an explicit user choice. Safe to call repeatedly.
    """
    applied = 0
    skipped = 0
    assignments: list[dict] = []

    all_models = repository.list_models()
    existing_assignments = {a.bundle_id for a in repository.list_role_assignments()}

    for model in all_models:
        if model is None or model.bundle is None:
            continue
        bundle_id = model.bundle.id
        if bundle_id in existing_assignments:
            skipped += 1
            continue

        bundle_name = (model.bundle.name or "").lower()
        matched_slot: str | None = None
        matched_role: str | None = None
        for name_fragment, slot, role in _SLOT_DEFAULTS:
            if name_fragment.lower() in bundle_name:
                matched_slot = slot
                matched_role = role
                break

        if matched_slot is None:
            skipped += 1
            continue

        suggested = repository.suggest_residency_intent(bundle_id)
        try:
            from app.model_lab.models import ModelRoleAssignmentRequest  # noqa: PLC0415
            repository.assign_model_role(
                ModelRoleAssignmentRequest(
                    bundle_id=bundle_id,
                    role=matched_role,  # type: ignore[arg-type]
                    residency_intent=suggested,
                    enabled=True,
                    priority=100,
                    notes="Plan-16-Residency-Default automatisch gesetzt.",
                )
            )
            applied += 1
            assignments.append({
                "bundle_id": bundle_id,
                "bundle_name": model.bundle.name,
                "slot": matched_slot,
                "role": matched_role,
                "residency_intent": suggested,
            })
        except Exception as exc:  # noqa: BLE001
            skipped += 1
            assignments.append({
                "bundle_id": bundle_id,
                "error": str(exc),
            })

    return ResidencyDefaultsResult(applied=applied, skipped=skipped, assignments=assignments)
