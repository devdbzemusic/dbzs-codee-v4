from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.core.boot_state import BootStateStore
from app.runtime.resident_model_startup import run_resident_model_startup


def _settings(**overrides) -> SimpleNamespace:
    base = dict(autoStartOrchestratorRuntime=True, defaultOrchestratorModelId="model-a")
    base.update(overrides)
    return SimpleNamespace(**base)


def _status(state: str, message: str = "") -> SimpleNamespace:
    return SimpleNamespace(state=state, message=message)


@pytest.mark.anyio
async def test_skips_when_autostart_disabled():
    store = BootStateStore()
    with patch("app.settings.service.SettingsService.load", return_value=_settings(autoStartOrchestratorRuntime=False)):
        await run_resident_model_startup(store)

    assert store.snapshot()["components"]["residentModel"]["state"] == "skipped"


@pytest.mark.anyio
async def test_success_marks_component_success_with_model_id():
    store = BootStateStore()
    fake_runtime_service = MagicMock()
    fake_runtime_service.start_model.return_value = _status("running")

    with patch("app.settings.service.SettingsService.load", return_value=_settings()), \
         patch("app.api.runtime.get_runtime_service", return_value=fake_runtime_service):
        await run_resident_model_startup(store)

    snapshot = store.snapshot()
    assert snapshot["components"]["residentModel"]["state"] == "success"
    fake_runtime_service.start_model.assert_called_once_with("model-a", slot_id="orchestrator_cpu")


@pytest.mark.anyio
async def test_falls_back_to_second_candidate_when_no_default_and_primary_fails():
    store = BootStateStore()
    fake_runtime_service = MagicMock()
    # First attempt fails, second (fallback) candidate succeeds.
    fake_runtime_service.start_model.side_effect = [_status("error", "oom"), _status("running")]

    fake_model_a = SimpleNamespace(id="model-a", role="ORCHESTRATOR_MODEL")
    fake_model_b = SimpleNamespace(id="model-b", role="ORCHESTRATOR_MODEL")
    fake_index_service = MagicMock()
    fake_index_service.build_index.return_value = SimpleNamespace(models=[fake_model_a, fake_model_b])

    with patch("app.settings.service.SettingsService.load", return_value=_settings(defaultOrchestratorModelId="")), \
         patch("app.models.index_service.ModelIndexService", return_value=fake_index_service), \
         patch("app.api.runtime.get_runtime_service", return_value=fake_runtime_service):
        await run_resident_model_startup(store)

    # Only a *unique* default-less candidate is auto-picked; two candidates
    # with no configured default must be skipped, never silently guessed.
    snapshot = store.snapshot()
    assert snapshot["components"]["residentModel"]["state"] == "skipped"
    fake_runtime_service.start_model.assert_not_called()


@pytest.mark.anyio
async def test_failure_is_captured_without_raising_when_all_attempts_fail():
    store = BootStateStore()
    fake_runtime_service = MagicMock()
    fake_runtime_service.start_model.return_value = _status("error", "no such model file")

    with patch("app.settings.service.SettingsService.load", return_value=_settings()), \
         patch("app.api.runtime.get_runtime_service", return_value=fake_runtime_service):
        await run_resident_model_startup(store)  # must not raise

    snapshot = store.snapshot()
    assert snapshot["components"]["residentModel"]["state"] == "failed"
    assert "model-a" in (snapshot["components"]["residentModel"]["error"] or "")
