"""Tests for the index_service <-> Model Lab bridge (Plan 14, Phase 0.2)."""
from datetime import UTC, datetime
from pathlib import Path

from app.model_lab.models import ModelHealth, ModelMetadataUpdate, ModelSourceCreate
from app.model_lab.repository import ModelLabRepository
from app.models.model_lab_bridge import (
    additional_scan_roots,
    enrich_with_model_lab_health,
    resolve_bundle_to_model_id,
)
from app.models.schemas import IndexedModel, ModelIndex, ModelIndexSummary, ModelRuntimeHints
from tests.test_model_lab_repository import _artifact, _bundle


def _repo(tmp_path: Path) -> ModelLabRepository:
    return ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")


def _indexed_model(*, model_id: str, path: str) -> IndexedModel:
    return IndexedModel(
        id=model_id,
        name=Path(path).stem,
        path=path,
        format="gguf",
        artifact_type="model",
        size_bytes=1024,
        size_gb=0.001,
        quantization="Q4_K_M",
        backend="llama.cpp",
        runtime_launcher="llama-server",
        capabilities=["chat"],
        modality=["text"],
        role=None,
        recommended_use="chat_candidate",
        compatibility="llama_server_ready",
        runtime=ModelRuntimeHints(),
    )


def _empty_summary() -> ModelIndexSummary:
    return ModelIndexSummary(
        models_dir="/models",
        runtime_dir=None,
        ollama_dir=None,
        ollama_models_dir=None,
        total=0,
        gguf_total=0,
        ollama_total=0,
        llama_server_ready=0,
        ollama_ready=0,
        coding_candidates=0,
        vision_candidates=0,
        adapters=0,
        support_artifact_count=0,
        unsupported=0,
    )


def test_additional_scan_roots_excludes_primary_dir_and_disabled_sources(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    primary = tmp_path / "primary"
    extra = tmp_path / "extra"
    disabled = tmp_path / "disabled"
    for path in (primary, extra, disabled):
        path.mkdir()
    repo.create_source(ModelSourceCreate(path=str(primary)))
    repo.create_source(ModelSourceCreate(path=str(extra)))
    repo.create_source(ModelSourceCreate(path=str(disabled), enabled=False))

    roots = additional_scan_roots(exclude=primary, repository=repo)

    assert roots == [extra.resolve()]


def test_additional_scan_roots_returns_empty_list_on_repository_failure(tmp_path: Path) -> None:
    class BrokenRepository:
        def list_sources(self):
            raise RuntimeError("db unavailable")

    roots = additional_scan_roots(exclude=tmp_path, repository=BrokenRepository())  # type: ignore[arg-type]

    assert roots == []


def test_enrich_with_model_lab_health_overlays_matching_model_by_path(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    source = repo.create_source(ModelSourceCreate(path=str(tmp_path)))
    model_path = tmp_path / "model.gguf"
    model_path.write_bytes(b"fake-gguf")
    artifact = _artifact(source_id=source.id, artifact_id="a1", bundle_id="b1")
    artifact = artifact.model_copy(update={"path": str(model_path)})
    bundle = _bundle(source_id=source.id, artifact_id="a1", status="INCOMPLETE")
    bundle = bundle.model_copy(update={"health": ModelHealth(status="incomplete")})
    repo.save_scan_output(source=source, artifacts=[artifact], bundles=[bundle])
    repo.update_model_metadata(bundle.bundle_id, ModelMetadataUpdate(tags=["low-vram"]))

    index = ModelIndex(
        generated_from="test",
        summary=_empty_summary(),
        models=[
            _indexed_model(model_id="m1", path=str(model_path)),
            _indexed_model(model_id="m2", path=str(tmp_path / "unmatched.gguf")),
        ],
    )

    enriched = enrich_with_model_lab_health(index, repository=repo)

    matched = next(model for model in enriched.models if model.id == "m1")
    unmatched = next(model for model in enriched.models if model.id == "m2")
    assert matched.model_lab_health_status == "incomplete"
    assert matched.model_lab_tags == ["low-vram"]
    assert unmatched.model_lab_health_status is None
    assert unmatched.model_lab_tags == []


def test_enrich_with_model_lab_health_returns_unchanged_index_on_repository_failure(tmp_path: Path) -> None:
    class BrokenRepository:
        def list_models(self):
            raise RuntimeError("db unavailable")

    index = ModelIndex(generated_from="test", summary=_empty_summary(), models=[])

    result = enrich_with_model_lab_health(index, repository=BrokenRepository())  # type: ignore[arg-type]

    assert result is index


def test_enrich_with_model_lab_health_is_noop_when_model_lab_has_no_models(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    index = ModelIndex(generated_from="test", summary=_empty_summary(), models=[])

    result = enrich_with_model_lab_health(index, repository=repo)

    assert result is index


def test_resolve_bundle_to_model_id_matches_by_primary_artifact_path(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    source = repo.create_source(ModelSourceCreate(path=str(tmp_path)))
    model_path = tmp_path / "model.gguf"
    model_path.write_bytes(b"fake-gguf")
    artifact = _artifact(source_id=source.id, artifact_id="a1", bundle_id="b1")
    artifact = artifact.model_copy(update={"path": str(model_path)})
    bundle = _bundle(source_id=source.id, artifact_id="a1")
    repo.save_scan_output(source=source, artifacts=[artifact], bundles=[bundle])

    index = ModelIndex(
        generated_from="test",
        summary=_empty_summary(),
        models=[_indexed_model(model_id="m1", path=str(model_path))],
    )

    resolved = resolve_bundle_to_model_id("b1", model_lab_repo=repo, model_index=index)

    assert resolved == "m1"


def test_resolve_bundle_to_model_id_returns_none_for_unknown_bundle(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    index = ModelIndex(generated_from="test", summary=_empty_summary(), models=[])

    assert resolve_bundle_to_model_id("missing-bundle", model_lab_repo=repo, model_index=index) is None


def test_resolve_bundle_to_model_id_returns_none_when_artifact_not_in_index(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    source = repo.create_source(ModelSourceCreate(path=str(tmp_path)))
    model_path = tmp_path / "model.gguf"
    model_path.write_bytes(b"fake-gguf")
    artifact = _artifact(source_id=source.id, artifact_id="a1", bundle_id="b1")
    artifact = artifact.model_copy(update={"path": str(model_path)})
    bundle = _bundle(source_id=source.id, artifact_id="a1")
    repo.save_scan_output(source=source, artifacts=[artifact], bundles=[bundle])

    index = ModelIndex(generated_from="test", summary=_empty_summary(), models=[])

    assert resolve_bundle_to_model_id("b1", model_lab_repo=repo, model_index=index) is None
