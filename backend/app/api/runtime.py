import inspect
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.runtime.doctor import (
    RuntimeDoctorReport,
    RuntimeDryRunRequest,
    RuntimeDryRunResponse,
    RuntimeProbeRequest,
    RuntimeProbeResponse,
    build_dry_run,
    build_runtime_doctor,
    probe_runtime,
)
from app.runtime.chat_attachments import prepare_chat_attachments
from app.runtime.schemas import (
    PrepareChatAttachmentsRequest,
    PrepareChatAttachmentsResponse,
    HardwareFingerprint,
    LlamaRuntimeCapabilities,
    ResourcePlanPreviewRequest,
    RuntimeChatRequest,
    RuntimeChatResponse,
    RuntimeLogsResponse,
    RuntimeRamPressureStatus,
    RuntimeResidencyEntry,
    RuntimeResourcePlan,
    RuntimeSlotId,
    RuntimeSlotStatus,
    RuntimeStatus,
    RuntimeErrorContractModel,
    RuntimeWarmupResult,
    StartModelRequest,
    RuntimeToolRegistry,
    TokenizeRequest,
    TokenizeResponse,
    WarmupSlotRequest,
)
from app.runtime.service import RuntimeService
from app.runtime.errors import RuntimeProviderError
from app.runtime.gpu_detect import GpuInfo, detect_gpu
from app.runtime.benchmark import run_benchmark, BenchmarkResult
from app.runtime.model_test import run_model_test
from app.model_lab.models import RuntimeSlotHealthEvent, RuntimeSlotHealthEventCreate
from app.model_lab.repository import ModelLabRepository, get_shared_model_lab_repository
from app.models.discovery_mode import get_model_discovery_mode
from app.models.index_service import ModelIndexService
from app.settings.service import get_settings_service
import json


router = APIRouter(prefix="/runtime", tags=["runtime"])


def _build_model_index_service(discovery_mode: str) -> ModelIndexService:
    return ModelIndexService(
        discovery_mode=discovery_mode,
        model_lab_repository=get_shared_model_lab_repository,
        settings_service=get_settings_service(),
    )


_runtime_service_discovery_mode = get_model_discovery_mode()
_runtime_service = RuntimeService(
    model_index_service=_build_model_index_service(_runtime_service_discovery_mode)
)


def get_runtime_service() -> RuntimeService:
    global _runtime_service, _runtime_service_discovery_mode
    discovery_mode = get_model_discovery_mode()
    if discovery_mode != _runtime_service_discovery_mode:
        _runtime_service.stop_model()
        _runtime_service = RuntimeService(
            model_index_service=_build_model_index_service(discovery_mode)
        )
        _runtime_service_discovery_mode = discovery_mode
    return _runtime_service


