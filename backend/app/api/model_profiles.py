"""
Model Profiles API: REST endpoints for profile management and multi-model orchestration.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.model_lab.repository import ModelLabRepository, get_shared_model_lab_repository
from app.models.profile_service import ProfileService
from app.models.model_lab_bridge import resolve_bundle_to_model_id
from app.runtime.multi_server_manager import MultiServerManager
from app.models.profiles import HardwareClass, TaskType
from app.api.models import get_model_index_service
from app.api.runtime import get_runtime_service
from app.context.certification import CertificationStore, ModelCertificationRunner
from app.models.index_service import ModelIndexService
from app.runtime.service import RuntimeService
from app.settings.service import get_settings_service

router = APIRouter(prefix="/model-profiles", tags=["model-profiles"])

# Global instances (will be injected properly in main.py)
_profile_service: ProfileService | None = None
_multi_server_manager: MultiServerManager | None = None


def set_services(profile_service: ProfileService, multi_server_manager: MultiServerManager) -> None:
    """Initialize services. Called from main.py."""
    global _profile_service, _multi_server_manager
    _profile_service = profile_service
    _multi_server_manager = multi_server_manager


def get_profile_service() -> ProfileService:
    if not _profile_service:
        raise HTTPException(status_code=503, detail="Profile service not initialized")
    return _profile_service


def get_multi_server_manager() -> MultiServerManager:
    if not _multi_server_manager:
        raise HTTPException(status_code=503, detail="Multi-server manager not initialized")
    return _multi_server_manager


# ============================================================================
# Data Models
# ============================================================================

class ProfileListResponse(BaseModel):
    profiles: list[str]
    active_profile: str | None


class ProfileDetailResponse(BaseModel):
    name: str
    description: str
    hardware_class: str
    models_count: int
    max_total_gpu_memory_mb: int
    max_total_vram_usage_mb: int


class StartProfileRequest(BaseModel):
    profile_name: str


class StartProfileResponse(BaseModel):
    profile_name: str
    models_started: dict[str, dict]


class TaskRouteRequest(BaseModel):
    task_type: TaskType


class TaskRouteResponse(BaseModel):
    task_type: str
    recommended_model_id: str | None
    available_models: list[str]


class ProfileHealthResponse(BaseModel):
    profile: str | None
    models: dict
    resource_estimates: dict


class GenerateProfileRequest(BaseModel):
    profile_name: str
    tasks: list[TaskType]
    hardware_class: HardwareClass = "mid"
    max_models: int = 5
    base_port: int = 8101
    gpu_memory_budget_mb: int | None = None
    vram_budget_mb: int | None = None
    cpu_threads: int | None = None


class BenchmarkProfileRequest(BaseModel):
    profile_name: str


class BenchmarkProfileResponse(BaseModel):
    profile_name: str
    score: float
    is_safe: bool
    gpu_ratio: float
    vram_ratio: float
    thread_ratio: float
    total_gpu_memory_mb: float
    total_vram_usage_mb: int
    total_cpu_threads: int


class CertificationRunRequest(BaseModel):
    model_id: str | None = None
    bundle_id: str | None = None
    slot_id: str = "fast_gpu"
    hardware: str
    model_version: str = "unknown"


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/list", response_model=ProfileListResponse)
def list_profiles(service: ProfileService = Depends(get_profile_service)) -> ProfileListResponse:
    """List all available model profiles."""
    return ProfileListResponse(
        profiles=service.list_profiles(),
        active_profile=service.active_profile.name if service.active_profile else None,
    )


@router.get("/health", response_model=ProfileHealthResponse)
async def get_profile_health(
    manager: MultiServerManager = Depends(get_multi_server_manager),
) -> ProfileHealthResponse:
    """Get health status of all models in the active profile."""
    return await manager.get_profile_health_summary()


@router.get("/active-models")
def get_active_models(
    manager: MultiServerManager = Depends(get_multi_server_manager),
) -> dict:
    """Get all currently active models."""
    active = manager.get_all_active_models()
    return {
        "count": len(active),
        "models": {
            model_id: {
                "state": status.state,
                "port": status.port,
                "endpoint": status.endpoint,
            }
            for model_id, status in active.items()
        },
    }


@router.get("/{profile_name}", response_model=ProfileDetailResponse)
def get_profile_detail(
    profile_name: str,
    service: ProfileService = Depends(get_profile_service),
) -> ProfileDetailResponse:
    """Get details of a specific profile."""
    profile = service.get_profile(profile_name)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{profile_name}' not found")

    return ProfileDetailResponse(
        name=profile.name,
        description=profile.description,
        hardware_class=profile.hardware_class,
        models_count=len(profile.models),
        max_total_gpu_memory_mb=profile.max_total_gpu_memory_mb,
        max_total_vram_usage_mb=profile.max_total_vram_usage_mb,
    )


@router.post("/activate/{profile_name}")
def activate_profile(
    profile_name: str,
    service: ProfileService = Depends(get_profile_service),
) -> dict:
    """Activate a profile by name."""
    if not service.set_active_profile(profile_name):
        raise HTTPException(status_code=404, detail=f"Profile '{profile_name}' not found")

    profile = service.active_profile
    is_valid, error_msg = service.validate_profile_resources(profile)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Profile validation failed: {error_msg}")

    return {
        "active_profile": profile.name,
        "models": [m.model_id for m in profile.models],
        "validation": "passed",
    }


@router.post("/start", response_model=StartProfileResponse)
async def start_profile(
    request: StartProfileRequest,
    service: ProfileService = Depends(get_profile_service),
    manager: MultiServerManager = Depends(get_multi_server_manager),
) -> StartProfileResponse:
    """Start all models in a profile simultaneously."""
    profile = service.get_profile(request.profile_name)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{request.profile_name}' not found")

    # Validate resource constraints
    is_valid, error_msg = service.validate_profile_resources(profile)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Resource validation failed: {error_msg}")

    # Activate the profile
    service.set_active_profile(request.profile_name)

    # Start all models
    started = await manager.start_profile(profile)

    return StartProfileResponse(
        profile_name=profile.name,
        models_started={
            model_id: {
                "state": status.state,
                "port": status.port,
                "endpoint": status.endpoint,
                "message": status.message,
            }
            for model_id, status in started.items()
        },
    )


@router.post("/stop")
async def stop_profile(
    manager: MultiServerManager = Depends(get_multi_server_manager),
) -> dict:
    """Stop all models in the active profile."""
    await manager.stop_profile()
    return {"message": "All models stopped"}


@router.post("/route-task", response_model=TaskRouteResponse)
def route_task(
    request: TaskRouteRequest,
    manager: MultiServerManager = Depends(get_multi_server_manager),
    service: ProfileService = Depends(get_profile_service),
) -> TaskRouteResponse:
    """Route a task to the best available model."""
    recommended_model = manager.get_model_for_task(request.task_type)
    available_models = list(manager.get_all_active_models().keys())

    return TaskRouteResponse(
        task_type=request.task_type,
        recommended_model_id=recommended_model,
        available_models=available_models,
    )


@router.post("/generate", response_model=ProfileDetailResponse)
def generate_profile(
    request: GenerateProfileRequest,
    service: ProfileService = Depends(get_profile_service),
) -> ProfileDetailResponse:
    """Generate and persist a hardware-aware multi-model profile from local model index."""
    try:
        profile = service.generate_profile_for_hardware(
            profile_name=request.profile_name,
            tasks=request.tasks,
            hardware_class=request.hardware_class,
            max_models=request.max_models,
            base_port=request.base_port,
            gpu_memory_budget_mb=request.gpu_memory_budget_mb,
            vram_budget_mb=request.vram_budget_mb,
            cpu_threads=request.cpu_threads,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ProfileDetailResponse(
        name=profile.name,
        description=profile.description,
        hardware_class=profile.hardware_class,
        models_count=len(profile.models),
        max_total_gpu_memory_mb=profile.max_total_gpu_memory_mb,
        max_total_vram_usage_mb=profile.max_total_vram_usage_mb,
    )


@router.post("/benchmark", response_model=BenchmarkProfileResponse)
def benchmark_profile(
    request: BenchmarkProfileRequest,
    service: ProfileService = Depends(get_profile_service),
) -> BenchmarkProfileResponse:
    """Benchmark profile fit against configured hardware budgets (lightweight preflight)."""
    profile = service.get_profile(request.profile_name)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{request.profile_name}' not found")

    result = service.benchmark_profile(profile)
    return BenchmarkProfileResponse(
        profile_name=request.profile_name,
        score=float(result["score"]),
        is_safe=bool(result["is_safe"]),
        gpu_ratio=float(result["gpu_ratio"]),
        vram_ratio=float(result["vram_ratio"]),
        thread_ratio=float(result["thread_ratio"]),
        total_gpu_memory_mb=float(result["total_gpu_memory_mb"]),
        total_vram_usage_mb=int(result["total_vram_usage_mb"]),
        total_cpu_threads=int(result["total_cpu_threads"]),
    )


@router.post("/certification/runs")
def run_certification(
    request: CertificationRunRequest,
    runtime: RuntimeService = Depends(get_runtime_service),
    index_service: ModelIndexService = Depends(get_model_index_service),
    repository: ModelLabRepository = Depends(get_shared_model_lab_repository),
) -> dict:
    if request.slot_id not in {"quality_cpu", "fast_gpu", "utility"}:
        raise HTTPException(status_code=422, detail="invalid slot_id")

    model_id = request.model_id
    if request.bundle_id:
        if not get_settings_service().load().enableModelLabRuntimeBridge:
            raise HTTPException(
                status_code=400,
                detail="Model Lab Runtime-Bridge ist deaktiviert - bundle_id kann nicht aufgeloest werden.",
            )
        model_index = index_service.load_cached_index() or index_service.build_index()
        model_id = resolve_bundle_to_model_id(
            request.bundle_id,
            model_lab_repo=repository,
            model_index=model_index,
        )
        if model_id is None:
            raise HTTPException(
                status_code=400,
                detail=f"bundle_id '{request.bundle_id}' konnte keinem Runtime-Modell im Index zugeordnet werden.",
            )
    if not model_id:
        raise HTTPException(status_code=422, detail="model_id oder bundle_id erforderlich")

    report = ModelCertificationRunner(runtime.chat, CertificationStore()).run(
        model_id=model_id, slot_id=request.slot_id, hardware=request.hardware,
        model_version=request.model_version, bundle_id=request.bundle_id,
    )
    if request.bundle_id:
        repository.update_role_assignment_cache(
            request.bundle_id,
            certification_run_id=report.run_id,
            certification_score=report.score,
        )
    return report.model_dump()


@router.get("/certification/runs/{run_id}")
def get_certification(run_id: str) -> dict:
    report = CertificationStore().get(run_id)
    if report is None:
        raise HTTPException(status_code=404, detail="certification run not found")
    return report.model_dump()


@router.get("/certification/models/{model_id}/latest")
def latest_certification(model_id: str) -> dict:
    report = CertificationStore().latest(model_id)
    if report is None:
        raise HTTPException(status_code=404, detail="certification run not found")
    return report.model_dump()
