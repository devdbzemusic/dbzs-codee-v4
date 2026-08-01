"""
Resolves the user's configured default embedding model (Model Lab bundle) to
an `OnnxEmbeddingClient` and exposes a single `embed_texts()` call for the RAG
embedding-generation endpoint (Plan 14, Phase 2).
"""
from __future__ import annotations

from pathlib import Path

from app.model_lab.repository import ModelLabRepository
from app.rag.onnx_embedding_client import OnnxEmbeddingClient, onnx_embedding_backend_available
from app.settings.service import SettingsService


class EmbeddingService:
    def __init__(
        self,
        *,
        model_lab_repository: ModelLabRepository | None = None,
        settings_service: SettingsService | None = None,
    ) -> None:
        self.model_lab_repository = model_lab_repository or ModelLabRepository()
        self.settings_service = settings_service or SettingsService()
        self._clients: dict[str, OnnxEmbeddingClient] = {}

    def embed_texts(self, texts: list[str]) -> tuple[str, list[list[float]]]:
        if not onnx_embedding_backend_available():
            raise ValueError("ONNX-Embedding-Unterstuetzung ist nicht installiert (onnxruntime/tokenizers fehlen).")

        bundle_id = self.settings_service.load().defaultEmbeddingModelId.strip()
        if not bundle_id:
            raise ValueError("Kein Standard-Embedding-Modell konfiguriert (Einstellungen > Modelle).")

        client = self._client_for_bundle(bundle_id)
        return bundle_id, client.embed(texts)

    def _client_for_bundle(self, bundle_id: str) -> OnnxEmbeddingClient:
        cached = self._clients.get(bundle_id)
        if cached is not None:
            return cached

        model = self.model_lab_repository.get_model(bundle_id)
        if model is None:
            raise ValueError(f"Embedding-Modell nicht gefunden in Model Lab: {bundle_id}")

        model_artifact = next(
            (artifact for artifact in model.artifacts if artifact.artifact_type == "model" and artifact.format == "onnx"),
            None,
        )
        if model_artifact is None:
            raise ValueError(f"Bundle {bundle_id} enthaelt kein .onnx-Modellartefakt.")

        tokenizer_artifact = next(
            (artifact for artifact in model.artifacts if artifact.artifact_type == "tokenizer"),
            None,
        )
        if tokenizer_artifact is None:
            raise ValueError(f"Bundle {bundle_id} enthaelt keinen Tokenizer (tokenizer.json im selben Ordner erwartet).")

        client = OnnxEmbeddingClient(model_path=Path(model_artifact.path), tokenizer_path=Path(tokenizer_artifact.path))
        self._clients[bundle_id] = client
        return client


_service: EmbeddingService | None = None


def get_embedding_service() -> EmbeddingService:
    global _service
    if _service is None:
        _service = EmbeddingService()
    return _service
