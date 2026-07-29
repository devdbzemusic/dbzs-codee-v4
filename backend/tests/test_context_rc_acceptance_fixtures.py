from datetime import datetime, timezone
from pathlib import Path

from app.agent_workbench.models import AgentRun
from app.agent_workbench.task_manifest import TaskManifestStore
from app.context.models import ContextRequest
from app.context.orchestrator import ContextOrchestrator
from app.rag.models import RetrievalQuery
from app.rag.service import RagService, workspace_id


def test_conflicting_evidence_prioritizes_tests(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("router always uses quality_cpu", encoding="utf-8")
    (tmp_path / "router.ts").write_text("export const route = () => 'fast_gpu';", encoding="utf-8")
    (tmp_path / "router.test.ts").write_text("test('route', () => expect(route()).toBe('fast_gpu'));", encoding="utf-8")
    result = ContextOrchestrator().build(ContextRequest(
        taskId="conflict", taskType="test_analysis", userQuery="router route fast_gpu",
        workspaceRoot=str(tmp_path), maxTokens=1200, modelId="reviewer", slotId="fast_gpu"))
    assert any(item.kind == "test" and item.trust_score == 0.95 for item in result.items)


def test_architecture_change_finds_interface_config_tests_and_docs(tmp_path: Path) -> None:
    files = {"contract.ts": "export interface Provider { run(): void }", "provider.ts": "import { Provider } from './contract'",
             "provider.test.ts": "test('provider', () => true)", "config.json": '{"provider":"local"}',
             "README.md": "Provider architecture migration"}
    for name, content in files.items(): (tmp_path / name).write_text(content, encoding="utf-8")
    service = RagService(tmp_path / "rag.sqlite3"); service.sync(tmp_path)
    response = service.retrieve(RetrievalQuery(id="arch", workspace_id=workspace_id(tmp_path), query="Provider architecture migration config test",
        intent="planning", max_candidates=30, max_final_items=8, token_budget=1000, created_at=datetime.now(timezone.utc).isoformat()))
    paths = {item["source_path"] for item in response["items"]}
    assert {"contract.ts", "provider.test.ts", "config.json", "README.md"}.issubset(paths)


def test_resume_detects_external_change_and_accepts_revalidated_snapshot(tmp_path: Path) -> None:
    source = tmp_path / "source.py"; source.write_text("value=1", encoding="utf-8")
    run = AgentRun(id="resume", workspace_root=str(tmp_path), workspace_name="fixture", goal="change", status="paused",
        execution_mode="supervised", provider="local", model_id="coder", max_steps=5, created_at="now", updated_at="now")
    store = TaskManifestStore(); store.materialize(run, [])
    source.write_text("value=2", encoding="utf-8"); assert store.validate(run) == ["source.py"]
    store.materialize(run, []); assert store.validate(run) == []


def test_parallel_slots_are_independent_contracts() -> None:
    from app.runtime.slot_contract import load_slot_contract
    slots = load_slot_contract()["slots"]
    assert {slot["port"] for slot in slots} == {8081, 8082, 8083, 8084, 8085}
    assert {slot["id"] for slot in slots} == {"quality_cpu", "fast_gpu", "utility", "orchestrator_cpu", "vision_gpu"}
