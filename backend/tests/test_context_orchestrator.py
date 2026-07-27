from pathlib import Path

import pytest

from app.context.models import ContextRequest
from app.context.orchestrator import ContextOrchestrator


def test_context_build_prioritizes_selected_file_and_respects_budget(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "router.ts").write_text("export function routeTask() { return 'fast_gpu'; }", encoding="utf-8")
    (tmp_path / "README.md").write_text("unrelated documentation", encoding="utf-8")
    result = ContextOrchestrator().build(ContextRequest(
        taskId="task-1", taskType="refactoring", userQuery="routeTask router",
        workspaceRoot=str(tmp_path), selectedFiles=["src/router.ts"], maxTokens=1000,
        modelId="coder", slotId="fast_gpu",
    ))
    assert result.items
    assert result.items[0].source_path == "src/router.ts"
    assert result.total_tokens <= 1000
    assert "user_selected" in result.items[0].reasons


def test_context_build_rejects_implicit_slot_fallback(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="requires fast_gpu"):
        ContextOrchestrator().build(ContextRequest(
            taskId="task-2", taskType="debugging", userQuery="fix",
            workspaceRoot=str(tmp_path), maxTokens=1000, modelId="coder", slotId="quality_cpu",
        ))


def test_context_build_includes_selected_file_outside_legacy_cap(tmp_path: Path) -> None:
    for number in range(90):
        (tmp_path / f"a-{number:03}.ts").write_text("export const unrelated = true", encoding="utf-8")
    selected = tmp_path / "z-selected.ts"
    selected.write_text("export const requestedSymbol = 42", encoding="utf-8")
    result = ContextOrchestrator().build(ContextRequest(
        taskId="task-3", taskType="review", userQuery="requestedSymbol",
        workspaceRoot=str(tmp_path), selectedFiles=["z-selected.ts"], maxTokens=512,
        modelId="reviewer", slotId="fast_gpu",
    ))
    assert any(item.source_path == "z-selected.ts" for item in result.items)


def test_context_build_reports_unavailable_explicit_file(tmp_path: Path) -> None:
    result = ContextOrchestrator().build(ContextRequest(
        taskId="task-4", taskType="review", userQuery="missing",
        workspaceRoot=str(tmp_path), selectedFiles=["missing.ts"], maxTokens=512,
        modelId="reviewer", slotId="fast_gpu",
    ))
    assert "explicit_file_unavailable:missing.ts" in result.trace.gaps


def test_context_build_rejects_internal_explicit_file_without_confirmation(tmp_path: Path) -> None:
    internal = tmp_path / ".codee" / "resources"
    internal.mkdir(parents=True)
    (internal / "old.ts").write_text("export const analyzerLeak = true", encoding="utf-8")

    result = ContextOrchestrator().build(ContextRequest(
        taskId="task-internal", taskType="review", userQuery="analyzerLeak",
        workspaceRoot=str(tmp_path), selectedFiles=[".codee/resources/old.ts"], maxTokens=512,
        modelId="reviewer", slotId="fast_gpu",
    ))

    assert not result.items
    assert "policy_excluded:.codee/resources/old.ts" in result.trace.gaps
