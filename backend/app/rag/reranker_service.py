"""
Resolves the user's configured default reranker model (Model Lab bundle) to
an `OnnxRerankerClient` and exposes a single `rerank_documents()` call for the
`/rerank` endpoint (Plan 14, Phase 2 continuation).
"""
from __future__ import annotations

from app.model_lab.repository import ModelLabRepository
from app.rag.onnx_reranker_client import OnnxRerankerClient, onnx_reranker_backend_available
from app.rag.onnx_shared import resolve_onnx_bundle_paths
from app.settings.service import SettingsService


class RerankerService:
    def __init__(
        self,
        *,
        model_lab_repository: ModelLabRepository | None = None,
        settings_service: SettingsService | None = None,
    ) -> None:
        self.model_lab_repository = model_lab_repository or ModelLabRepository()
        self.settings_service = settings_service or SettingsService()
        self._clients: dict[str, OnnxRerankerClient] = {}

    def rerank_documents(self, query: str, documents: list[str]) -> tuple[str, list[float]]:
        if not onnx_reranker_backend_available():
            raise ValueError("ONNX-Reranking-Unterstuetzung ist nicht installiert (onnxruntime/tokenizers fehlen).")

        bundle_id = self.settings_service.load().defaultRerankerModelId.strip()
        if not bundle_id:
            raise ValueError("Kein Standard-Reranking-Modell konfiguriert (Einstellungen > Modelle).")

        client = self._client_for_bundle(bundle_id)
        return bundle_id, client.rerank(query, documents)

    def _client_for_bundle(self, bundle_id: str) -> OnnxRerankerClient:
        cached = self._clients.get(bundle_id)
        if cached is not None:
            return cached

        model_path, tokenizer_path = resolve_onnx_bundle_paths(self.model_lab_repository, bundle_id)
        client = OnnxRerankerClient(model_path=model_path, tokenizer_path=tokenizer_path)
        self._clients[bundle_id] = client
        return client


_service: RerankerService | None = None


def get_reranker_service() -> RerankerService:
    global _service
    if _service is None:
        _service = RerankerService()
    return _service
