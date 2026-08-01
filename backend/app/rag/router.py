"""DBZS – FastAPI-Endpunkte für RAG-Index, Retrieval und sichere Traces."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.rag.embedding_service import EmbeddingService, get_embedding_service
from app.rag.models import (
    CohereRerankRequest,
    CohereRerankResponse,
    CohereRerankResult,
    EmbeddingCacheProbeBody,
    EmbeddingGenerateBody,
    EmbeddingGenerateResult,
    EmbeddingUpsertBody,
    IndexSyncRequest,
    OpenAiEmbeddingItem,
    OpenAiEmbeddingRequest,
    OpenAiEmbeddingResponse,
    OpenAiEmbeddingUsage,
    RetrievalQuery,
    TraceEventsBody,
)
from app.rag.reranker_service import RerankerService, get_reranker_service
from app.rag.service import RagService, estimate_tokens, get_rag_service
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


@router.post("/embeddings")
def create_embeddings(
    body: OpenAiEmbeddingRequest,
    service: EmbeddingService = Depends(get_embedding_service),
) -> OpenAiEmbeddingResponse:
    """OpenAI-compatible embedding endpoint. Used by the desktop chat's RAG
    flow (`embeddingService.ts`) - the `model` field is accepted but ignored,
    the settings-configured default embedding model is always used instead
    (see `EmbeddingService`).
    """
    try:
        model_id, vectors = service.embed_texts(body.input)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    total_tokens = sum(estimate_tokens(text) for text in body.input)
    return OpenAiEmbeddingResponse(
        data=[OpenAiEmbeddingItem(index=index, embedding=vector) for index, vector in enumerate(vectors)],
        model=model_id,
        usage=OpenAiEmbeddingUsage(prompt_tokens=total_tokens, total_tokens=total_tokens),
    )


@router.post("/rerank")
def rerank_documents(
    body: CohereRerankRequest,
    service: RerankerService = Depends(get_reranker_service),
) -> CohereRerankResponse:
    """Cohere-compatible rerank endpoint. Used by the desktop chat's RAG flow
    (`embeddingService.ts`) - the `model` field is accepted but ignored, the
    settings-configured default reranker model is always used instead (see
    `RerankerService`).
    """
    try:
        model_id, scores = service.rerank_documents(body.query, body.documents)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    ranked = sorted(range(len(scores)), key=lambda index: scores[index], reverse=True)
    top_n = body.top_n if body.top_n is not None else len(ranked)
    results = [CohereRerankResult(index=index, score=scores[index]) for index in ranked[:top_n]]
    return CohereRerankResponse(results=results, model=model_id)


@router.post("/rag/retrieve")
def retrieve(
    body: RetrievalQuery,
    rag_service: RagService = Depends(get_rag_service),
    embedding_service: EmbeddingService = Depends(get_embedding_service),
):
    try:
        query = _with_optional_query_embedding(body, embedding_service)
        return rag_service.retrieve(query)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _with_optional_query_embedding(body: RetrievalQuery, service: EmbeddingService) -> RetrievalQuery:
    if body.query_embedding or body.embedding_model_id:
        return body
    try:
        model_id, vectors = service.embed_texts([body.query])
    except ValueError:
        return body
    if not vectors:
        return body
    return body.model_copy(update={"query_embedding": vectors[0], "embedding_model_id": model_id})


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
