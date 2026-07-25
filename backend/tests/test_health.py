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


def test_health_ready_reflects_boot_state_store_before_any_startup_ran() -> None:
    # No lifespan startup has run here (bare TestClient never enters
    # lifespan — see app/main.py's _run_startup_tasks docstring/comment and
    # test_lifespan_cleanup.py), so this exercises the store's honest
    # default: nothing is "success" yet, `ready` must be false, not a
    # fabricated true.
    reset_boot_state_store()
    client = TestClient(app)

    response = client.get("/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is False
    assert body["status"] == "starting"
    for component in ("database", "modelRegistry", "runtimeManager", "residentModel"):
        assert body["components"][component]["state"] == "pending"
