from fastapi import APIRouter, Depends, HTTPException

from app.model_lab.models import HardwareProfile, ModelLabModel, ModelSource, ModelSourceCreate, ScanJob, ScanRequest, ScanResult
from app.model_lab.service import ModelLabService

router = APIRouter(prefix="/model-lab", tags=["model-lab"])


def get_model_lab_service() -> ModelLabService:
    return ModelLabService()


@router.get("/sources")
def list_sources(service: ModelLabService = Depends(get_model_lab_service)) -> list[ModelSource]:
    return service.list_sources()


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
        return service.run_scan(source_id=request.source_id if request else None)
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


@router.get("/hardware")
def get_hardware(service: ModelLabService = Depends(get_model_lab_service)) -> HardwareProfile:
    return service.collect_hardware()

