from pathlib import Path

from app.context.repository_index import RepositoryIndexService
from fastapi.testclient import TestClient
from app.main import app


def test_repository_index_is_persisted_and_incremental(tmp_path: Path) -> None:
    (tmp_path / "main.py").write_text("def answer(value: int) -> int:\n    return value\n", encoding="utf-8")
    service = RepositoryIndexService()
    first = service.build(str(tmp_path))
    second = service.build(str(tmp_path))
    assert (tmp_path / ".codee" / "repo-map.json").exists()
    assert first["files"][0]["symbols"][0]["name"] == "answer"
    assert second["incrementalReusedFiles"] == 1
    assert first["workspaceHash"] == second["workspaceHash"]


def test_repository_index_endpoint_accepts_json_body(tmp_path: Path) -> None:
    (tmp_path / "main.py").write_text("value = 1\n", encoding="utf-8")
    response = TestClient(app).post("/context/index", json={"workspaceRoot": str(tmp_path)})
    assert response.status_code == 200
    assert response.json()["schemaVersion"] == 1