def _runtime_error_detail(exc: RuntimeError) -> dict[str, object]:
    message = str(exc)
    lowered = message.lower()
    code = "runtime_internal_error"
    diagnostic_context: dict[str, object] = {"source": "runtime-api"}

    if isinstance(exc, RuntimeProviderError):
        payload = RuntimeErrorContractModel(
            code=exc.code,  # type: ignore[arg-type]
            message=message,
            recoverable=exc.recoverable,
            diagnosticContext={**diagnostic_context, **exc.diagnostic_context},
            recommendedAction=exc.recommended_action,
        )
        return payload.model_dump()
    recoverable = False
    recommended_action = "Diagnose prüfen und Runtime-Konfiguration kontrollieren."

    if "target_slot_unavailable" in lowered:
        code = "target_slot_unavailable"
        recoverable = True
        recommended_action = "Runtime-Slot starten oder kompatiblen Fallback verwenden."
    elif "model_not_ready" in lowered or "model not ready" in lowered:
        code = "model_not_ready"
        recoverable = True
        recommended_action = "Modellpfad, Runtime-Profil und Modellindex prüfen, danach Runtime erneut starten."
    elif "backend_unavailable" in lowered or "backend unavailable" in lowered:
        code = "backend_unavailable"
        recoverable = True
        recommended_action = "Backend neu starten und Health-Check prüfen."
    elif "request_cancelled" in lowered or "operation was aborted" in lowered:
        code = "request_cancelled"
        recoverable = True
        recommended_action = "Anfrage bei Bedarf erneut senden."
    elif "invalid_response" in lowered or "invalid response" in lowered:
        code = "invalid_response"
        recoverable = True
        recommended_action = "Provider-Antwort und Diagnoseprotokoll prüfen."
    elif "conversation roles must alternate" in lowered or "jinja exception" in lowered or "chat template" in lowered:
        code = "provider_template_error"
        recoverable = True
        recommended_action = "Chat-Nachrichten normalisieren und Anfrage erneut senden."
    elif "timed out" in lowered or "timeout" in lowered:
        code = "provider_timeout"
        recoverable = True
        recommended_action = "Kürzere Anfrage senden oder ein schnelleres Modell wählen."
    elif "warmup_timeout" in lowered:
        code = "warmup_timeout"
        recoverable = True
        recommended_action = "Warm-up erneut versuchen oder Safe Mode / Fallback nutzen."
    elif "warmup_http_failed" in lowered:
        code = "warmup_http_failed"
        recoverable = True
        recommended_action = "HTTP-Diagnostik und Runtime-Endpoint prüfen."
    elif "warmup_empty_response" in lowered:
        code = "warmup_empty_response"
        recoverable = True
        recommended_action = "Warm-up-Diagnose mit Rohantwort prüfen und Fallback erwägen."
    elif "binding_mismatch" in lowered:
        code = "binding_mismatch"
        recoverable = False
        recommended_action = "Routing- und Slot-Bindung korrigieren."
    elif "request failed" in lowered:
        code = "provider_request_failed"
        recoverable = True
        recommended_action = "Provider-/Endpoint-Fehler prüfen und Anfrage erneut senden."

    payload = RuntimeErrorContractModel(
        code=code,
        message=message,
        recoverable=recoverable,
        diagnosticContext=diagnostic_context,
        recommendedAction=recommended_action,
    )
    return payload.model_dump()


