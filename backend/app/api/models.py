from fastapi import APIRouter, Depends

from app.models.discovery_mode import get_model_discovery_mode
from app.models.index_service import ModelIndexService
from app.models.schemas import ModelIndex

router = APIRouter(prefix="/models", tags=["models"])


def get_model_index_service() -> ModelIndexService:
    return ModelIndexService(discovery_mode=get_model_discovery_mode())


@router.get("/index")
def get_model_index(
    service: ModelIndexService = Depends(get_model_index_service),
) -> ModelIndex:
    return service.build_index()
