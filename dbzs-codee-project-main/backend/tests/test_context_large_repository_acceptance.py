from datetime import datetime, timezone
from pathlib import Path

from app.rag.models import RetrievalQuery
from app.rag.service import RagService, workspace_id


def test_large_repository_retrieval_meets_context_quality_metrics(tmp_path: Path) -> None:
    root = tmp_path / "large-repository"
    root.mkdir()
    for number in range(250):
        (root / f"noise_{number:03}.py").write_text(f"def unrelated_{number}():\n    return {number}\n", encoding="utf-8")
    (root / "runtime_router.py").write_text(
        "def select_fast_gpu(task_type):\n    return task_type in {'refactoring', 'test_analysis'}\n", encoding="utf-8")
    (root / "test_runtime_router.py").write_text(
        "def test_fast_gpu():\n    assert select_fast_gpu('refactoring')\n", encoding="utf-8")
    service = RagService(tmp_path / "large.sqlite3")
    service.sync(root)
    response = service.retrieve(RetrievalQuery(
        id="large-context", workspace_id=workspace_id(root), workspace_root=str(root),
        query="select_fast_gpu refactoring test_analysis", intent="coding",
        mentioned_symbols=["select_fast_gpu"], max_candidates=30, max_final_items=5,
        token_budget=500, created_at=datetime.now(timezone.utc).isoformat(),
    ))
    paths = {item["source_path"] for item in response["items"]}
    relevant = {"runtime_router.py", "test_runtime_router.py"}
    assert len(paths & relevant) / len(relevant) >= 0.90
    assert len(paths - relevant) / max(1, len(paths)) < 0.30
    assert response["manifest"]["total_tokens"] <= 500
