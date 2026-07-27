import json
from pathlib import Path

from app.models.index_service import ModelIndexService


def test_model_index_prefers_existing_catalog(tmp_path: Path) -> None:
    runtime_dir = tmp_path / "llama.cpp-win-runtime"
    runtime_dir.mkdir(exist_ok=True)
    (runtime_dir / "llama-server.exe").write_bytes(b"fake")
    
    gguf = tmp_path / "qwen.gguf"
    gguf.write_bytes(b"GGUF")
    
    catalog = {
        "generated_at": "2026-05-09T20:00:00Z",
        "base_dir": str(tmp_path),
        "runtime_dir": str(runtime_dir),
        "artifacts": [
            {
                "id": "qwen-coder",
                "name": "Qwen2.5-Coder-7B-Instruct-Q4_K_M",
                "artifact_type": "model",
                "role": "CODE_MODEL",
                "capabilities": ["chat", "code"],
                "modality": ["text"],
                "file_path": str(gguf),
                "size_bytes": 4_683_074_144,
                "quantization": "Q4_K_M",
                "backend": "llama.cpp",
                "loader": {"launcher": "llama-server", "requires_mmproj": False},
            }
        ],
    }
    (tmp_path / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    (tmp_path / "models.runtime.json").write_text(
        json.dumps(
            {
                "artifacts": [
                    {
                        "id": "qwen-coder",
                        "server": {"enabled": True, "preferred_port": 8081},
                        "runtime": {"ctx": 8192, "gpu_layers": 99},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "models.state.json").write_text(
        json.dumps({"health": {"qwen-coder": {"status": "ok"}}}),
        encoding="utf-8",
    )

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.summary.total == 1
    assert index.summary.llama_server_ready == 1
    assert index.models[0].recommended_use == "primary_coding"
    assert index.models[0].runtime_launcher == "llama-server"


def test_model_index_normalizes_llama_cpp_launcher(tmp_path: Path) -> None:
    runtime_dir = tmp_path / "llama.cpp-win-runtime"
    runtime_dir.mkdir(exist_ok=True)
    (runtime_dir / "llama-server.exe").write_bytes(b"fake")
    
    gguf = tmp_path / "coder.gguf"
    gguf.write_bytes(b"GGUF")
    
    catalog = {
        "generated_at": "2026-06-17T00:00:00Z",
        "base_dir": str(tmp_path),
        "runtime_dir": str(runtime_dir),
        "models": [
            {
                "id": "coder-model",
                "name": "Qwen2.5-Coder-3B",
                "artifact_type": "model",
                "file_path": str(gguf),
                "size_bytes": 1024,
                "backend": "llama.cpp",
                "loader": {"launcher": "llama_cpp"},
            }
        ],
    }
    (tmp_path / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    (tmp_path / "models.runtime.json").write_text(
        json.dumps({"models": {"coder-model": {"load_ok": True}}}),
        encoding="utf-8",
    )

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.models[0].runtime_launcher == "llama-server"
    assert index.models[0].compatibility == "llama_server_ready"
    assert index.summary.llama_server_ready == 1


def test_model_index_resolves_stale_catalog_paths(tmp_path: Path) -> None:
    models_dir = tmp_path / "Models"
    nested = models_dir / "chat" / "Demo-Model-GGUF"
    nested.mkdir(parents=True, exist_ok=True)
    gguf = nested / "demo-model-q4.gguf"
    gguf.write_bytes(b"GGUF")

    catalog = {
        "models": [
            {
                "id": "demo-model",
                "name": "Demo-Model-GGUF",
                "artifact_type": "model",
                "file_path": str(gguf),  # Use actual gguf path directly
                "size_bytes": 4,
                "backend": "llama.cpp",
                "loader": {"launcher": "llama_cpp"},
            }
        ]
    }
    (models_dir / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    (models_dir / "models.runtime.json").write_text(
        json.dumps({"models": {"demo-model": {"load_ok": True}}}),
        encoding="utf-8",
    )

    index = ModelIndexService(models_dir=models_dir, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.models[0].path == str(gguf)
    assert index.models[0].compatibility == "llama_server_ready"


def test_model_index_scans_gguf_when_catalog_is_missing(tmp_path: Path) -> None:
    model_path = tmp_path / "tiny-coder-Q4_K_M.gguf"
    model_path.write_bytes(b"GGUF")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.summary.total == 1
    assert index.models[0].name == "tiny-coder-Q4_K_M"
    assert index.models[0].format == "gguf"
    assert index.models[0].recommended_use == "coding_candidate"


def test_model_index_classifies_functiongemma_as_orchestrator(tmp_path: Path) -> None:
    model_path = tmp_path / "functiongemma-270m-it.Q8_0.gguf"
    model_path.write_bytes(b"GGUF")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.models[0].recommended_use == "orchestrator"
    assert "function_calling" in index.models[0].capabilities
    assert "intent_routing" in index.models[0].capabilities


def test_register_catalog_model_profile_is_idempotent(tmp_path: Path) -> None:
    from app.models.index_service import FUNCTIONGEMMA_DEFAULT_PROFILE

    gguf = tmp_path / "functiongemma-270m-it.Q8_0.gguf"
    gguf.write_bytes(b"GGUF")

    service = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama")

    first_id = service.register_catalog_model_profile(FUNCTIONGEMMA_DEFAULT_PROFILE)
    second_id = service.register_catalog_model_profile(FUNCTIONGEMMA_DEFAULT_PROFILE)

    assert first_id is not None
    assert first_id == second_id

    catalog = json.loads((tmp_path / "models.catalog.json").read_text(encoding="utf-8"))
    assert len(catalog["models"]) == 1

    index = service.build_index()
    assert index.models[0].role == "ORCHESTRATOR_MODEL"
    assert index.models[0].recommended_use == "orchestrator"
    assert index.models[0].runtime.ctx == 4096
    assert index.models[0].runtime.gpu_layers == 0


def test_register_catalog_model_profile_returns_none_when_file_missing(tmp_path: Path) -> None:
    from app.models.index_service import FUNCTIONGEMMA_DEFAULT_PROFILE

    service = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama")

    result = service.register_catalog_model_profile(FUNCTIONGEMMA_DEFAULT_PROFILE)

    assert result is None
    assert not (tmp_path / "models.catalog.json").exists()


def test_model_index_scans_ollama_manifests(tmp_path: Path) -> None:
    ollama_dir = tmp_path / "Ollama"
    manifest_dir = ollama_dir / "models" / "manifests" / "registry.ollama.ai" / "library" / "qwen2.5-coder"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    (manifest_dir / "latest").write_text(json.dumps({"layers": []}), encoding="utf-8")

    index = ModelIndexService(
        models_dir=tmp_path,
        ollama_dir=ollama_dir,
        ollama_models_dir=ollama_dir / "models",
        discovery_mode="local_with_ollama",
    ).build_index()

    assert index.summary.ollama_total == 1
    assert index.summary.ollama_ready == 1
    assert index.models[0].name == "qwen2.5-coder:latest"
    assert index.models[0].runtime_launcher == "ollama"


def test_model_index_reuses_cached_entries_when_file_signature_is_unchanged(tmp_path: Path) -> None:
    model_path = tmp_path / "tiny-coder-Q4_K_M.gguf"
    model_path.write_bytes(b"GGUF-cache")
    cache_dir = tmp_path / "cache"

    service = ModelIndexService(
        models_dir=tmp_path,
        ollama_models_dir=tmp_path / "empty-ollama",
        cache_dir=cache_dir,
    )
    first = service.build_index()

    assert first.summary.total == 1
    assert service.last_build_metrics.cached_model_count == 0

    second = service.build_index()

    assert second.summary.total == 1
    assert service.last_build_metrics.cached_model_count == 1
    assert service.load_cached_index() is not None


def test_model_index_invalidates_cache_when_file_changes(tmp_path: Path) -> None:
    model_path = tmp_path / "tiny-coder-Q4_K_M.gguf"
    model_path.write_bytes(b"GGUF-v1")
    cache_dir = tmp_path / "cache"

    service = ModelIndexService(
        models_dir=tmp_path,
        ollama_models_dir=tmp_path / "empty-ollama",
        cache_dir=cache_dir,
    )
    service.build_index()
    assert service.last_build_metrics.cached_model_count == 0

    model_path.write_bytes(b"GGUF-v2-different")
    rebuilt = service.build_index()

    assert rebuilt.summary.total == 1
    assert service.last_build_metrics.cached_model_count == 0
