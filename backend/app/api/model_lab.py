from fastapi import APIRouter, Depends, HTTPException

from app.model_lab.models import CollectionMembershipRequest, DuplicateGroup, HardwareProfile, HuggingFaceRepoInfo, HuggingFaceSearchResult, ModelBundle, ModelCollection, ModelCollectionCreate, ModelLabModel, ModelMetadataUpdate, ModelSource, ModelSourceCreate, ScanJob, ScanRequest, ScanResult
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

