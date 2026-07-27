from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.api.context_pack as context_pack_api
from app.context_pack.models import ContextPackBuildRequest
from app.context_pack.service import ContextPackService
from app.main import app


def test_context_pack_builds_markdown(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text('{"name":"demo"}', encoding="utf-8")
    (tmp_path / "README.md").write_text("# Demo\nTODO: fix build\n", encoding="utf-8")
    src = tmp_path / "src"
    src.mkdir(exist_ok=True)
    (src / "App.tsx").write_text("export const App = () => null;\n", encoding="utf-8")

    service = ContextPackService()
    result = service.build(
        ContextPackBuildRequest(
            workspace_root=str(tmp_path),
            user_request="Find build issues",
            active_file_path="src/App.tsx",
        )
    )
    assert result.project_name == tmp_path.name
    assert "node" in result.detected_stack or "typescript" in result.detected_stack
    assert "TODO" in "\n".join(result.todo_markers)
    assert "Find build issues" in result.markdown_context
    assert any(file.path == "src/App.tsx" for file in result.repo_map.files)
    app_file = next(file for file in result.repo_map.files if file.path == "src/App.tsx")
    assert "App" in app_file.exports
    assert result.repo_map.token_budget == 12000


def test_context_pack_repo_map_excludes_secrets_and_build_artifacts(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("SECRET=do-not-read", encoding="utf-8")
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "bundle.js").write_text("export const leaked = true;", encoding="utf-8")
    src = tmp_path / "src"
    src.mkdir()
    (src / "index.ts").write_text(
        "import { helper } from './utils';\nexport function main() { return helper(); }\n",
        encoding="utf-8",
    )
    (src / "utils.ts").write_text("export const helper = () => 1;\n", encoding="utf-8")

    result = ContextPackService().build(
        ContextPackBuildRequest(
            workspace_root=str(tmp_path),
            user_request="Build repo map",
            repo_map_token_budget=2000,
        )
    )

    mapped_paths = {file.path for file in result.repo_map.files}
    assert ".env" not in mapped_paths
    assert "dist/bundle.js" not in mapped_paths
    assert "src/index.ts" in mapped_paths
    index_file = next(file for file in result.repo_map.files if file.path == "src/index.ts")
    assert "./utils" in index_file.imports
    assert any(symbol.name == "main" for symbol in index_file.symbols)


def test_context_pack_api(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("# Demo", encoding="utf-8")
    client = TestClient(app)
    response = client.post(
        "/context-pack/build",
        json={
            "workspace_root": str(tmp_path),
            "user_request": "Analyze project",
        },
    )
    assert response.status_code == 200
    assert response.json()["project_name"] == tmp_path.name


def test_context_pack_rejects_missing_workspace() -> None:
    service = ContextPackService()
    with pytest.raises(ValueError):
        service.build(
            ContextPackBuildRequest(
                workspace_root="/does/not/exist",
                user_request="x",
            )
        )


def test_context_pack_shrinks_to_token_budget(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text('{"name":"demo"}', encoding="utf-8")
    (tmp_path / "README.md").write_text("# Demo\n" + "\n".join(f"TODO line {index}" for index in range(50)), encoding="utf-8")
    src = tmp_path / "src"
    src.mkdir(exist_ok=True)
    for index in range(20):
        (src / f"file-{index}.ts").write_text(f"export const value{index} = {index};\n", encoding="utf-8")

    result = ContextPackService().build(
        ContextPackBuildRequest(
            workspace_root=str(tmp_path),
            user_request="Reduce context aggressively but keep the important bits.",
            active_file_path="src/file-0.ts",
            max_files=40,
            target_token_budget=256,
        ),
        tokenizer=lambda text: max(1, len(text.split())),
    )

    assert result.metadata["budget_fit"] is True
    assert result.metadata["post_shrink_token_estimate"] <= 256
    assert result.important_files
    assert result.risk_notes or result.todo_markers
    assert isinstance(result.metadata["dropped_items"], dict)


def test_context_pack_api_uses_runtime_tokenizer_slot_when_requested(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "README.md").write_text("# Demo\n", encoding="utf-8")

    calls: list[tuple[str, str]] = []

    class FakeRuntimeService:
        def tokenize(self, slot_id: str, text: str) -> int:
            calls.append((slot_id, text))
            return max(1, len(text.split()))

    monkeypatch.setattr(context_pack_api, "get_runtime_service", lambda: FakeRuntimeService())

    client = TestClient(app)
    response = client.post(
        "/context-pack/build",
        json={
            "workspace_root": str(tmp_path),
            "user_request": "Analyze project",
            "tokenizer_slot_id": "fast_gpu",
            "target_token_budget": 256,
        },
    )

    assert response.status_code == 200
    assert calls
    assert all(slot_id == "fast_gpu" for slot_id, _ in calls)
    assert response.json()["metadata"]["tokenizer_slot_id"] == "fast_gpu"

