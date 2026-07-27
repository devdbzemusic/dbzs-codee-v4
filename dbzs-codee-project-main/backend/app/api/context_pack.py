import logging

from fastapi import APIRouter, HTTPException, Query, Response

from app.api.runtime import get_runtime_service
from app.context_pack.context_cache import ModelContextCacheStore
from app.context_pack.models import (
    ContextCacheInvalidateRequest,
    ContextCacheInvalidateResponse,
    ContextCacheLookupRequest,
    ContextPackBuildRequest,
    ContextPackBuildResponse,
    ModelContextCacheEntry,
    PersistentContextSnapshot,
    PersistentContextSnapshotSummary,
)
from app.context_pack.service import ContextPackService

router = APIRouter(prefix="/context-pack", tags=["context-pack"])
logger = logging.getLogger(__name__)

_service = ContextPackService()
_cache_store = ModelContextCacheStore()


@router.post("/build", response_model=ContextPackBuildResponse)
def build_context_pack(request: ContextPackBuildRequest) -> ContextPackBuildResponse:
    try:
        runtime_service = get_runtime_service()

        def token_counter(text: str) -> int:
            if request.tokenizer_slot_id:
                try:
                    return runtime_service.tokenize(request.tokenizer_slot_id, text)
                except RuntimeError:
                    pass
            from app.rag.service import estimate_tokens
            return estimate_tokens(text)

        response = _service.build(request, tokenizer=token_counter)
        try:
            _cache_store.store_context_pack_snapshot(request, response)
        except Exception as exc:
            logger.warning("Context pack snapshot persistence failed: %s", exc)
        return response
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/cache/lookup", response_model=ModelContextCacheEntry)
def lookup_context_cache(request: ContextCacheLookupRequest) -> ModelContextCacheEntry:
    key = _cache_store.make_context_key(
        workspace_hash=request.workspace_hash, branch=request.branch, file_hash=request.file_hash,
        task_type=request.task_type, query_fingerprint=request.query_fingerprint,
        model_id=request.model_id, context_schema_version=request.context_schema_version,
    ) if request.workspace_hash else _cache_store.make_key(
        request.model_id,
        request.role,
        request.workspace_id,
        request.system_prompt_hash,
        request.tool_contract_hash,
        request.project_memory_hash,
        request.architecture_hash or "",
        request.agents_file_hash or "",
    )
    entry = _cache_store.get(key)
    if entry is None:
        raise HTTPException(status_code=404, detail="Context cache miss.")
    return entry


@router.post("/cache/store", status_code=204)
def store_context_cache(entry: ModelContextCacheEntry) -> Response:
    _cache_store.put(entry)
    return Response(status_code=204)


@router.post("/cache/invalidate", response_model=ContextCacheInvalidateResponse)
def invalidate_context_cache(request: ContextCacheInvalidateRequest) -> ContextCacheInvalidateResponse:
    invalidated = _cache_store.invalidate_by_hash_change(
        request.workspace_id, request.changed_hash_field, request.new_hash
    )
    return ContextCacheInvalidateResponse(invalidated=invalidated)


@router.post("/cache/clear", status_code=204)
def clear_context_cache() -> Response:
    _cache_store.clear()
    return Response(status_code=204)


@router.get("/cache/snapshots", response_model=list[PersistentContextSnapshotSummary])
def list_context_snapshots(
    workspace_id: str = Query(..., min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[PersistentContextSnapshotSummary]:
    return _cache_store.list_snapshots(workspace_id, limit=limit)


@router.get("/cache/snapshots/{snapshot_id}", response_model=PersistentContextSnapshot)
def get_context_snapshot(snapshot_id: str) -> PersistentContextSnapshot:
    snapshot = _cache_store.get_snapshot(snapshot_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Context snapshot not found.")
    return snapshot
