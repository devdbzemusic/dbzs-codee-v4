"""Tests for POST /rag/embeddings/generate (Plan 14, Phase 2)."""
from fastapi.testclient import TestClient

from app.main import app
from app.rag.embedding_service import EmbeddingService, get_embedding_service


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


def test_generate_embeddings_returns_model_id_and_vectors() -> None:
    fake = FakeEmbeddingService()
    app.dependency_overrides[get_embedding_service] = lambda: fake
    client = TestClient(app)

    response = client.post("/rag/embeddings/generate", json={"texts": ["hello", "world"]})

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["model_id"] == "bundle-1"
    assert payload["dimensions"] == 2
    assert payload["vectors"] == [[0.1, 0.2], [0.3, 0.4]]
    assert fake.last_texts == ["hello", "world"]


def test_generate_embeddings_returns_400_when_no_model_configured() -> None:
    fake = FakeEmbeddingService(error="Kein Standard-Embedding-Modell konfiguriert (Einstellungen > Modelle).")
    app.dependency_overrides[get_embedding_service] = lambda: fake
    client = TestClient(app)

    response = client.post("/rag/embeddings/generate", json={"texts": ["hello"]})

    app.dependency_overrides.clear()
    assert response.status_code == 400
    assert "Kein Standard-Embedding-Modell" in response.json()["detail"]


def test_generate_embeddings_rejects_empty_texts_list() -> None:
    app.dependency_overrides[get_embedding_service] = lambda: FakeEmbeddingService()
    client = TestClient(app)

    response = client.post("/rag/embeddings/generate", json={"texts": []})

    app.dependency_overrides.clear()
    assert response.status_code == 422


def test_real_embedding_service_reports_missing_configuration(tmp_path) -> None:
    from app.model_lab.repository import ModelLabRepository
    from app.settings.service import SettingsService

    service = EmbeddingService(
        model_lab_repository=ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3"),
        settings_service=SettingsService(settings_path=tmp_path / "settings.json"),
    )

    try:
        service.embed_texts(["hello"])
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "Kein Standard-Embedding-Modell" in str(exc)
