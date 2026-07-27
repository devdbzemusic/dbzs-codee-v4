from fastapi.testclient import TestClient

from app.core.boot_state import reset_boot_state_store
from app.main import app


def test_health_returns_app_identity() -> None:
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "app": "DBZS Code Assistant",
        "version": "0.4.0-rc.1",
    }


def test_health_live_answers_without_touching_boot_state() -> None:
    client = TestClient(app)

    response = client.get("/health/live")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["pid"], int)
    assert isinstance(body["uptimeMs"], int)


def test_health_startup_reflects_boot_state_store_before_any_startup_ran() -> None:
    # No lifespan startup has run here (bare TestClient never enters
    # lifespan — see app/main.py's _run_startup_tasks docstring/comment and
    # test_lifespan_cleanup.py), so this exercises the store's honest
    # default: nothing is "success" yet, `ready` must be false, not a
    # fabricated true. /health/startup always answers 200 with full
    # component detail, whether or not the boot has finished.
    reset_boot_state_store()
    client = TestClient(app)

    response = client.get("/health/startup")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is False
    assert body["status"] == "starting"
    assert isinstance(body["instanceId"], str) and body["instanceId"]
    for component in ("database", "modelRegistry", "runtimeManager", "residentModel"):
        assert body["components"][component]["state"] == "pending"


def test_health_ready_returns_503_before_required_components_succeed() -> None:
    reset_boot_state_store()
    client = TestClient(app)

    response = client.get("/health/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["ready"] is False
    assert body["status"] == "starting"
    assert isinstance(body["instanceId"], str) and body["instanceId"]
    # The 503 "starting" body is intentionally minimal -- no per-component
    # breakdown, that's /health/startup's job.
    assert "requiredComponents" not in body
    assert "components" not in body


def test_health_ready_returns_200_once_required_components_succeed() -> None:
    store = reset_boot_state_store()
    import asyncio

    asyncio.run(store.set_component("database", "success"))
    asyncio.run(store.set_component("modelRegistry", "success"))
    asyncio.run(store.set_component("runtimeManager", "success"))
    # residentModel is optional, but must still reach a terminal state
    # (success/failed/skipped) before overall status can leave "starting" --
    # otherwise a boot with no resident-model autostart configured would
    # never resolve to "ready" at all.
    asyncio.run(store.set_component("residentModel", "skipped"))

    client = TestClient(app)
    response = client.get("/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["status"] == "ready"
    assert body["requiredComponents"] == {
        "database": "success",
        "modelRegistry": "success",
        "runtimeManager": "success",
    }
    assert body["optionalComponents"] == {"residentModel": "skipped"}


def test_health_ready_returns_200_and_degraded_when_only_resident_model_fails() -> None:
    store = reset_boot_state_store()
    import asyncio

    asyncio.run(store.set_component("database", "success"))
    asyncio.run(store.set_component("modelRegistry", "success"))
    asyncio.run(store.set_component("runtimeManager", "success"))
    asyncio.run(store.set_component("residentModel", "failed"))

    client = TestClient(app)
    response = client.get("/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["status"] == "degraded"
    assert body["optionalComponents"] == {"residentModel": "failed"}


def test_health_ready_returns_200_and_degraded_when_mandatory_component_warns() -> None:
    store = reset_boot_state_store()
    import asyncio

    asyncio.run(store.set_component("database", "success"))
    asyncio.run(store.set_component("modelRegistry", "warning"))
    asyncio.run(store.set_component("runtimeManager", "success"))
    asyncio.run(store.set_component("residentModel", "skipped"))

    client = TestClient(app)
    response = client.get("/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["status"] == "degraded"
    assert body["requiredComponents"] == {
        "database": "success",
        "modelRegistry": "warning",
        "runtimeManager": "success",
    }
