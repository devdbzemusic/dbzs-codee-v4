"""Tests for the OpenAI-compatible POST /embeddings and Cohere-compatible
POST /rerank endpoints (Plan 14, Phase 2 continuation).

These fix a real production bug: `apps/desktop/src/services/embeddingService.ts`
has always called these two endpoints from the live RAG chat flow, but neither
existed on the backend. Both endpoints ignore the client-supplied `model`
field and always use the settings-configured default (see `EmbeddingService`/
`RerankerService`) - so the fakes below intentionally don't inspect `model_id`
on the request path.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.rag.embedding_service import get_embedding_service
from app.rag.reranker_service import get_reranker_service


class FakeEmbeddingService:
    def __init__(self, *, model_id: str = "bundle-1", vectors: list[list[float]] | None = None, error: str | None = None) -> None:
        self.model_id = model_id
        self.vectors = vectors if vectors is not None else [[0.1, 0.2], [0.3, 0.4]]
        self.error = error
        self.last_texts: list[str] | None = None

    def embed_texts(self, texts: list[str]) -> tuple[str, list[list[float]]]:
        self.last_texts = texts
        if self.error:
            raise ValueError(self.error)
        return self.model_id, self.vectors


class FakeRerankerService:
    def __init__(self, *, model_id: str = "bundle-2", scores: list[float] | None = None, error: str | None = None) -> None:
        self.model_id = model_id
        self.scores = scores if scores is not None else [0.2, 0.9, 0.5]
        self.error = error
        self.last_query: str | None = None
        self.last_documents: list[str] | None = None

    def rerank_documents(self, query: str, documents: list[str]) -> tuple[str, list[float]]:
        self.last_query = query
        self.last_documents = documents
        if self.error:
            raise ValueError(self.error)
        return self.model_id, self.scores


def test_create_embeddings_returns_openai_shaped_response() -> None:
    fake = FakeEmbeddingService()
    app.dependency_overrides[get_embedding_service] = lambda: fake
    client = TestClient(app)

    response = client.post("/embeddings", json={"model": "irrelevant", "input": ["hello", "world"]})

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["model"] == "bundle-1"
    assert [item["embedding"] for item in payload["data"]] == [[0.1, 0.2], [0.3, 0.4]]
    assert [item["index"] for item in payload["data"]] == [0, 1]
    assert payload["usage"]["total_tokens"] > 0
    assert fake.last_texts == ["hello", "world"]


def test_create_embeddings_returns_400_when_no_model_configured() -> None:
    fake = FakeEmbeddingService(error="Kein Standard-Embedding-Modell konfiguriert (Einstellungen > Modelle).")
    app.dependency_overrides[get_embedding_service] = lambda: fake
    client = TestClient(app)

    response = client.post("/embeddings", json={"model": "irrelevant", "input": ["hello"]})

    app.dependency_overrides.clear()
    assert response.status_code == 400
    assert "Kein Standard-Embedding-Modell" in response.json()["detail"]


def test_create_embeddings_rejects_empty_input_list() -> None:
    app.dependency_overrides[get_embedding_service] = lambda: FakeEmbeddingService()
    client = TestClient(app)

    response = client.post("/embeddings", json={"model": "irrelevant", "input": []})

    app.dependency_overrides.clear()
    assert response.status_code == 422


def test_rerank_returns_cohere_shaped_response_sorted_by_score_descending() -> None:
    fake = FakeRerankerService(scores=[0.2, 0.9, 0.5])
    app.dependency_overrides[get_reranker_service] = lambda: fake
    client = TestClient(app)

    response = client.post(
        "/rerank",
        json={"model": "irrelevant", "query": "q", "documents": ["a", "b", "c"]},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["model"] == "bundle-2"
    assert [result["index"] for result in payload["results"]] == [1, 2, 0]
    assert [result["score"] for result in payload["results"]] == [0.9, 0.5, 0.2]
    assert fake.last_query == "q"
    assert fake.last_documents == ["a", "b", "c"]


def test_rerank_caps_results_at_top_n() -> None:
    fake = FakeRerankerService(scores=[0.2, 0.9, 0.5])
    app.dependency_overrides[get_reranker_service] = lambda: fake
    client = TestClient(app)

    response = client.post(
        "/rerank",
        json={"model": "irrelevant", "query": "q", "documents": ["a", "b", "c"], "top_n": 2},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert [result["index"] for result in payload["results"]] == [1, 2]


def test_rerank_returns_400_when_no_model_configured() -> None:
    fake = FakeRerankerService(error="Kein Standard-Reranking-Modell konfiguriert (Einstellungen > Modelle).")
    app.dependency_overrides[get_reranker_service] = lambda: fake
    client = TestClient(app)

    response = client.post("/rerank", json={"model": "irrelevant", "query": "q", "documents": ["a"]})

    app.dependency_overrides.clear()
    assert response.status_code == 400
    assert "Kein Standard-Reranking-Modell" in response.json()["detail"]


def test_rerank_rejects_empty_documents_list() -> None:
    app.dependency_overrides[get_reranker_service] = lambda: FakeRerankerService()
    client = TestClient(app)

    response = client.post("/rerank", json={"model": "irrelevant", "query": "q", "documents": []})

    app.dependency_overrides.clear()
    assert response.status_code == 422
