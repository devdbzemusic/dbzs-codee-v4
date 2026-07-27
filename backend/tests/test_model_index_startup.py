from unittest.mock import MagicMock, patch

import pytest

from app.core.boot_state import BootStateStore
from app.models.index_startup import run_model_index_startup
from app.models.schemas import ModelIndex, ModelIndexSummary


def _fake_index(model_count: int) -> MagicMock:
    # run_model_index_startup only reads `.models` off the result — a bare
    # MagicMock avoids fighting ModelIndex's strict Pydantic field set here.
    return MagicMock(models=[object()] * model_count)


def _real_index(model_count: int) -> ModelIndex:
    return ModelIndex(
        generated_from="cache:test",
        summary=ModelIndexSummary(
            models_dir="D:/Models",
            runtime_dir=None,
            ollama_dir=None,
            ollama_models_dir=None,
            total=model_count,
            gguf_total=model_count,
            ollama_total=0,
            llama_server_ready=model_count,
            ollama_ready=0,
            coding_candidates=model_count,
            vision_candidates=0,
            adapters=0,
            unsupported=0,
        ),
        models=[],
    )


@pytest.mark.anyio
async def test_model_index_startup_reports_success_and_model_count():
    store = BootStateStore()
    fake_service = MagicMock()
    fake_service.build_index.return_value = _fake_index(3)

    with patch("app.models.index_startup.ModelIndexService", return_value=fake_service), \
         patch("app.models.index_startup.get_model_discovery_mode", return_value="local_with_ollama"):
        await run_model_index_startup(store)

    snapshot = store.snapshot()
    assert snapshot["components"]["modelRegistry"]["state"] == "success"
    assert snapshot["components"]["modelRegistry"]["progress"] == 3


@pytest.mark.anyio
async def test_model_index_startup_does_not_abort_the_whole_boot_when_build_index_raises():
    # Even a total build_index() failure must be captured as a failed
    # component, never propagate as an unhandled exception out of the
    # startup task (it runs detached via asyncio.create_task in main.py).
    store = BootStateStore()
    fake_service = MagicMock()
    fake_service.build_index.side_effect = RuntimeError("catalog file is corrupt")

    with patch("app.models.index_startup.ModelIndexService", return_value=fake_service), \
         patch("app.models.index_startup.get_model_discovery_mode", return_value="local_with_ollama"):
        await run_model_index_startup(store)  # must not raise

    snapshot = store.snapshot()
    assert snapshot["components"]["modelRegistry"]["state"] == "failed"


@pytest.mark.anyio
async def test_model_index_startup_reports_warning_when_some_models_are_skipped():
    store = BootStateStore()
    fake_service = MagicMock()

    def fake_build_index(*, on_progress=None, on_model_error=None):
        if on_model_error:
            on_model_error("broken-model.gguf", ValueError("bad header"))
        if on_progress:
            on_progress(2, 2)
        return _fake_index(1)

    fake_service.build_index.side_effect = fake_build_index

    with patch("app.models.index_startup.ModelIndexService", return_value=fake_service), \
         patch("app.models.index_startup.get_model_discovery_mode", return_value="local_with_ollama"):
        await run_model_index_startup(store)

    snapshot = store.snapshot()
    data = snapshot["components"]["modelRegistry"]["data"]
    assert snapshot["components"]["modelRegistry"]["state"] == "warning"
    assert any(err["path"] == "broken-model.gguf" and err["code"] == "ValueError" for err in data["modelErrors"])
    assert data["validModelCount"] == 1
    assert data["invalidModelCount"] == 1


@pytest.mark.anyio
async def test_model_index_startup_uses_cache_in_safe_mode_when_available():
    store = BootStateStore()
    fake_service = MagicMock()
    fake_service.load_cached_index.return_value = _real_index(3)
    fake_service.last_build_metrics.as_dict.return_value = {
        "scannedFileCount": 3,
        "candidateCount": 3,
        "validModelCount": 3,
        "invalidModelCount": 0,
        "cachedModelCount": 3,
    }

    with patch("app.models.index_startup.ModelIndexService", return_value=fake_service), \
         patch("app.models.index_startup.get_model_discovery_mode", return_value="local_with_ollama"):
        await run_model_index_startup(store, cache_only=True)

    snapshot = store.snapshot()
    component = snapshot["components"]["modelRegistry"]
    assert component["state"] == "success"
    assert component["data"]["cachedModelCount"] == 3
    assert "Cache" in component["message"]


@pytest.mark.anyio
async def test_model_index_startup_tolerates_missing_cache_in_safe_mode():
    store = BootStateStore()
    fake_service = MagicMock()
    fake_service.load_cached_index.return_value = None

    with patch("app.models.index_startup.ModelIndexService", return_value=fake_service), \
         patch("app.models.index_startup.get_model_discovery_mode", return_value="local_with_ollama"):
        await run_model_index_startup(store, cache_only=True)

    snapshot = store.snapshot()
    component = snapshot["components"]["modelRegistry"]
    assert component["state"] == "success"
    assert component["data"]["cachedModelCount"] == 0
