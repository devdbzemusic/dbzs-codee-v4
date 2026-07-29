from fastapi import APIRouter, Depends, HTTPException

from app.models.discovery_mode import get_model_discovery_mode
from app.models.index_service import ModelIndexService
from app.models.schemas import ManualMultimodalPairingRequest, ModelIndex, MultimodalPair

router = APIRouter(prefix="/models", tags=["models"])


def get_model_index_service() -> ModelIndexService:
    return ModelIndexService(discovery_mode=get_model_discovery_mode())


@router.get("/index")
def get_model_index(
    service: ModelIndexService = Depends(get_model_index_service),
) -> ModelIndex:
    return service.build_index()


@router.post("/multimodal-pairings/manual")
def save_manual_multimodal_pairing(
    request: ManualMultimodalPairingRequest,
    service: ModelIndexService = Depends(get_model_index_service),
) -> MultimodalPair:
    try:
        return service.save_manual_multimodal_pairing(
            base_model_id=request.base_model_id,
            projector_artifact_id=request.projector_artifact_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
