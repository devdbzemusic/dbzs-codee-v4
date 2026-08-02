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
    HardwareProfile,
    ModelArtifact,
    ModelBenchmarkRequest,
    ModelBundle,
    ModelCapabilityEvidenceRequest,
    ModelCertificationRequest,
    ModelCollectionCreate,
    ModelMetadataUpdate,
    ModelProbeRequest,
    ModelRoleAssignmentRequest,
    ModelSourceCreate,
    RuntimeSlotHealthEventCreate,
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


def test_fleet_repository_records_probe_certification_and_role_assignment(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _source_id, bundle = _seed_bundle(repo, tmp_path)

    probe = repo.create_probe_run(
        ModelProbeRequest(bundle_id=bundle.bundle_id),
        status="skipped",
        message="safe gate",
    )
    assert probe.allow_start is False
    assert repo.list_probe_runs(bundle.bundle_id)[0].id == probe.id

    with pytest.raises(ValueError, match="fehlende Zertifikate"):
        repo.assign_model_role(
            ModelRoleAssignmentRequest(
                bundle_id=bundle.bundle_id,
                role="CODING_EXECUTOR",
                safety_level="LEVEL_2_WORKSPACE_WRITE",
            )
        )

    for certification in ("CODING_VERIFIED", "STRUCTURED_OUTPUT_VERIFIED", "WRITE_AGENT_VERIFIED"):
        repo.upsert_certification(
            ModelCertificationRequest(
                bundle_id=bundle.bundle_id,
                certification=certification,
                evidence={"source": "unit"},
            )
        )

    assignment = repo.assign_model_role(
        ModelRoleAssignmentRequest(
            bundle_id=bundle.bundle_id,
            role="CODING_EXECUTOR",
            safety_level="LEVEL_2_WORKSPACE_WRITE",
        )
    )

    assert assignment.enabled is True
    assert set(assignment.required_certifications) == {
        "CODING_VERIFIED",
        "STRUCTURED_OUTPUT_VERIFIED",
        "WRITE_AGENT_VERIFIED",
    }


def test_assign_model_role_rejects_unknown_bundle_id(tmp_path: Path) -> None:
    repo = _repo(tmp_path)

    with pytest.raises(ValueError, match="nicht gefunden"):
        repo.assign_model_role(
            ModelRoleAssignmentRequest(bundle_id="does-not-exist", role="MICRO_TOOL_AGENT")
        )


def test_assign_model_role_persists_settings_field_and_residency_intent(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _source_id, bundle = _seed_bundle(repo, tmp_path)

    assignment = repo.assign_model_role(
        ModelRoleAssignmentRequest(
            bundle_id=bundle.bundle_id,
            role="MICRO_TOOL_AGENT",
            safety_level="LEVEL_1_READ_ONLY_TOOLS",
            enabled=False,
            settings_field="defaultOrchestratorModelId",
            residency_intent="keep_resident",
        )
    )

    assert assignment.settings_field == "defaultOrchestratorModelId"
    assert assignment.residency_intent == "keep_resident"

    listed = repo.list_role_assignments("MICRO_TOOL_AGENT")[0]
    assert listed.settings_field == "defaultOrchestratorModelId"
    assert listed.residency_intent == "keep_resident"

    default_assignment = repo.assign_model_role(
        ModelRoleAssignmentRequest(
            bundle_id=bundle.bundle_id,
            role="REASONING_VALIDATOR",
            safety_level="LEVEL_1_READ_ONLY_TOOLS",
            enabled=False,
        )
    )
    assert default_assignment.settings_field is None
    assert default_assignment.residency_intent == "manual"


def test_assign_model_role_upserts_on_same_bundle_and_role(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _source_id, bundle = _seed_bundle(repo, tmp_path)

    first = repo.assign_model_role(
        ModelRoleAssignmentRequest(
            bundle_id=bundle.bundle_id,
            role="MICRO_TOOL_AGENT",
            safety_level="LEVEL_1_READ_ONLY_TOOLS",
            enabled=False,
            settings_field="defaultDebugModelId",
            priority=10,
            notes="first",
        )
    )
    second = repo.assign_model_role(
        ModelRoleAssignmentRequest(
            bundle_id=bundle.bundle_id,
            role="MICRO_TOOL_AGENT",
            safety_level="LEVEL_1_READ_ONLY_TOOLS",
            enabled=False,
            settings_field="defaultVisionModelId",
            priority=20,
            notes="second",
        )
    )

    assert second.id == first.id
    assignments = repo.list_role_assignments("MICRO_TOOL_AGENT")
    assert len(assignments) == 1
    assert assignments[0].settings_field == "defaultVisionModelId"
    assert assignments[0].priority == 20
    assert assignments[0].notes == "second"


def test_fleet_repository_records_benchmark_measurements(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _source_id, bundle = _seed_bundle(repo, tmp_path)

    run = repo.create_benchmark_run(
        ModelBenchmarkRequest(
            bundle_id=bundle.bundle_id,
            metrics={
                "tokens_per_second": 42.5,
                "first_token_latency_ms": 120,
                "ignored": "not numeric",
                "warm": True,
            },
        ),
        status="queued",
        message="queued",
    )

    measurements = repo.list_benchmark_measurements(run.id)
    by_name = {measurement.name: measurement for measurement in measurements}
    assert set(by_name) == {"tokens_per_second", "first_token_latency_ms"}
    assert by_name["tokens_per_second"].unit == "tokens/s"
    assert by_name["tokens_per_second"].value == 42.5
    assert by_name["first_token_latency_ms"].unit == "ms"


def test_fleet_repository_records_capability_evidence(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _source_id, bundle = _seed_bundle(repo, tmp_path)

    evidence = repo.record_capability_evidence(
        ModelCapabilityEvidenceRequest(
            bundle_id=bundle.bundle_id,
            capability="tool_use",
            status="verified",
            evidence={"case": "json-tool-call"},
        )
    )

    records = repo.list_capability_evidence(bundle.bundle_id)
    assert records[0].id == evidence.id
    assert records[0].capability == "tool_use"
    assert records[0].status == "verified"
    assert records[0].evidence == {"case": "json-tool-call"}

    with pytest.raises(ValueError, match="Capability fehlt"):
        repo.record_capability_evidence(ModelCapabilityEvidenceRequest(bundle_id=bundle.bundle_id, capability=" "))


def test_fleet_routing_map_reports_certification_gate(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _source_id, bundle = _seed_bundle(repo, tmp_path)

    disabled = repo.assign_model_role(
        ModelRoleAssignmentRequest(
            bundle_id=bundle.bundle_id,
            role="MICRO_TOOL_AGENT",
            safety_level="LEVEL_1_READ_ONLY_TOOLS",
            enabled=False,
        )
    )
    blocked_entry = repo.list_routing_map("MICRO_TOOL_AGENT")[0]
    assert blocked_entry.bundle_id == bundle.bundle_id
    assert blocked_entry.enabled is False
    assert blocked_entry.routing_allowed is False
    assert set(blocked_entry.missing_certifications) == set(disabled.required_certifications)

    for certification in disabled.required_certifications:
        repo.upsert_certification(
            ModelCertificationRequest(
                bundle_id=bundle.bundle_id,
                certification=certification,
                evidence={"source": "unit"},
            )
        )

    repo.assign_model_role(
        ModelRoleAssignmentRequest(
            bundle_id=bundle.bundle_id,
            role="MICRO_TOOL_AGENT",
            safety_level="LEVEL_1_READ_ONLY_TOOLS",
            enabled=True,
            priority=7,
        )
    )
    allowed_entry = repo.list_routing_map("MICRO_TOOL_AGENT")[0]
    assert allowed_entry.routing_allowed is True
    assert allowed_entry.priority == 7
    assert allowed_entry.bundle_name == bundle.name
    assert set(allowed_entry.passed_certifications) == set(disabled.required_certifications)
    assert allowed_entry.missing_certifications == []


def test_fleet_readiness_aggregates_runtime_evidence_and_routing(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _source_id, bundle = _seed_bundle(repo, tmp_path)
    probe = repo.create_probe_run(
        ModelProbeRequest(bundle_id=bundle.bundle_id, runtime_options={"adapter_id": "llama.cpp"}),
        status="skipped",
        message="safe gate",
    )
    repo.record_capability_evidence(
        ModelCapabilityEvidenceRequest(
            bundle_id=bundle.bundle_id,
            capability="runtime_probe:llama.cpp",
            status="observed",
            evidence={"probe_run_id": probe.id},
        )
    )
    repo.assign_model_role(
        ModelRoleAssignmentRequest(
            bundle_id=bundle.bundle_id,
            role="MICRO_TOOL_AGENT",
            safety_level="LEVEL_1_READ_ONLY_TOOLS",
            enabled=False,
        )
    )

    readiness = repo.list_readiness(bundle.bundle_id)[0]

    assert readiness.bundle_id == bundle.bundle_id
    assert readiness.latest_probe_status == "skipped"
    assert readiness.evidence_count == 1
    assert readiness.assigned_roles == ["MICRO_TOOL_AGENT"]
    assert readiness.routing_allowed_roles == []
    assert "routing:no_allowed_role" in readiness.blockers


def test_runtime_presets_are_seeded_from_plan_15_matrix(tmp_path: Path) -> None:
    repo = _repo(tmp_path)

    presets = repo.list_runtime_presets()
    by_profile = {preset.profile: preset for preset in presets}

    assert set(by_profile) >= {
        "cpu_fallback",
        "safe_balanced",
        "best_low_latency",
        "best_throughput",
        "large_context",
    }
    assert by_profile["safe_balanced"].adapter_id == "llama.cpp"
    assert by_profile["safe_balanced"].config["gpu_layers"] == 16
    assert by_profile["large_context"].config["ctx"] == 16384


def test_execution_policies_are_seeded_from_plan_15_roles(tmp_path: Path) -> None:
    repo = _repo(tmp_path)

    policies = repo.list_execution_policies()
    by_role = {policy.role: policy for policy in policies}

    assert set(by_role) >= {"MAIN_AGENT", "MICRO_TOOL_AGENT", "CODING_EXECUTOR", "REPORT_GENERATOR"}
    assert by_role["CODING_EXECUTOR"].max_safety_level == "LEVEL_2_WORKSPACE_WRITE"
    assert "WRITE_AGENT_VERIFIED" not in by_role["CODING_EXECUTOR"].required_certifications
    assert by_role["MICRO_TOOL_AGENT"].required_certifications == [
        "TOOL_CALLING_VERIFIED",
        "READ_ONLY_AGENT_VERIFIED",
    ]


def test_hardware_snapshots_are_persisted_for_tuning_context(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    now = datetime.now(UTC)
    profile = HardwareProfile(
        fingerprint_hash="hw-test",
        os="Windows",
        architecture="AMD64",
        cpu_model="Unit CPU",
        cpu_threads=8,
        ram_bytes=32 * 1024 * 1024 * 1024,
        gpu_name="Unit GPU",
        gpu_vendor="NVIDIA",
        vram_bytes=8 * 1024 * 1024 * 1024,
        runtime_backend="cuda",
        collected_at=now,
    )

    snapshot = repo.record_hardware_snapshot(profile)
    snapshots = repo.list_hardware_snapshots()

    assert snapshots[0].id == snapshot.id
    assert snapshots[0].fingerprint_hash == "hw-test"
    assert snapshots[0].payload.gpu_name == "Unit GPU"
    assert snapshots[0].payload.collected_at == now


def test_role_assignment_rejects_safety_above_policy_maximum(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _source_id, bundle = _seed_bundle(repo, tmp_path)

    with pytest.raises(ValueError, match="Policy-Maximum"):
        repo.assign_model_role(
            ModelRoleAssignmentRequest(
                bundle_id=bundle.bundle_id,
                role="MICRO_TOOL_AGENT",
                safety_level="LEVEL_4_SHELL_AND_GIT",
                enabled=False,
            )
        )


def test_rebuild_logical_models_groups_quantized_variants(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    source = repo.create_source(ModelSourceCreate(path=str(tmp_path)))
    first = _artifact(artifact_id="a1", bundle_id="b1", source_id=source.id).model_copy(
        update={
            "detected_name": "qwenpaw-flash-2b-Q4_K_M",
            "file_name": "qwenpaw-flash-2b-Q4_K_M.gguf",
            "quantization": "Q4_K_M",
        }
    )
    second = _artifact(artifact_id="a2", bundle_id="b2", source_id=source.id).model_copy(
        update={
            "detected_name": "qwenpaw-flash-2b-Q8_0",
            "file_name": "qwenpaw-flash-2b-Q8_0.gguf",
            "quantization": "Q8_0",
        }
    )
    repo.save_scan_output(
        source=source,
        artifacts=[first, second],
        bundles=[
            _bundle(bundle_id="b1", source_id=source.id, artifact_id="a1").model_copy(
                update={"name": "qwenpaw-flash-2b-Q4_K_M"}
            ),
            _bundle(bundle_id="b2", source_id=source.id, artifact_id="a2").model_copy(
                update={"name": "qwenpaw-flash-2b-Q8_0"}
            ),
        ],
    )

    logical = repo.list_logical_models()
    variants = repo.list_model_variants(logical[0].logical_model_id)

    assert len(logical) == 1
    assert set(logical[0].bundle_ids) == {"b1", "b2"}
    assert {variant.bundle_id for variant in variants} == {"b1", "b2"}
    assert {variant.quantization for variant in variants} == {"Q4_K_M", "Q8_0"}


# --- Plan 15, Phase 6: persistent runtime slot health/failure history ---


def test_record_health_event_and_list(tmp_path: Path) -> None:
    repo = _repo(tmp_path)

    record = repo.record_health_event(
        RuntimeSlotHealthEventCreate(
            slot_id="fast_gpu",
            model_id="qwenpaw-flash-2b.gguf",
            event_type="restart_attempt",
            detail="Slot abgestuerzt, Neustart Versuch 1",
        )
    )

    assert record.id
    assert record.slot_id == "fast_gpu"
    assert record.event_type == "restart_attempt"

    events = repo.list_health_events(slot_id="fast_gpu")
    assert len(events) == 1
    assert events[0].id == record.id
    assert events[0].model_id == "qwenpaw-flash-2b.gguf"


def test_list_health_events_filters_by_slot(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    repo.record_health_event(RuntimeSlotHealthEventCreate(slot_id="fast_gpu", event_type="start"))
    repo.record_health_event(RuntimeSlotHealthEventCreate(slot_id="utility", event_type="start"))

    fast_gpu_events = repo.list_health_events(slot_id="fast_gpu")
    all_events = repo.list_health_events()

    assert len(fast_gpu_events) == 1
    assert fast_gpu_events[0].slot_id == "fast_gpu"
    assert len(all_events) == 2


def test_list_health_events_orders_newest_first(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    first = repo.record_health_event(RuntimeSlotHealthEventCreate(slot_id="fast_gpu", event_type="start"))
    second = repo.record_health_event(RuntimeSlotHealthEventCreate(slot_id="fast_gpu", event_type="crash"))

    events = repo.list_health_events(slot_id="fast_gpu")

    assert [event.id for event in events] == [second.id, first.id]


def test_health_event_pruning_keeps_last_200_per_slot(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    for _ in range(205):
        repo.record_health_event(RuntimeSlotHealthEventCreate(slot_id="fast_gpu", event_type="start"))
    repo.record_health_event(RuntimeSlotHealthEventCreate(slot_id="utility", event_type="start"))

    fast_gpu_events = repo.list_health_events(slot_id="fast_gpu", limit=1000)
    utility_events = repo.list_health_events(slot_id="utility", limit=1000)

    assert len(fast_gpu_events) == 200
    assert len(utility_events) == 1
