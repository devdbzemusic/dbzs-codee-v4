from fastapi import APIRouter, HTTPException

from app.context.models import ContextPack, ContextRequest, RepositoryIndexRequest
from app.context.orchestrator import ContextOrchestrator
from app.context.repository_index import RepositoryIndexService

router = APIRouter(prefix="/context", tags=["context"])
_service = ContextOrchestrator()
_index = RepositoryIndexService()


@router.post("/build", response_model=ContextPack, response_model_by_alias=True)
def build_context(request: ContextRequest) -> ContextPack:
    try:
        return _service.build(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/index")
def build_repository_index(request: RepositoryIndexRequest) -> dict:
    try:
        return _index.build(request.workspace_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
