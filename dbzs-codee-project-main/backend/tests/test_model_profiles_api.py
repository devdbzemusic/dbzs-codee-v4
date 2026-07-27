from pathlib import Path

from fastapi.testclient import TestClient

from app.api.model_profiles import get_profile_service
from app.main import app
from app.models.profile_service import ProfileService
from app.models.schemas import IndexedModel, ModelIndex, ModelIndexSummary, ModelRuntimeHints


class _FakeIndexService:
    def build_index(self) -> ModelIndex:
        return ModelIndex(
            generated_from="test",
            summary=ModelIndexSummary(
                models_dir="D:/Models",
                runtime_dir="D:/Models/llama.cpp-win-runtime",
                total=3,
                gguf_total=3,
                llama_server_ready=3,
                coding_candidates=2,
                vision_candidates=0,
                adapters=0,
                unsupported=0,
            ),
            models=[
                IndexedModel(
                    id="coding-a",
                    name="Coding-A",
                    path="D:/Models/coding-a.gguf",
                    format="gguf",
                    artifact_type="model",
                    size_bytes=4 * 1024**3,
                    size_gb=4.0,
                    quantization="Q4_K_M",
                    backend="llama.cpp",
                    runtime_launcher="llama-server",
                    capabilities=["chat", "code"],
                    modality=["text"],
                    role="CODE_MODEL",
                    recommended_use="primary_coding",
                    compatibility="llama_server_ready",
                    runtime=ModelRuntimeHints(ctx=8192, gpu_layers=36, server_enabled=True, preferred_port=8101),
                ),
                IndexedModel(
                    id="review-b",
                    name="Review-B",
                    path="D:/Models/review-b.gguf",
                    format="gguf",
                    artifact_type="model",
                    size_bytes=5 * 1024**3,
                    size_gb=5.0,
                    quantization="Q5_K_M",
                    backend="llama.cpp",
                    runtime_launcher="llama-server",
                    capabilities=["chat"],
                    modality=["text"],
                    role="REVIEW_MODEL",
                    recommended_use="review_agent",
                    compatibility="llama_server_ready",
                    runtime=ModelRuntimeHints(ctx=4096, gpu_layers=28, server_enabled=True, preferred_port=8102),
                ),
                IndexedModel(
                    id="rank-c",
                    name="Rank-C",
                    path="D:/Models/rank-c.gguf",
                    format="gguf",
                    artifact_type="model",
                    size_bytes=2 * 1024**3,
                    size_gb=2.0,
                    quantization="Q4_0",
                    backend="llama.cpp",
                    runtime_launcher="llama-server",
                    capabilities=["embedding"],
                    modality=["text"],
                    role=None,
                    recommended_use="reranker",
                    compatibility="llama_server_ready",
                    runtime=ModelRuntimeHints(ctx=2048, gpu_layers=20, server_enabled=True, preferred_port=8103),
                ),
            ],
        )


def test_generate_and_benchmark_profile_endpoint(tmp_path: Path) -> None:
    service = ProfileService(config_dir=tmp_path)
    service.model_index_service = _FakeIndexService()

    app.dependency_overrides[get_profile_service] = lambda: service
    client = TestClient(app)

    generate_response = client.post(
        "/model-profiles/generate",
        json={
            "profile_name": "auto-perf",
            "tasks": ["chat", "review", "coding", "translation", "reranker"],
            "hardware_class": "mid",
            "max_models": 4,
            "base_port": 8201,
            "gpu_memory_budget_mb": 8192,
            "vram_budget_mb": 16384,
            "cpu_threads": 8,
        },
    )

    benchmark_response = client.post(
        "/model-profiles/benchmark",
        json={"profile_name": "auto-perf"},
    )

    app.dependency_overrides.clear()

    assert generate_response.status_code == 200
    assert generate_response.json()["name"] == "auto-perf"
    assert generate_response.json()["models_count"] >= 1

    assert benchmark_response.status_code == 200
    payload = benchmark_response.json()
    assert payload["profile_name"] == "auto-perf"
    assert payload["score"] >= 0
