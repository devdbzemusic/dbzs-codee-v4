"""
Direct repository-layer tests for ModelLabRepository (Plan 12, Etappe 2, Punkt 4).

The existing test_model_lab.py exercises the repository indirectly through the HTTP
API with real file scanning (slow, hashing real bytes). These tests construct
ModelArtifact/ModelBundle objects directly and call the repository methods, which
is faster and lets error paths (unknown bundle/collection ids, re-scan upserts,
duplicate collection names) be tested precisely without needing a real scan.
"""
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.model_lab.models import (
    ModelArtifact,
    ModelBundle,
    ModelCollectionCreate,
    ModelMetadataUpdate,
    ModelSourceCreate,
)
from app.model_lab.repository import ModelLabRepository


def _artifact(*, artifact_id: str = "a1", bundle_id: str = "b1", source_id: str = "s1") -> ModelArtifact:
    now = datetime.now(UTC)
    return ModelArtifact(
        artifact_id=artifact_id,
        installation_id=artifact_id,
        source_id=source_id,
        bundle_id=bundle_id,
        path=f"/models/{artifact_id}.gguf",
        parent_path="/models",
        file_name=f"{artifact_id}.gguf",
        detected_name=artifact_id,
        format="gguf",
        artifact_type="model",
        size_bytes=1024,
        sha256="deadbeef",
        discovered_at=now,
        updated_at=now,
    )


def _bundle(*, bundle_id: str = "b1", source_id: str = "s1", artifact_id: str = "a1", status: str = "IDENTIFIED") -> ModelBundle:
    now = datetime.now(UTC)
    return ModelBundle(
        bundle_id=bundle_id,
        name=bundle_id,
        primary_artifact_id=artifact_id,
        artifact_ids=[artifact_id],
        source_ids=[source_id],
        status=status,
        created_at=now,
        updated_at=now,
    )


def _repo(tmp_path: Path) -> ModelLabRepository:
    return ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")


def _seed_bundle(repo: ModelLabRepository, tmp_path: Path) -> tuple[str, ModelBundle]:
    source = repo.create_source(ModelSourceCreate(path=str(tmp_path)))
    artifact = _artifact(source_id=source.id)
    bundle = _bundle(source_id=source.id)
    repo.save_scan_output(source=source, artifacts=[artifact], bundles=[bundle])
    return source.id, bundle


def test_rescanning_updates_bundle_in_place_without_duplication(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    source_id, bundle = _seed_bundle(repo, tmp_path)
    assert len(repo.list_models()) == 1

    updated_bundle = bundle.model_copy(update={"status": "BROKEN"})
    source = repo.get_source(source_id)
    repo.save_scan_output(source=source, artifacts=[_artifact(source_id=source_id)], bundles=[updated_bundle])

    models = repo.list_models()
    assert len(models) == 1
    assert models[0].bundle.status == "BROKEN"


def test_mark_source_failed_records_error(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    source = repo.create_source(ModelSourceCreate(path=str(tmp_path)))

    repo.mark_source_failed(source, "Pfad nicht erreichbar")

    reloaded = repo.get_source(source.id)
    assert reloaded is not None
    assert reloaded.last_scan_status == "failed"
    assert reloaded.last_error == "Pfad nicht erreichbar"


def test_update_model_metadata_rejects_unknown_bundle(tmp_path: Path) -> None:
    repo = _repo(tmp_path)

    with pytest.raises(ValueError, match="nicht gefunden"):
        repo.update_model_metadata("does-not-exist", ModelMetadataUpdate(tags=["x"]))


def test_create_collection_with_duplicate_name_updates_existing(tmp_path: Path) -> None:
    repo = _repo(tmp_path)

    first = repo.create_collection(ModelCollectionCreate(name="Coding", color="#111111"))
    second = repo.create_collection(ModelCollectionCreate(name="Coding", color="#222222"))

    assert second.id == first.id
    assert second.color == "#222222"
    assert len(repo.list_collections()) == 1


def test_add_to_collection_rejects_unknown_collection_and_bundle(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _source_id, bundle = _seed_bundle(repo, tmp_path)
    collection = repo.create_collection(ModelCollectionCreate(name="Coding"))

    with pytest.raises(ValueError, match="Model bundle nicht gefunden"):
        repo.add_to_collection(collection.id, "does-not-exist")

    with pytest.raises(ValueError, match="Collection nicht gefunden"):
        repo.add_to_collection("does-not-exist", bundle.bundle_id)


def test_remove_from_collection_removes_membership(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _source_id, bundle = _seed_bundle(repo, tmp_path)
    collection = repo.create_collection(ModelCollectionCreate(name="Coding"))
    repo.add_to_collection(collection.id, bundle.bundle_id)
    model = repo.get_model(bundle.bundle_id)
    assert model is not None
    assert model.bundle.collection_ids == [collection.id]

    repo.remove_from_collection(collection.id, bundle.bundle_id)

    model = repo.get_model(bundle.bundle_id)
    assert model is not None
    assert model.bundle.collection_ids == []


def test_find_duplicates_returns_empty_for_unique_models(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _seed_bundle(repo, tmp_path)

    assert repo.find_duplicates() == []
