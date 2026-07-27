from fastapi.testclient import TestClient

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
