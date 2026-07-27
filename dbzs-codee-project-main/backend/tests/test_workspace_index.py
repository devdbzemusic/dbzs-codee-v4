from pathlib import Path
import uuid

from app.rag.service import RagService, workspace_id


def test_incremental_index_updates_and_deletes_only_changed_files(tmp_path: Path):
    root = tmp_path / f"repo-{uuid.uuid4()}"
    root.mkdir()
    source = root / "service.py"
    source.write_text("def quality_cpu():\n    return 'cpu'\n", encoding="utf-8")
    ignored = root / ".env"
    ignored.write_text("API_KEY=YOUR_API_KEY_HERE", encoding="utf-8")
    service = RagService(tmp_path / f"rag-{uuid.uuid4()}.sqlite3")

    first = service.sync(root)
    second = service.sync(root)
    assert first["changed_files"] == 1
    assert second["changed_files"] == 0
    assert second["chunk_count"] == 1

    source.write_text("def quality_cpu():\n    return 'updated'\n", encoding="utf-8")
    changed = service.sync(root, ["service.py"])
    assert changed["changed_files"] == 1

    source.unlink()
    deleted = service.sync(root, ["service.py"])
    assert deleted["chunk_count"] == 0


def test_codeeignore_and_secret_files_are_excluded(tmp_path: Path):
    root = tmp_path / f"repo-{uuid.uuid4()}"
    root.mkdir()
    (root / ".codeeignore").write_text("generated.ts\n", encoding="utf-8")
    (root / "generated.ts").write_text("export const ignored = true", encoding="utf-8")
    (root / "visible.ts").write_text("export const visible = true", encoding="utf-8")
    service = RagService(tmp_path / f"rag-{uuid.uuid4()}.sqlite3")
    result = service.sync(root)
    assert result["file_count"] == 1
    with service._connect() as conn:
        content = " ".join(row["content"] for row in conn.execute("SELECT content FROM workspace_index"))
    assert "ignored = true" not in content
    assert "visible = true" in content


def test_internal_context_directories_are_excluded(tmp_path: Path):
    root = tmp_path / f"repo-{uuid.uuid4()}"
    root.mkdir()
    for directory in (".codee", "restore-points", "coverage"):
        target = root / directory
        target.mkdir()
        (target / "leak.ts").write_text(f"export const {directory.replace('-', '_')}Leak = true", encoding="utf-8")
    (root / "visible.ts").write_text("export const stringLabVisible = true", encoding="utf-8")

    service = RagService(tmp_path / f"rag-{uuid.uuid4()}.sqlite3")
    result = service.sync(root)

    assert result["file_count"] == 1
    with service._connect() as conn:
        paths = [row["path"] for row in conn.execute("SELECT path FROM workspace_files")]
    assert paths == ["visible.ts"]
