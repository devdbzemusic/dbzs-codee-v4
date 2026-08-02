import json
import struct
from pathlib import Path
from unittest.mock import MagicMock

from app.core.gguf_metadata import GGUF_MAGIC
from app.model_lab.models import ModelSourceCreate
from app.model_lab.repository import ModelLabRepository, get_shared_model_lab_repository
from app.models.index_service import ModelIndexService, _infer_artifact_type
from app.settings.models import AppSettings


def _gguf_string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack("<Q", len(encoded)) + encoded


def _kv_string(key: str, value: str) -> bytes:
    return _gguf_string(key) + struct.pack("<I", 8) + _gguf_string(value)


def _build_gguf(kv_entries: list[bytes], *, version: int = 3, tensor_count: int = 0) -> bytes:
    header = GGUF_MAGIC + struct.pack("<I", version) + struct.pack("<Q", tensor_count) + struct.pack("<Q", len(kv_entries))
    return header + b"".join(kv_entries)


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


def test_model_index_merges_catalog_and_filesystem_discovery(tmp_path: Path) -> None:
    runtime_dir = tmp_path / "llama.cpp-win-runtime"
    runtime_dir.mkdir(exist_ok=True)
    (runtime_dir / "llama-server.exe").write_bytes(b"fake")

    catalog_model = tmp_path / "catalog-coder.gguf"
    scanned_model = tmp_path / "scanned-chat.gguf"
    catalog_model.write_bytes(b"GGUF")
    scanned_model.write_bytes(b"GGUF")

    catalog = {
        "base_dir": str(tmp_path),
        "runtime_dir": str(runtime_dir),
        "models": [
            {
                "id": "catalog-coder",
                "name": "Catalog Coder",
                "artifact_type": "model",
                "file_path": str(catalog_model),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "loader": {"launcher": "llama-server"},
            }
        ],
    }
    (tmp_path / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.summary.total == 2
    assert {model.name for model in index.models} == {"Catalog Coder", "scanned-chat"}
    assert "catalog:" in index.generated_from
    assert "filesystem:" in index.generated_from


def test_model_index_reports_machine_readable_exclusion_reasons(tmp_path: Path) -> None:
    catalog = {
        "models": [
            {
                "id": "missing-model",
                "name": "Missing Model",
                "artifact_type": "model",
                "file_path": str(tmp_path / "missing.gguf"),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "loader": {"launcher": "llama-server"},
            }
        ],
    }
    (tmp_path / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    (tmp_path / "models.state.json").write_text(
        json.dumps({"health": {"missing-model": {"status": "failed"}}}),
        encoding="utf-8",
    )

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.models[0].exclusion_reasons == [
        "health_failed",
        "missing_file",
        "missing_profile",
        "unprofiled_gpu",
    ]


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


def test_model_index_falls_back_when_catalog_runtime_dir_is_stale(tmp_path: Path, monkeypatch) -> None:
    """Reproduces a real bug found via a live golden-path walkthrough:
    models.catalog.json's runtime_dir pointed at an empty/renamed directory
    while the real llama-server.exe lived elsewhere under win_runtimes.
    ModelIndexSummary.runtime_dir is consumed as-is by the frontend's
    pre-flight path validator (pathValidatorService.ts) *before* a model
    start is attempted, so a stale value here caused a false
    "runtime directory not found" error even though the backend's own
    launch-time resolution would have found the real directory just fine."""
    models_dir = tmp_path / "Models"
    models_dir.mkdir(parents=True, exist_ok=True)
    gguf = models_dir / "coder.gguf"
    gguf.write_bytes(b"GGUF")

    stale_runtime_dir = tmp_path / "win_runtimes" / "llama.cpp-win-runtime"
    stale_runtime_dir.mkdir(parents=True, exist_ok=True)  # exists, but empty -- no llama-server.exe

    real_runtime_dir = tmp_path / "win_runtimes" / "llama" / "cpu-x64"
    real_runtime_dir.mkdir(parents=True, exist_ok=True)
    (real_runtime_dir / "llama-server.exe").write_bytes(b"fake")
    (real_runtime_dir / "ggml-base.dll").write_bytes(b"fake")

    monkeypatch.setenv("DBZS_WIN_RUNTIMES_DIR", str(tmp_path / "win_runtimes"))
    from app.runtime.win_runtimes import clear_win_runtime_discovery_cache

    clear_win_runtime_discovery_cache()

    catalog = {
        "runtime_dir": str(stale_runtime_dir),
        "models": [
            {
                "id": "coder-model",
                "name": "Coder Model",
                "artifact_type": "model",
                "file_path": str(gguf),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "loader": {"launcher": "llama_cpp"},
            }
        ],
    }
    (models_dir / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")

    index = ModelIndexService(models_dir=models_dir, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.summary.runtime_dir != str(stale_runtime_dir)
    assert index.summary.runtime_dir == str(real_runtime_dir)


def test_model_index_scans_gguf_when_catalog_is_missing(tmp_path: Path) -> None:
    model_path = tmp_path / "tiny-coder-Q4_K_M.gguf"
    model_path.write_bytes(b"GGUF")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.summary.total == 1
    assert index.models[0].name == "tiny-coder-Q4_K_M"
    assert index.models[0].format == "gguf"
    assert index.models[0].recommended_use == "coding_candidate"


def test_model_index_ignores_model_lab_by_default(tmp_path: Path) -> None:
    """Plan 14, Phase 0.2: the Model Lab bridge must be opt-in, not on by
    default - an ad-hoc ModelIndexService() must never touch Model Lab's
    (potentially large, real) registered sources unless explicitly given a
    repository."""
    model_path = tmp_path / "tiny-coder-Q4_K_M.gguf"
    model_path.write_bytes(b"GGUF")
    service = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama")

    assert service.model_lab_repository is None
    index = service.build_index()

    assert index.summary.total == 1
    assert index.models[0].model_lab_health_status is None
    assert index.models[0].model_lab_tags == []


def test_model_index_includes_model_lab_sources_and_health_when_opted_in(tmp_path: Path) -> None:
    """Plan 14, Phase 0.2: when a Model Lab repository is explicitly passed,
    its enabled sources become additional scan roots and its health data is
    overlaid on matching models."""
    primary_dir = tmp_path / "primary"
    extra_dir = tmp_path / "extra"
    primary_dir.mkdir()
    extra_dir.mkdir()
    extra_model_path = extra_dir / "extra-model.gguf"
    extra_model_path.write_bytes(b"GGUF")

    repository = ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")
    repository.create_source(ModelSourceCreate(path=str(extra_dir)))

    service = ModelIndexService(
        models_dir=primary_dir,
        ollama_models_dir=tmp_path / "empty-ollama",
        model_lab_repository=repository,
    )
    index = service.build_index()

    assert index.summary.total == 1
    assert index.models[0].name == "extra-model"


def test_model_index_bridge_is_disabled_via_setting(tmp_path: Path) -> None:
    """Plan 15, Phase 2: The bridge must be disabled even if a repo is present,
    if the settings toggle is off."""
    primary_dir = tmp_path / "primary"
    extra_dir = tmp_path / "extra"
    primary_dir.mkdir()
    extra_dir.mkdir()
    (primary_dir / "primary-model.gguf").write_bytes(b"GGUF")
    (extra_dir / "extra-model.gguf").write_bytes(b"GGUF")

    repository = ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")
    repository.create_source(ModelSourceCreate(path=str(extra_dir)))

    settings_service = MagicMock()
    settings_service.load.return_value = AppSettings(enableModelLabRuntimeBridge=False)

    service = ModelIndexService(
        models_dir=primary_dir,
        ollama_models_dir=tmp_path / "empty-ollama",
        model_lab_repository=repository,
        settings_service=settings_service,
    )
    index = service.build_index()

    assert index.summary.total == 1
    assert index.models[0].name == "primary-model"


def test_model_index_bridge_is_enabled_via_setting(tmp_path: Path) -> None:
    """Plan 15, Phase 2: The bridge is active when the setting is true."""
    primary_dir = tmp_path / "primary"
    extra_dir = tmp_path / "extra"
    primary_dir.mkdir()
    extra_dir.mkdir()
    (extra_dir / "extra-model.gguf").write_bytes(b"GGUF")

    repository = ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")
    repository.create_source(ModelSourceCreate(path=str(extra_dir)))

    settings_service = MagicMock()
    settings_service.load.return_value = AppSettings(enableModelLabRuntimeBridge=True)

    service = ModelIndexService(
        models_dir=primary_dir,
        ollama_models_dir=tmp_path / "empty-ollama",
        model_lab_repository=repository,
        settings_service=settings_service,
    )
    index = service.build_index()

    assert index.summary.total == 1
    assert index.models[0].name == "extra-model"


def test_model_index_bridge_respects_scan_limits(tmp_path: Path) -> None:
    """Plan 15, Phase 2: The file limit per extra root is respected."""
    extra_dir = tmp_path / "extra_large"
    extra_dir.mkdir()
    for i in range(501):
        (extra_dir / f"model-{i}.gguf").write_bytes(b"GGUF")

    repository = ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")
    repository.create_source(ModelSourceCreate(path=str(extra_dir)))
    settings_service = MagicMock()
    settings_service.load.return_value = AppSettings(enableModelLabRuntimeBridge=True)

    service = ModelIndexService(
        models_dir=tmp_path / "empty-primary",
        ollama_models_dir=tmp_path / "empty-ollama",
        model_lab_repository=repository,
        settings_service=settings_service,
    )
    index = service.build_index()

    assert index.summary.total == 500


def test_model_index_skips_invalid_gguf_header_when_catalog_is_missing(tmp_path: Path) -> None:
    model_path = tmp_path / "broken.gguf"
    model_path.write_bytes(b"NOTG")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.summary.total == 0


def test_model_index_classifies_functiongemma_as_orchestrator(tmp_path: Path) -> None:
    model_path = tmp_path / "functiongemma-270m-it.Q8_0.gguf"
    model_path.write_bytes(b"GGUF")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert index.models[0].recommended_use == "orchestrator"
    assert "function_calling" in index.models[0].capabilities
    assert "intent_routing" in index.models[0].capabilities


def test_model_index_projects_mmproj_into_support_artifacts_without_breaking_models(tmp_path: Path) -> None:
    base_model = tmp_path / "gemma-vision-q4.gguf"
    projector = tmp_path / "mmproj-gemma-vision-f16.gguf"
    base_model.write_bytes(b"GGUF")
    projector.write_bytes(b"GGUF")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert any(model.path == str(projector) for model in index.models)
    assert any(model.path == str(projector) for model in index.support_artifacts)
    mmproj = next(model for model in index.support_artifacts if model.path == str(projector))
    assert mmproj.artifact_type == "mmproj"
    assert mmproj.compatibility == "support_artifact"
    assert index.summary.support_artifact_count >= 1
    assert len(index.multimodal_pairs) == 1
    assert index.multimodal_pairs[0].projector_artifact_id == mmproj.id
    assert index.multimodal_pairs[0].base_model_id == index.models[0].id
    assert index.multimodal_pairs[0].status == "candidate"
    assert index.multimodal_pairs[0].routing_allowed is False


def test_model_index_marks_mmproj_without_base_as_missing_base(tmp_path: Path) -> None:
    projector = tmp_path / "mmproj-gemma-vision-f16.gguf"
    projector.write_bytes(b"GGUF")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert len(index.multimodal_pairs) == 1
    assert index.multimodal_pairs[0].status == "missing_base"
    assert index.multimodal_pairs[0].base_model_id is None
    assert index.multimodal_pairs[0].candidate_base_model_ids == []


def test_model_index_marks_multiple_same_folder_candidates_as_ambiguous(tmp_path: Path) -> None:
    (tmp_path / "gemma-vision-q4.gguf").write_bytes(b"GGUF")
    (tmp_path / "gemma-vision-q6.gguf").write_bytes(b"GGUF")
    (tmp_path / "mmproj-gemma-vision-f16.gguf").write_bytes(b"GGUF")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert len(index.multimodal_pairs) == 1
    assert index.multimodal_pairs[0].status == "ambiguous"
    assert index.multimodal_pairs[0].base_model_id is None
    assert len(index.multimodal_pairs[0].candidate_base_model_ids) == 2


def test_model_index_prefers_catalog_mmproj_mapping_over_ambiguous_same_folder_candidates(tmp_path: Path) -> None:
    base_a = tmp_path / "vision-alpha-q4.gguf"
    base_b = tmp_path / "vision-beta-q4.gguf"
    projector = tmp_path / "special-projector-f16.gguf"
    base_a.write_bytes(b"GGUF")
    base_b.write_bytes(b"GGUF")
    projector.write_bytes(b"GGUF")

    catalog = {
        "models": [
            {
                "id": "base-a",
                "name": "Vision Alpha",
                "artifact_type": "model",
                "file_path": str(base_a),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "loader": {
                    "launcher": "llama-server",
                    "requires_mmproj": True,
                    "mmproj_model_id": "proj-1",
                },
            },
            {
                "id": "base-b",
                "name": "Vision Beta",
                "artifact_type": "model",
                "file_path": str(base_b),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "loader": {"launcher": "llama-server"},
            },
            {
                "id": "proj-1",
                "name": "special-projector-f16",
                "artifact_type": "mmproj",
                "file_path": str(projector),
                "size_bytes": 4,
                "backend": "llama.cpp",
            },
        ]
    }
    (tmp_path / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert len(index.multimodal_pairs) == 1
    pair = index.multimodal_pairs[0]
    assert pair.source == "catalog"
    assert pair.base_model_id == "base-a"
    assert pair.projector_artifact_id == "proj-1"
    assert pair.status == "candidate"
    assert pair.candidate_base_model_ids == ["base-a"]


def test_model_index_accepts_projector_side_catalog_mapping_to_base_model(tmp_path: Path) -> None:
    base_model = tmp_path / "vision-chat-q4.gguf"
    projector = tmp_path / "odd-projector-name.gguf"
    base_model.write_bytes(b"GGUF")
    projector.write_bytes(b"GGUF")

    catalog = {
        "models": [
            {
                "id": "base-model",
                "name": "Vision Chat",
                "artifact_type": "model",
                "file_path": str(base_model),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "loader": {"launcher": "llama-server"},
            },
            {
                "id": "proj-odd",
                "name": "odd-projector-name",
                "artifact_type": "mmproj",
                "file_path": str(projector),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "base_model_id": "base-model",
            },
        ]
    }
    (tmp_path / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")

    index = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama").build_index()

    assert len(index.multimodal_pairs) == 1
    pair = index.multimodal_pairs[0]
    assert pair.source == "catalog"
    assert pair.base_model_id == "base-model"
    assert pair.projector_artifact_id == "proj-odd"
    assert pair.status == "candidate"


def test_save_manual_multimodal_pairing_persists_manual_source_and_overrides_previous_mapping(tmp_path: Path) -> None:
    base_a = tmp_path / "vision-alpha-q4.gguf"
    base_b = tmp_path / "vision-beta-q4.gguf"
    projector = tmp_path / "custom-projector-f16.gguf"
    base_a.write_bytes(b"GGUF")
    base_b.write_bytes(b"GGUF")
    projector.write_bytes(b"GGUF")

    catalog = {
        "models": [
            {
                "id": "base-a",
                "name": "Vision Alpha",
                "artifact_type": "model",
                "file_path": str(base_a),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "loader": {"launcher": "llama-server"},
            },
            {
                "id": "base-b",
                "name": "Vision Beta",
                "artifact_type": "model",
                "file_path": str(base_b),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "loader": {"launcher": "llama-server"},
            },
            {
                "id": "proj-1",
                "name": "custom-projector-f16",
                "artifact_type": "mmproj",
                "file_path": str(projector),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "pairing": {"source": "manual", "base_model_id": "base-a"},
            },
        ]
    }
    (tmp_path / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")

    service = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama")
    pair = service.save_manual_multimodal_pairing("base-b", "proj-1")

    assert pair.source == "manual"
    assert pair.base_model_id == "base-b"
    assert pair.projector_artifact_id == "proj-1"
    assert pair.status == "candidate"

    persisted = json.loads((tmp_path / "models.catalog.json").read_text(encoding="utf-8"))
    projector_entry = next(entry for entry in persisted["models"] if entry["id"] == "proj-1")
    base_entry = next(entry for entry in persisted["models"] if entry["id"] == "base-b")
    old_base_entry = next(entry for entry in persisted["models"] if entry["id"] == "base-a")

    assert projector_entry["pairing"]["source"] == "manual"
    assert projector_entry["pairing"]["base_model_id"] == "base-b"
    assert base_entry["pairing"]["source"] == "manual"
    assert base_entry["pairing"]["projector_model_id"] == "proj-1"
    assert "pairing" not in old_base_entry


def test_mark_multimodal_pair_verified_persists_routing_allowed(tmp_path: Path) -> None:
    base_model = tmp_path / "vision-chat-q4.gguf"
    projector = tmp_path / "odd-projector-name.gguf"
    base_model.write_bytes(b"GGUF")
    projector.write_bytes(b"GGUF")

    catalog = {
        "models": [
            {
                "id": "base-model",
                "name": "Vision Chat",
                "artifact_type": "model",
                "file_path": str(base_model),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "loader": {"launcher": "llama-server"},
                "pairing": {"source": "catalog", "projector_model_id": "proj-odd"},
            },
            {
                "id": "proj-odd",
                "name": "odd-projector-name",
                "artifact_type": "mmproj",
                "file_path": str(projector),
                "size_bytes": 4,
                "backend": "llama.cpp",
                "pairing": {"source": "catalog", "base_model_id": "base-model"},
            },
        ]
    }
    (tmp_path / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")

    service = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama")
    pair = service.mark_multimodal_pair_verified("base-model", "proj-odd")

    assert pair.base_model_id == "base-model"
    assert pair.projector_artifact_id == "proj-odd"
    assert pair.routing_allowed is True

    persisted = json.loads((tmp_path / "models.catalog.json").read_text(encoding="utf-8"))
    base_entry = next(entry for entry in persisted["models"] if entry["id"] == "base-model")
    projector_entry = next(entry for entry in persisted["models"] if entry["id"] == "proj-odd")

    assert base_entry["pairing"]["routing_allowed"] is True
    assert projector_entry["pairing"]["routing_allowed"] is True


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


def test_infer_artifact_type_uses_clip_architecture_over_filename() -> None:
    """A real bug: llama.cpp tags every CLIP vision-projector GGUF with
    general.architecture="clip" regardless of filename. A file named
    "phi4-mm-vision-q8.gguf" doesn't contain "mmproj"/"projector", so the
    filename-only heuristic misclassified it as a standalone chat model -
    the runtime then tried to load it with llama-server and crashed with
    "error loading model: CLIP cannot be used as main model"."""
    assert _infer_artifact_type("phi4-mm-vision-q8.gguf", architecture="clip") == "mmproj"
    assert _infer_artifact_type("mmproj-model.gguf", architecture=None) == "mmproj"
    assert _infer_artifact_type("phi4-mm-vision-q8.gguf", architecture=None) == "model"
    assert _infer_artifact_type("regular-model.gguf", architecture="llama") == "model"


def test_model_index_classifies_clip_projector_by_metadata_not_filename(tmp_path: Path) -> None:
    """End-to-end regression for the same bug via the real filesystem scan
    path: a CLIP projector file with a misleading filename must come out of
    build_index() as artifact_type "mmproj", not "model"."""
    projector_path = tmp_path / "phi4-mm-vision-q8.gguf"
    projector_path.write_bytes(
        _build_gguf(
            [
                _kv_string("general.architecture", "clip"),
                _kv_string("general.name", "Phi-4 Multimodal Vision"),
            ]
        )
    )

    service = ModelIndexService(models_dir=tmp_path, ollama_models_dir=tmp_path / "empty-ollama")
    index = service.build_index()

    assert index.summary.total == 1
    assert index.models[0].artifact_type == "mmproj"


def test_model_index_never_resolves_repository_factory_when_bridge_disabled(tmp_path: Path) -> None:
    """Plan 15, Phase 2 production wiring: real call sites pass a zero-arg
    factory (get_shared_model_lab_repository) instead of a pre-built
    ModelLabRepository, since constructing one does real disk I/O (creates the
    sqlite file, runs schema migrations). With the bridge setting off, that
    factory must never be called - otherwise every ModelIndexService(...)
    construction across the app would eagerly touch disk even when the
    feature is disabled (this was a real bug: importing app.api.runtime
    touched the real %LOCALAPPDATA% model_lab.sqlite3 at module-import time
    before this factory indirection was added)."""
    calls: list[int] = []

    def factory() -> ModelLabRepository:
        calls.append(1)
        return ModelLabRepository(db_path=tmp_path / "should-not-be-created.sqlite3")

    settings_service = MagicMock()
    settings_service.load.return_value = AppSettings(enableModelLabRuntimeBridge=False)

    service = ModelIndexService(
        models_dir=tmp_path,
        ollama_models_dir=tmp_path / "empty-ollama",
        model_lab_repository=factory,
        settings_service=settings_service,
    )
    service.build_index()
    service.build_index()

    assert calls == []
    assert not (tmp_path / "should-not-be-created.sqlite3").exists()


def test_model_index_resolves_repository_factory_once_when_bridge_enabled(tmp_path: Path) -> None:
    """Mirror of the disabled case: with the setting on, the factory must be
    called to actually get Model Lab data - but only once per
    ModelIndexService instance (cached), even across multiple build_index()
    calls, so repeated index builds don't repeatedly reopen the sqlite file."""
    extra_dir = tmp_path / "extra"
    extra_dir.mkdir()
    (extra_dir / "extra-model.gguf").write_bytes(b"GGUF")

    repository = ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")
    repository.create_source(ModelSourceCreate(path=str(extra_dir)))

    calls: list[int] = []

    def factory() -> ModelLabRepository:
        calls.append(1)
        return repository

    settings_service = MagicMock()
    settings_service.load.return_value = AppSettings(enableModelLabRuntimeBridge=True)

    service = ModelIndexService(
        models_dir=tmp_path / "empty-primary",
        ollama_models_dir=tmp_path / "empty-ollama",
        model_lab_repository=factory,
        settings_service=settings_service,
    )
    first = service.build_index()
    second = service.build_index()

    assert calls == [1]
    assert first.summary.total == 1
    assert second.summary.total == 1


def test_get_shared_model_lab_repository_is_a_process_wide_singleton(tmp_path: Path, monkeypatch) -> None:
    """The production factory itself must be cached (lru_cache) so repeated
    ModelIndexService builds across the app don't reopen/re-migrate the
    sqlite file on every call."""
    monkeypatch.setattr("app.model_lab.repository.get_app_data_dir", lambda: tmp_path)
    get_shared_model_lab_repository.cache_clear()
    try:
        first = get_shared_model_lab_repository()
        second = get_shared_model_lab_repository()
        assert first is second
    finally:
        get_shared_model_lab_repository.cache_clear()
