from pathlib import Path

from fastapi.testclient import TestClient

from app.api.project_memory import get_project_memory_service  # type: ignore[import-not-found]
from app.api.task_board import get_task_board_service  # type: ignore[import-not-found]
from app.main import app  # type: ignore[import-not-found]
from app.project_memory.service import ProjectMemoryService  # type: ignore[import-not-found]
from app.task_board.service import TaskBoardService  # type: ignore[import-not-found]


def test_project_memory_upsert_list_delete(tmp_path: Path) -> None:
    service = ProjectMemoryService(db_path=tmp_path / "project_memory.sqlite3")
    app.dependency_overrides[get_project_memory_service] = lambda: service
    client = TestClient(app)

    upsert_response = client.put(
        "/project-memory",
        json={
            "workspace": "workspace_a",
            "memory_key": "context",
            "content": "Remember to finish phase 6",
            "tags": ["phase6", "planning"],
        },
    )
    list_response = client.get("/project-memory?workspace=workspace_a")
    entry_id = upsert_response.json()["id"]
    delete_response = client.delete(f"/project-memory/{entry_id}")

    app.dependency_overrides.clear()

    assert upsert_response.status_code == 200
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1
    assert delete_response.status_code == 200


def test_task_board_create_update_delete(tmp_path: Path) -> None:
    service = TaskBoardService(db_path=tmp_path / "task_board.sqlite3")
    app.dependency_overrides[get_task_board_service] = lambda: service
    client = TestClient(app)

    create_response = client.post(
        "/task-board",
        json={"title": "Implement panel", "description": "Add Task Board panel", "priority": 2},
    )
    task_id = create_response.json()["id"]
    update_response = client.put(f"/task-board/{task_id}", json={"status": "in_progress"})
    list_response = client.get("/task-board")
    delete_response = client.delete(f"/task-board/{task_id}")

    app.dependency_overrides.clear()

    assert create_response.status_code == 200
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "in_progress"
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1
    assert delete_response.status_code == 200


def test_docs_analysis_and_generate(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("# Project\n\nTODO: write docs\n", encoding="utf-8")
    (tmp_path / "main.py").write_text("print('ok')\n", encoding="utf-8")

    client = TestClient(app)
    analyze_response = client.get(f"/docs/analyze?workspace_root={tmp_path.as_posix()}")
    generate_response = client.post(
        "/docs/generate",
        json={"workspace_root": tmp_path.as_posix(), "max_files": 5},
    )

    assert analyze_response.status_code == 200
    assert analyze_response.json()["files_scanned"] >= 2
    assert generate_response.status_code == 200
    assert "Workspace Analysis" in generate_response.json()["content"]
