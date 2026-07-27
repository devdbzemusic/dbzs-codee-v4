"""Phase 3C — Tool runtime and context budget tests."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

from app.agent_workbench.context_budget import ContextBudget
from app.agent_workbench.repository import AgentWorkbenchRepository
from app.agent_workbench.tools import AgentToolRuntime, resolve_safe_path
from app.project_adapters.registry import detect_project

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = REPO_ROOT / "fixtures" / "agent-workbench-demo"


@pytest.fixture
def tool_runtime(tmp_path: Path):
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    repo = AgentWorkbenchRepository(db_path=path)
    runtime = AgentToolRuntime(repo, simulate_llm=True)
    yield runtime, repo, tmp_path
    os.unlink(path)


class TestWorkspaceSandbox:
    def test_path_traversal_blocked(self, tmp_path: Path):
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        with pytest.raises(ValueError, match="ausserhalb"):
            resolve_safe_path(str(ws), "../outside")

    def test_resolve_relative_path(self, tmp_path: Path):
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        sub = ws / "src"
        sub.mkdir(parents=True, exist_ok=True)
        target = resolve_safe_path(str(ws), "src")
        assert target == sub.resolve()


class TestFilesystemTools:
    def test_list_directory(self, tool_runtime, tmp_path: Path):
        runtime, repo, _ = tool_runtime
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        (ws / "a.txt").write_text("a", encoding="utf-8")
        (ws / "b.txt").write_text("b", encoding="utf-8")

        call = runtime.execute_tool(
            run_id="run-1",
            step_id="step-1",
            tool_id="filesystem.list",
            arguments={"path": "."},
            workspace_root=str(ws),
        )
        assert call.status == "completed"
        result = repo.loads(call.result_json)
        assert result["count"] >= 2

    def test_internal_directories_are_hidden_and_not_readable(self, tool_runtime, tmp_path: Path):
        runtime, repo, _ = tool_runtime
        ws = tmp_path / "ws-internal"
        internal = ws / ".codee" / "resources"
        internal.mkdir(parents=True)
        (internal / "old.ts").write_text("analyzer leak", encoding="utf-8")
        (ws / "visible.ts").write_text("visible", encoding="utf-8")

        listed = runtime.execute_tool(
            run_id="run-internal",
            step_id="step-internal",
            tool_id="filesystem.list",
            arguments={"path": "."},
            workspace_root=str(ws),
        )
        listed_result = repo.loads(listed.result_json)
        assert [entry["path"] for entry in listed_result["entries"]] == ["visible.ts"]

        read = runtime.execute_tool(
            run_id="run-internal",
            step_id="step-internal",
            tool_id="filesystem.read",
            arguments={"path": ".codee/resources/old.ts"},
            workspace_root=str(ws),
        )
        assert read.status == "failed"

    def test_read_text_file(self, tool_runtime, tmp_path: Path):
        runtime, repo, _ = tool_runtime
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        (ws / "hello.txt").write_text("hello world", encoding="utf-8")

        call = runtime.execute_tool(
            run_id="run-1",
            step_id="step-1",
            tool_id="filesystem.read",
            arguments={"path": "hello.txt"},
            workspace_root=str(ws),
        )
        assert call.status == "completed"
        result = repo.loads(call.result_json)
        assert "hello" in result["content"]

    def test_binary_file_rejected(self, tool_runtime, tmp_path: Path):
        runtime, _, _ = tool_runtime
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        (ws / "data.bin").write_bytes(b"\x00\x01\x02")

        call = runtime.execute_tool(
            run_id="run-1",
            step_id="step-1",
            tool_id="filesystem.read",
            arguments={"path": "data.bin"},
            workspace_root=str(ws),
        )
        assert call.status == "failed"

    def test_search_with_limit(self, tool_runtime, tmp_path: Path):
        runtime, repo, _ = tool_runtime
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        for i in range(5):
            (ws / f"f{i}.txt").write_text(f"content {i}", encoding="utf-8")

        call = runtime.execute_tool(
            run_id="run-1",
            step_id="step-1",
            tool_id="filesystem.search",
            arguments={"query": "content", "glob": "*.txt"},
            workspace_root=str(ws),
        )
        assert call.status == "completed"
        result = repo.loads(call.result_json)
        assert result["count"] >= 1

    def test_unknown_tool_fails(self, tool_runtime, tmp_path: Path):
        runtime, _, _ = tool_runtime
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        call = runtime.execute_tool(
            run_id="run-1",
            step_id="step-1",
            tool_id="filesystem.destroy",
            arguments={},
            workspace_root=str(ws),
        )
        assert call.status == "failed"


class TestProjectDetect:
    def test_detect_node_fixture(self):
        detections = detect_project(FIXTURES / "node")
        ids = [d.adapter_id for d in detections]
        assert "node" in ids

    def test_detect_python_fixture(self):
        detections = detect_project(FIXTURES / "python")
        ids = [d.adapter_id for d in detections]
        assert "python" in ids

    def test_detect_rust_fixture(self):
        detections = detect_project(FIXTURES / "rust")
        ids = [d.adapter_id for d in detections]
        assert "rust" in ids

    def test_project_detect_tool(self, tool_runtime):
        runtime, repo, _ = tool_runtime
        call = runtime.execute_tool(
            run_id="run-1",
            step_id="step-1",
            tool_id="project.detect",
            arguments={},
            workspace_root=str(FIXTURES / "node"),
        )
        assert call.status == "completed"
        result = repo.loads(call.result_json)
        assert result["count"] >= 1


class TestContextBudget:
    def test_file_budget_enforced(self):
        budget = ContextBudget(max_files=1, max_total_bytes=100)
        ok, _ = budget.can_read_file("a.txt", 50)
        assert ok
        budget.record_file_read("a.txt", 50)
        ok, msg = budget.can_read_file("b.txt", 10)
        assert not ok
        assert "Max files" in msg

    def test_total_byte_budget(self):
        budget = ContextBudget(max_total_bytes=100, max_files=10)
        budget.record_file_read("a.txt", 80)
        ok, msg = budget.can_read_file("b.txt", 30)
        assert not ok
        assert "budget" in msg.lower()

    def test_search_match_limit(self):
        budget = ContextBudget(max_search_matches=2)
        ok, _ = budget.can_search(2)
        assert ok
        budget.record_search(2)
        ok, msg = budget.can_search(1)
        assert not ok
        assert "Search" in msg


class TestToolPersistence:
    def test_tool_calls_persisted(self, tool_runtime, tmp_path: Path):
        runtime, repo, _ = tool_runtime
        ws = tmp_path / "ws"
        ws.mkdir(parents=True, exist_ok=True)
        runtime.execute_tool(
            run_id="run-persist",
            step_id="step-persist",
            tool_id="filesystem.list",
            arguments={"path": "."},
            workspace_root=str(ws),
        )
        calls = repo.list_tool_calls_for_step("step-persist")
        assert len(calls) == 1
        assert calls[0].tool_id == "filesystem.list"
