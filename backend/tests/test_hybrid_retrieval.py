from datetime import datetime, timezone
from pathlib import Path
import uuid

from app.rag.models import EmbeddingUpsert, RetrievalQuery
from app.rag.service import RagService, workspace_id


def test_exact_symbol_bm25_and_token_budget_retrieval(tmp_path: Path):
    root = tmp_path / f"repo-{uuid.uuid4()}"
    root.mkdir()
    (root / "runtimeSlotManager.ts").write_text(
        "export function configuredModelForSlot(slot: string) { return slot === 'quality_cpu'; }",
        encoding="utf-8",
    )
    (root / "runtimeSlotManager.test.ts").write_text(
        "test('quality_cpu slot', () => configuredModelForSlot('quality_cpu'));",
        encoding="utf-8",
    )
    service = RagService(tmp_path / f"rag-{uuid.uuid4()}.sqlite3")
    service.sync(root)
    wid = workspace_id(root)
    response = service.retrieve(RetrievalQuery(
        id="query-1", workspace_id=wid, workspace_root=str(root),
        query="Wo wird quality_cpu configuredModelForSlot konfiguriert?", intent="coding",
        mentioned_paths=["runtimeSlotManager.ts"], mentioned_symbols=["configuredModelForSlot"],
        max_candidates=30, max_final_items=5, token_budget=800,
        created_at=datetime.now(timezone.utc).isoformat(),
    ))
    assert response["items"]
    assert response["items"][0]["source_path"] == "runtimeSlotManager.ts"
    assert response["manifest"]["selected_count"] <= 5
    assert response["manifest"]["total_tokens"] <= 800
    assert response["source_references"][0]["file_path"] == "runtimeSlotManager.ts"

    with service._connect() as conn:
        entry = conn.execute("SELECT id,content_hash,token_count FROM workspace_index WHERE workspace_id=? AND file_path=?", (wid, "runtimeSlotManager.ts")).fetchone()
    probe = EmbeddingUpsert(source_id=entry["id"], content_hash=entry["content_hash"], embedding_model_id="embed-test", vector=[1.0, 0.0], token_count=entry["token_count"])
    assert service.missing_embeddings("embed-test", [probe]) == [entry["id"]]
    service.upsert_embeddings([EmbeddingUpsert(
        source_id=entry["id"], content_hash=entry["content_hash"], embedding_model_id="embed-test",
        vector=[1.0, 0.0], token_count=entry["token_count"],
    )])
    assert service.missing_embeddings("embed-test", [probe]) == []
    semantic = service.retrieve(RetrievalQuery(
        id="query-2", workspace_id=wid, query="unrelated semantic request", intent="coding",
        max_candidates=30, max_final_items=5, token_budget=800,
        created_at=datetime.now(timezone.utc).isoformat(), query_embedding=[1.0, 0.0], embedding_model_id="embed-test",
    ))
    assert semantic["manifest"]["cache_hits"] == 1
    assert semantic["items"][0]["source_path"] == "runtimeSlotManager.ts"
