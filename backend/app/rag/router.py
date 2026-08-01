"""DBZS – FastAPI-Endpunkte für RAG-Index, Retrieval und sichere Traces."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.rag.embedding_service import EmbeddingService, get_embedding_service
from app.rag.models import (
    EmbeddingCacheProbeBody,
    EmbeddingGenerateBody,
    EmbeddingGenerateResult,
    EmbeddingUpsertBody,
    IndexSyncRequest,
    RetrievalQuery,
    TraceEventsBody,
)
from app.rag.service import get_rag_service
from app.rag.trace_service import TraceService

router = APIRouter(tags=["rag"])


@router.post("/rag/index/sync", status_code=202)
def sync_index(body: IndexSyncRequest):
    return get_rag_service().start_sync(body.workspace_root, body.changed_paths, body.force, body.reason)


@router.get("/rag/index/status")
def index_status(workspace_id: str = Query(..., min_length=1)):
    return get_rag_service().status(workspace_id)


@router.delete("/rag/index", status_code=204)
def clear_index(workspace_id: str = Query(..., min_length=1)):
    get_rag_service().clear_index(workspace_id)


@router.delete("/rag/embeddings", status_code=204)
def clear_embeddings(workspace_id: str = Query(..., min_length=1)):
    get_rag_service().clear_embeddings(workspace_id)


@router.post("/rag/embeddings")
def upsert_embeddings(body: EmbeddingUpsertBody):
    return {"stored": get_rag_service().upsert_embeddings(body.entries)}


@router.post("/rag/embeddings/missing")
def missing_embeddings(body: EmbeddingCacheProbeBody):
    return {"missing_source_ids": get_rag_service().missing_embeddings(body.embedding_model_id, body.entries)}


@router.post("/rag/embeddings/generate")
def generate_embeddings(
    body: EmbeddingGenerateBody,
    service: EmbeddingService = Depends(get_embedding_service),
) -> EmbeddingGenerateResult:
    try:
        model_id, vectors = service.embed_texts(body.texts)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    dimensions = len(vectors[0]) if vectors else 0
    return EmbeddingGenerateResult(model_id=model_id, dimensions=dimensions, vectors=vectors)


@router.post("/rag/retrieve")
def retrieve(body: RetrievalQuery):
    try:
        return get_rag_service().retrieve(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/traces/{run_id}/events")
def append_trace_events(run_id: str, body: TraceEventsBody):
    service = TraceService(get_rag_service())
    try:
        events = service.append(run_id, body.events)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"events": events, "summary": service.summary(run_id)}


@router.get("/traces/{run_id}")
def get_trace(run_id: str):
    return {"events": TraceService(get_rag_service()).list(run_id)}


@router.get("/traces/{run_id}/summary")
def get_trace_summary(run_id: str):
    return TraceService(get_rag_service()).summary(run_id)
