"""Unit tests for FleetRoutingResolver — the sole backend routing authority
(Workflow-Bruch WF-01/WF-09/WF-10). Covers the vision gate, capability gate
and tiered role-model fallback ported from the desktop's now-retired
resolveModelIdWithVisionGate()."""

import pytest

from app.models.schemas import IndexedModel, ModelIndex, ModelIndexSummary, ModelRuntimeHints, MultimodalPair
from app.runtime.errors import RuntimeProviderError
from app.runtime.routing_resolver import FleetRoutingResolver
from app.runtime.schemas import RuntimeRouteRequest
from app.settings.models import AppSettings


class FakeSettingsService:
    def __init__(self, **overrides):
        self._settings = AppSettings(**overrides)

    def load(self):
        return self._settings


def _model(id_, *, capabilities=None, modality=None, recommended_use="chat_candidate", artifact_type="model"):
    return IndexedModel(
        id=id_,
        name=id_,
        path=f"/models/{id_}.gguf",
        format="gguf",
        artifact_type=artifact_type,
        size_bytes=1,
        size_gb=0.001,
        backend="llama.cpp",
        runtime_launcher="llama-server",
        capabilities=capabilities or ["chat"],
        modality=modality or ["text"],
        recommended_use=recommended_use,
        compatibility="ok",
        runtime=ModelRuntimeHints(),
    )


class FakeIndexService:
    def __init__(self, models, multimodal_pairs=None):
        self._index = ModelIndex(
            generated_from="test",
            summary=ModelIndexSummary(
                models_dir="/models",
                total=len(models),
                gguf_total=len(models),
                llama_server_ready=len(models),
                coding_candidates=0,
                vision_candidates=0,
                adapters=0,
                unsupported=0,
            ),
            models=models,
            multimodal_pairs=multimodal_pairs or [],
        )

    def load_cached_index(self):
        return self._index

    def build_index(self, **_kwargs):
        return self._index


class FakeResidency:
    def __init__(self, entries=None):
        self._entries = entries or []

    def all_entries(self):
        return self._entries


class FakeResidencyEntry:
    def __init__(self, model_id):
        self.model_id = model_id


def test_routes_coding_task_to_configured_coder_model():
    settings = FakeSettingsService(defaultCoderModelId="coder-model")
    index = FakeIndexService([_model("coder-model", capabilities=["chat", "code"])])
    resolver = FleetRoutingResolver(settings, index)

    response = resolver.resolve(RuntimeRouteRequest(task_type="small_code_change"))

    assert response.resolved_model_id == "coder-model"
    assert response.slot_id == "fast_gpu"
    assert response.target_agent == "coder"
    assert response.selection_source == "role_setting"


def test_role_model_missing_falls_back_to_installed_candidate():
    settings = FakeSettingsService()  # no defaultChatModelId configured
    index = FakeIndexService([_model("installed-chat", capabilities=["chat"])])
    resolver = FleetRoutingResolver(settings, index)

    response = resolver.resolve(RuntimeRouteRequest(task_type="casual_chat"))

    assert response.resolved_model_id == "installed-chat"
    assert response.selection_source == "explicit_fallback"
    assert "role_fallback:installed_model:installed-chat" in response.reason


def test_role_model_missing_prefers_resident_model_over_installed():
    settings = FakeSettingsService()
    index = FakeIndexService(
        [_model("resident-chat", capabilities=["chat"]), _model("other-chat", capabilities=["chat"])]
    )
    residency = FakeResidency([FakeResidencyEntry("resident-chat")])
    resolver = FleetRoutingResolver(settings, index, residency=residency)

    response = resolver.resolve(RuntimeRouteRequest(task_type="casual_chat"))

    assert response.resolved_model_id == "resident-chat"
    assert "role_fallback:running_model:resident-chat" in response.reason


def test_no_fallback_candidate_raises_structured_error():
    settings = FakeSettingsService()
    index = FakeIndexService([])
    resolver = FleetRoutingResolver(settings, index)

    with pytest.raises(RuntimeProviderError) as excinfo:
        resolver.resolve(RuntimeRouteRequest(task_type="casual_chat"))

    assert excinfo.value.code == "role_model_missing_no_fallback"


def test_vision_role_model_without_verified_pair_is_blocked():
    settings = FakeSettingsService(defaultVisionModelId="vl-model")
    index = FakeIndexService([_model("vl-model", modality=["vision"], recommended_use="vision_candidate")])
    resolver = FleetRoutingResolver(settings, index)

    with pytest.raises(RuntimeProviderError) as excinfo:
        resolver.resolve(RuntimeRouteRequest(task_type="normal_chat", requires_vision=True))

    assert excinfo.value.code == "vision_pairing_required"


def test_vision_role_model_with_verified_pair_resolves_projector():
    settings = FakeSettingsService(defaultVisionModelId="vl-model")
    pair = MultimodalPair(
        id="pair-1",
        base_model_id="vl-model",
        projector_artifact_id="mmproj-1",
        source="scan",
        confidence=1.0,
        status="verified",
        routing_allowed=True,
    )
    index = FakeIndexService(
        [_model("vl-model", modality=["vision"], recommended_use="vision_candidate")],
        multimodal_pairs=[pair],
    )
    resolver = FleetRoutingResolver(settings, index)

    response = resolver.resolve(RuntimeRouteRequest(task_type="normal_chat", requires_vision=True))

    assert response.resolved_model_id == "vl-model"
    assert response.projector_artifact_id == "mmproj-1"
    assert response.slot_id == "vision_gpu"


def test_vision_turn_requiring_code_capability_blocks_incapable_model():
    settings = FakeSettingsService(defaultVisionModelId="vl-model")
    index = FakeIndexService(
        [_model("vl-model", capabilities=["chat", "vision"], modality=["vision", "text"])]
    )
    resolver = FleetRoutingResolver(settings, index)

    with pytest.raises(RuntimeProviderError) as excinfo:
        resolver.resolve(
            RuntimeRouteRequest(task_type="small_code_change", requires_vision=True, has_image_input=True)
        )

    assert excinfo.value.code == "code_capability_missing"


def test_configured_model_not_in_index_raises_structured_error():
    settings = FakeSettingsService(defaultCoderModelId="ghost-model")
    index = FakeIndexService([])
    resolver = FleetRoutingResolver(settings, index)

    with pytest.raises(RuntimeProviderError) as excinfo:
        resolver.resolve(RuntimeRouteRequest(task_type="small_code_change"))

    assert excinfo.value.code == "role_model_not_in_index"
