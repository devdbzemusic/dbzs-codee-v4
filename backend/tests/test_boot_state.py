import pytest

from app.core.boot_state import BootComponentError, BootStateStore


@pytest.mark.anyio
async def test_snapshot_starts_pending_and_not_ready():
    store = BootStateStore()
    snapshot = store.snapshot()

    assert snapshot["status"] == "starting"
    assert snapshot["ready"] is False
    for name in ("database", "modelRegistry", "runtimeManager", "residentModel"):
        assert snapshot["components"][name]["state"] == "pending"


@pytest.mark.anyio
async def test_ready_true_once_mandatory_components_succeed_even_if_resident_model_pending():
    store = BootStateStore()
    await store.set_component("database", "success")
    await store.set_component("modelRegistry", "success")
    await store.set_component("runtimeManager", "success")

    snapshot = store.snapshot()

    assert snapshot["status"] == "starting"
    assert snapshot["ready"] is False


@pytest.mark.anyio
async def test_status_degraded_when_resident_model_fails_but_mandatory_components_succeed():
    store = BootStateStore()
    await store.set_component("database", "success")
    await store.set_component("modelRegistry", "success")
    await store.set_component("runtimeManager", "success")
    await store.set_component("residentModel", "failed", error=BootComponentError(code="no-gguf-found"))

    snapshot = store.snapshot()

    assert snapshot["status"] == "degraded"
    assert snapshot["ready"] is True  # optional-phase failure must not block overall readiness


@pytest.mark.anyio
async def test_status_ready_when_resident_model_skipped():
    store = BootStateStore()
    await store.set_component("database", "success")
    await store.set_component("modelRegistry", "success")
    await store.set_component("runtimeManager", "success")
    await store.set_component("residentModel", "skipped", message="autostart disabled")

    snapshot = store.snapshot()

    assert snapshot["status"] == "ready"
    assert snapshot["ready"] is True


@pytest.mark.anyio
async def test_status_failed_when_a_mandatory_component_fails():
    store = BootStateStore()
    await store.set_component("database", "failed", error=BootComponentError(code="disk-full"))
    await store.set_component("modelRegistry", "success")
    await store.set_component("runtimeManager", "success")

    snapshot = store.snapshot()

    assert snapshot["status"] == "failed"
    assert snapshot["ready"] is False


@pytest.mark.anyio
async def test_set_component_rejects_unknown_component_name():
    store = BootStateStore()
    with pytest.raises(ValueError):
        await store.set_component("not-a-real-component", "success")


@pytest.mark.anyio
async def test_logs_since_only_returns_new_entries():
    store = BootStateStore()
    await store.set_component("database", "running", message="starting up")
    first_batch, cursor = store.logs_since(0)
    assert len(first_batch) == 1

    await store.set_component("database", "success", message="ready")
    second_batch, cursor2 = store.logs_since(cursor)
    assert len(second_batch) == 1
    assert cursor2 > cursor
