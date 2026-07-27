from fastapi.testclient import TestClient

from app.main import app  # type: ignore[import-not-found]


def test_orchestration_tools_catalog() -> None:
    client = TestClient(app)

    response = client.get("/orchestration/tools")

    assert response.status_code == 200
    tool_ids = {item["id"] for item in response.json()["tools"]}
    assert tool_ids.issuperset({"filesystem.list_dir", "filesystem.read_text", "web.fetch_url", "vision.screenshot_text"})


def test_orchestration_prepare_context() -> None:
    client = TestClient(app)

    response = client.post(
        "/orchestration/context/prepare",
        json={
            "user_request": "Baue eine erste App mit klaren Aufgabenpaketen.",
            "ui": {
                "left_panel_collapsed": False,
                "right_panel_collapsed": True,
                "terminal_collapsed": False,
                "bottom_panel": "terminal",
            },
            "workspace": {
                "root_path": "D:/Dev/repo/dbzs-codee",
                "project_name": "dbzs-codee",
                "active_file_path": "apps/desktop/src/App.tsx",
                "indexed_file_count": 120,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "Intent fuer" in payload["intent_summary"]
    assert "intender" in payload["suggested_agents"]
    assert "model_controller" in payload["suggested_agents"]
    assert len(payload["work_items"]) >= 3
    assert len(payload["tool_capabilities"]) >= 3


def test_orchestration_execute_tool_scope_denied(tmp_path) -> None:
    client = TestClient(app)

    response = client.post(
        "/orchestration/tools/execute",
        json={
            "tool_id": "filesystem.read_text",
            "scope": "network",
            "workspace_root": str(tmp_path),
            "params": {"path": str(tmp_path / "x.txt")},
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "error"


def test_orchestration_execute_tool_read(tmp_path) -> None:
    sample = tmp_path / "sample.txt"
    sample.write_text("hello orchestration", encoding="utf-8")
    client = TestClient(app)

    response = client.post(
        "/orchestration/tools/execute",
        json={
            "tool_id": "filesystem.read_text",
            "scope": "read",
            "workspace_root": str(tmp_path),
            "params": {"path": str(sample), "max_bytes": 50},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert "hello orchestration" in payload["output"]["content"]