@router.get("/status")
def get_runtime_status(
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeStatus:
    return service.status()


@router.get("/system/ram-pressure")
def get_ram_pressure(
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeRamPressureStatus:
    percent_used, tier = service.get_ram_pressure()
    return RuntimeRamPressureStatus(percent_used=percent_used, tier=tier)


def _build_slot_status(service: RuntimeService, slot_id: str, status: RuntimeStatus) -> RuntimeSlotStatus:
    plan = service.get_resource_plan_for_slot(slot_id)
    residency = service.residency.entry_for_slot(slot_id)
    hardware_mode = status.hardware_mode or (plan.hardware_mode if plan else None)
    device_policy = "cpu" if hardware_mode == "cpu" else "gpu" if hardware_mode == "gpu" else "auto"
    # Prefer live residency (actual launch) over persisted last-good plan — plan can be
    # missing after restart/hash mismatch while the slot is still running with known n_ctx.
    resolved_context_size = (
        residency.context_size
        if residency is not None
        else plan.context_size
        if plan is not None
        else None
    )
    resolved_gpu_layers = (
        status.gpu_layers
        if status.gpu_layers is not None
        else residency.gpu_layers
        if residency is not None
        else plan.gpu_layers
        if plan is not None
        else None
    )
    return RuntimeSlotStatus(
        state=status.state,
        provider=status.provider,
        model_id=status.model_id,
        model_name=status.model_name,
        port=status.port,
        pid=status.pid,
        endpoint=status.endpoint,
        message=status.message,
        stderr_tail=status.stderr_tail,
        stdout_tail=status.stdout_tail,
        slot_id=slot_id,
        device_policy=device_policy,
        gpu_layers=resolved_gpu_layers,
        context_size=resolved_context_size,
        chat_ready=service.is_slot_chat_ready(slot_id),
        hardware_mode=hardware_mode,
        gpu_device=status.gpu_device,
        vram_total_bytes=status.vram_total_bytes if status.vram_total_bytes is not None else plan.available_vram_bytes if plan else None,
        vram_used_bytes=status.vram_used_bytes if status.vram_used_bytes is not None else plan.estimated_total_vram_bytes if plan else None,
        error_message=status.message if status.state == "error" else None,
        launch_fingerprint=residency.launch_fingerprint if residency else None,
        active_requests=residency.active_requests if residency else None,
        residency_state=residency.state if residency else None,
        reserved_output_tokens=(
            plan.reserved_output_tokens
            if plan is not None
            else round(resolved_context_size * 0.22)
            if resolved_context_size
            else None
        ),
        batch_size=residency.batch_size if residency is not None else plan.batch_size if plan else None,
        micro_batch_size=residency.micro_batch_size if residency is not None else plan.micro_batch_size if plan else None,
        cache_type_k=residency.cache_type_k if residency is not None else plan.cache_type_k if plan else None,
        cache_type_v=residency.cache_type_v if residency is not None else plan.cache_type_v if plan else None,
    )


@router.get("/slots")
def list_runtime_slots(
    service: RuntimeService = Depends(get_runtime_service),
) -> list[RuntimeSlotStatus]:
    return [
        _build_slot_status(service, slot_id, status)
        for slot_id, status in service._statuses.items()
    ]


# P2 Phase 5: Runtime tools endpoint
@router.get("/tools", response_model=RuntimeToolRegistry)
def get_runtime_tools(
    service: RuntimeService = Depends(get_runtime_service),
    refresh: bool = True,
) -> RuntimeToolRegistry:
    """Get available runtime tools (llama-server, llama-cli, etc.)."""
    if refresh:
        return service.tool_registry.refresh()
    return service.tool_registry.get_registry()



@router.get("/slots/{slot_id}/status")
def get_runtime_slot_status(
    slot_id: RuntimeSlotId,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeSlotStatus:
    status = service.status_for_slot(slot_id)
    return _build_slot_status(service, slot_id, status)


@router.get("/slots/{slot_id}/logs")
def get_runtime_slot_logs(
    slot_id: RuntimeSlotId,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeLogsResponse:
    return service.get_logs_for_slot(slot_id)


def _resolve_projector_config(
    service: RuntimeService, projector_artifact_id: str
) -> dict[str, object]:
    """Resolves a client-supplied `projector_artifact_id` (an MMProj support
    artifact's id in the current model index, from a MultimodalPair) to an
    absolute `mmproj_path` + its `mmproj_bytes` for VRAM budgeting (Plan 15,
    Phase 5). Never trusts a client-supplied filesystem path directly - only
    an id already present in the server's own model index resolves to a path.
    """
    index = service.model_index_service.load_cached_index() or service.model_index_service.build_index()
    projector = next(
        (artifact for artifact in index.support_artifacts if artifact.id == projector_artifact_id),
        None,
    )
    if projector is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"projector_artifact_id '{projector_artifact_id}' konnte keinem MMProj-Artefakt "
                "im Modellindex zugeordnet werden."
            ),
        )
    return {"mmproj_path": projector.path, "mmproj_bytes": projector.size_bytes}


@router.post("/slots/{slot_id}/start")
def start_runtime_slot(
    slot_id: RuntimeSlotId,
    request: StartModelRequest,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeStatus:
    config: dict[str, object] = {}
    if request.profile:
        config["profile"] = request.profile
    if request.projector_artifact_id:
        config.update(_resolve_projector_config(service, request.projector_artifact_id))
    return service.start_model(request.model_id, slot_id=slot_id, config=config or None)


@router.post("/slots/{slot_id}/stop")
def stop_runtime_slot(
    slot_id: RuntimeSlotId,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeStatus:
    return service.stop_model_for_slot(slot_id)


@router.post("/slots/{slot_id}/probe")
def probe_runtime_slot(
    slot_id: RuntimeSlotId,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeStatus:
    return service.status_for_slot(slot_id)


@router.get("/slots/{slot_id}/residency")
def get_runtime_slot_residency(
    slot_id: RuntimeSlotId,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeResidencyEntry | None:
    return service.residency.entry_for_slot(slot_id)


@router.post("/slots/{slot_id}/evict")
def evict_runtime_slot(
    slot_id: RuntimeSlotId,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeStatus:
    """Manual eviction — backs the "Runtime neu starten" UI button."""
    service.residency.mark_evicting(slot_id)
    return service.stop_model_for_slot(slot_id)


@router.get("/slots/{slot_id}/health-events")
def list_slot_health_events(
    slot_id: RuntimeSlotId,
    limit: int = 200,
    repository: ModelLabRepository = Depends(get_shared_model_lab_repository),
) -> list[RuntimeSlotHealthEvent]:
    """Persistent history of start/stop/crash/restart events for a slot (Plan 15, Phase 6) —
    survives an app restart, unlike runtimeProcessSupervisor's in-memory-only health state."""
    return repository.list_health_events(slot_id=slot_id, limit=min(max(limit, 1), 200))


@router.post("/slots/{slot_id}/health-events")
def record_slot_health_event(
    slot_id: RuntimeSlotId,
    request: RuntimeSlotHealthEventCreate,
    repository: ModelLabRepository = Depends(get_shared_model_lab_repository),
) -> RuntimeSlotHealthEvent:
    """Persists a health/failure event for a slot. The `slot_id` in the body
    is ignored in favour of the path parameter — callers may omit it or pass
    any value; the path always wins."""
    # Overwrite body slot_id with the authoritative path value so callers
    # don't need to duplicate it and a mismatch never silently stores a
    # phantom slot row.
    coerced = request.model_copy(update={"slot_id": slot_id})
    return repository.record_health_event(coerced)


@router.post("/slots/sweep-idle")
def sweep_idle_runtime_slots(
    service: RuntimeService = Depends(get_runtime_service),
) -> list[str]:
    """Stops slots whose residency policy is idle_evict and are past the idle timeout."""
    return service.sweep_idle_slots()


@router.post("/slots/{slot_id}/tokenize")
def tokenize_for_slot(
    slot_id: RuntimeSlotId,
    request: TokenizeRequest,
    service: RuntimeService = Depends(get_runtime_service),
) -> TokenizeResponse:
    try:
        return TokenizeResponse(token_count=service.tokenize(slot_id, request.text))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=_runtime_error_detail(exc)) from exc


@router.post("/slots/{slot_id}/warmup")
def warmup_runtime_slot(
    slot_id: RuntimeSlotId,
    request: WarmupSlotRequest,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeWarmupResult:
    """Proxy mini-inference warm-up through the backend (never from Electron renderer)."""
    return service.warmup_slot_inference(
        slot_id,
        model_id=request.model_id,
        decision_id=request.decision_id,
        timeout_ms=request.timeout_ms,
    )


@router.post("/start")
def start_runtime_model(
    request: StartModelRequest,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeStatus:
    start_kwargs = {"model_id": request.model_id}
    if request.slot_id is not None:
        start_kwargs["slot_id"] = request.slot_id
    if request.profile:
        start_kwargs["config"] = {"profile": request.profile}

    start_model = getattr(service, "start_model", None)
    if start_model is None:
        raise HTTPException(status_code=500, detail="Runtime service does not expose start_model")

    try:
        params = inspect.signature(start_model).parameters
        filtered_kwargs = {key: value for key, value in start_kwargs.items() if key in params}
        if filtered_kwargs:
            return start_model(**filtered_kwargs)
    except (TypeError, ValueError):
        pass

    return start_model(request.model_id)


@router.post("/stop")
def stop_runtime_model(
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeStatus:
    return service.stop_model()


@router.get("/providers")
def list_runtime_providers() -> list[str]:
    return ["llama.cpp", "ollama", "antigravity"]


@router.post("/prepare-chat-attachments", response_model=PrepareChatAttachmentsResponse)
def prepare_runtime_chat_attachments(
    request: PrepareChatAttachmentsRequest,
) -> PrepareChatAttachmentsResponse:
    try:
        return PrepareChatAttachmentsResponse(
            attachments=prepare_chat_attachments(request.attachments)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/chat")
def chat_with_runtime(
    request: RuntimeChatRequest,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeChatResponse:
    try:
        return service.chat(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=_runtime_error_detail(exc)) from exc


@router.post("/chat/stream")
def chat_with_runtime_stream(
    request: RuntimeChatRequest,
    service: RuntimeService = Depends(get_runtime_service),
) -> StreamingResponse:
    def event_generator():
        try:
            for chunk in service.chat_stream(request):
                payload = json.dumps({"type": "delta", "content": chunk})
                yield f"data: {payload}\n\n"

            target = service.resolve_chat_target(request)
            usage = service.get_last_chat_usage()
            done_payload = json.dumps(
                {
                    "type": "done",
                    "slot_id": target.slot_id,
                    "model_id": target.model_id,
                    "model_name": target.model_name,
                    "prompt_tokens": usage.get("prompt_tokens") if usage else None,
                    "completion_tokens": usage.get("completion_tokens") if usage else None,
                    "finish_reason": service.get_last_chat_finish_reason() or "eof",
                }
            )
            yield f"data: {done_payload}\n\n"
        except RuntimeError as exc:
            error_payload = json.dumps({"type": "error", "message": str(exc), "error": _runtime_error_detail(exc)})
            yield f"data: {error_payload}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/doctor", response_model=RuntimeDoctorReport)
def get_runtime_doctor() -> RuntimeDoctorReport:
    return build_runtime_doctor()


@router.post("/doctor/dry-run", response_model=RuntimeDryRunResponse)
def post_runtime_dry_run(request: RuntimeDryRunRequest) -> RuntimeDryRunResponse:
    try:
        return build_dry_run(request.model_id, request.profile_name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/doctor/probe", response_model=RuntimeProbeResponse)
def post_runtime_probe(
    request: RuntimeProbeRequest,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeProbeResponse:
    return probe_runtime(request, service=service)


@router.get("/logs", response_model=RuntimeLogsResponse)
def get_runtime_logs(
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeLogsResponse:
    return service.get_logs()


@router.post("/benchmark")
def post_benchmark() -> BenchmarkResult:
    import os
    port = int(os.getenv("DBZS_BACKEND_PORT", "8876"))
    return run_benchmark(f"http://127.0.0.1:{port}")


@router.post("/model-test")
def post_model_test(
    service: RuntimeService = Depends(get_runtime_service),
) -> dict:
    try:
        return run_model_test(service).to_dict()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=_runtime_error_detail(exc)) from exc


@router.get("/hardware/fingerprint")
def get_hardware_fingerprint(
    service: RuntimeService = Depends(get_runtime_service),
) -> HardwareFingerprint:
    return service.get_hardware_fingerprint()


@router.get("/capabilities")
def get_llama_capabilities(
    service: RuntimeService = Depends(get_runtime_service),
) -> LlamaRuntimeCapabilities:
    return service.get_llama_capabilities()


@router.post("/resource-plan/preview")
def preview_resource_plan(
    request: ResourcePlanPreviewRequest,
    service: RuntimeService = Depends(get_runtime_service),
) -> RuntimeResourcePlan:
    """Compute a resource plan without launching anything (UI "Neu vermessen")."""
    try:
        return service.preview_resource_plan(request.model_id, request.slot_id, request.profile)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/gpu")
def get_gpu_info() -> dict:
    gpu = detect_gpu()
    if gpu is None:
        return {"detected": False, "vendor": None, "name": None, "vram_mb": None, "recommended_gpu_layers": 0}
    return {
        "detected": True,
        "vendor": gpu.vendor,
        "name": gpu.name,
        "vram_mb": gpu.vram_mb,
        "recommended_gpu_layers": gpu.recommended_gpu_layers,
    }
