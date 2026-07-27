from pathlib import Path

from fastapi.testclient import TestClient

import app.api.context_pack as context_pack_api
from app.context_pack.context_cache import ModelContextCacheStore, compute_section_hash, compute_workspace_id
from app.context_pack.models import ContextPackBuildRequest, ContextPackBuildResponse, ModelContextCacheEntry, RepoMap
from app.main import app


def make_store(tmp_path: Path) -> ModelContextCacheStore:
    return ModelContextCacheStore(storage_path=tmp_path / "context_cache.sqlite3")


def make_entry(store: ModelContextCacheStore, **overrides) -> ModelContextCacheEntry:
    defaults = dict(
        model_id="coder",
        role="coding",
        workspace_id="ws-1",
        system_prompt_hash="sph-1",
        tool_contract_hash="tch-1",
        project_memory_hash="pmh-1",
        agents_file_hash="afh-1",
        token_count=1200,
        sections=[],
        created_at="2026-01-01T00:00:00+00:00",
        last_used_at="2026-01-01T00:00:00+00:00",
    )
    defaults.update(overrides)
    key = store.make_key(
        defaults["model_id"],
        defaults["role"],
        defaults["workspace_id"],
        defaults["system_prompt_hash"],
        defaults["tool_contract_hash"],
        defaults["project_memory_hash"],
        defaults.get("architecture_hash") or "",
        defaults.get("agents_file_hash") or "",
    )
    return ModelContextCacheEntry(key=key, **defaults)


def test_compute_section_hash_is_stable_and_content_sensitive() -> None:
    hash_a = compute_section_hash("hello world")
    hash_b = compute_section_hash("hello world")
    hash_c = compute_section_hash("hello WORLD")

    assert hash_a == hash_b
    assert hash_a != hash_c


def test_context_cache_hit_for_same_workspace_role_prompt(tmp_path: Path) -> None:
    """Acceptance test 9: same workspace/role/prompt -> cache hit."""
    store = make_store(tmp_path)
    entry = make_entry(store)
    store.put(entry)

    key = store.make_key(
        entry.model_id, entry.role, entry.workspace_id,
        entry.system_prompt_hash, entry.tool_contract_hash, entry.project_memory_hash,
        entry.architecture_hash or "", entry.agents_file_hash or "",
    )
    hit = store.get(key)

    assert hit is not None
    assert hit.key == entry.key
    assert hit.token_count == entry.token_count


def test_context_cache_miss_for_different_prompt_hash(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    entry = make_entry(store)
    store.put(entry)

    different_key = store.make_key(
        entry.model_id, entry.role, entry.workspace_id,
        "different-system-prompt-hash", entry.tool_contract_hash, entry.project_memory_hash,
        "", entry.agents_file_hash or "",
    )

    assert store.get(different_key) is None


def test_context_cache_invalidated_when_agents_file_changes(tmp_path: Path) -> None:
    """Acceptance test 10: AGENTS.md changed -> hash-based invalidation, not just TTL."""
    store = make_store(tmp_path)
    entry = make_entry(store, agents_file_hash="old-agents-hash")
    store.put(entry)

    invalidated = store.invalidate_by_hash_change(
        workspace_id=entry.workspace_id,
        changed_hash_field="agents_file_hash",
        new_hash="new-agents-hash",
    )

    assert entry.key in invalidated
    assert store.get(entry.key) is None


def test_invalidate_by_hash_change_only_affects_matching_workspace(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    entry_ws1 = make_entry(store, workspace_id="ws-1", agents_file_hash="old-hash")
    entry_ws2 = make_entry(store, workspace_id="ws-2", agents_file_hash="old-hash")
    store.put(entry_ws1)
    store.put(entry_ws2)

    invalidated = store.invalidate_by_hash_change(
        workspace_id="ws-1", changed_hash_field="agents_file_hash", new_hash="new-hash",
    )

    assert invalidated == [entry_ws1.key]
    assert store.get(entry_ws1.key) is None
    assert store.get(entry_ws2.key) is not None


def test_invalidate_by_hash_change_leaves_entries_with_matching_hash(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    entry = make_entry(store, agents_file_hash="current-hash")
    store.put(entry)

    invalidated = store.invalidate_by_hash_change(
        workspace_id=entry.workspace_id, changed_hash_field="agents_file_hash", new_hash="current-hash",
    )

    assert invalidated == []
    assert store.get(entry.key) is not None


def test_clear_removes_all_entries(tmp_path: Path) -> None:
    """Acceptance test 20 (part): cache-clear works end to end."""
    store = make_store(tmp_path)
    store.put(make_entry(store, workspace_id="ws-1"))
    store.put(make_entry(store, workspace_id="ws-2"))

    store.clear()

    data = store._read()
    assert data["entries"] == {}


def test_make_key_is_deterministic_and_input_sensitive(tmp_path: Path) -> None:
    store = make_store(tmp_path)

    key_a = store.make_key("model-1", "chat", "ws-1", "h1", "h2", "h3")
    key_b = store.make_key("model-1", "chat", "ws-1", "h1", "h2", "h3")
    key_c = store.make_key("model-1", "chat", "ws-1", "h1", "h2", "h4")

    assert key_a == key_b
    assert key_a != key_c


def test_context_cache_api_lookup_store_invalidate_clear_roundtrip(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(context_pack_api._cache_store, "storage_path", tmp_path / "context_cache.sqlite3")
    context_pack_api._cache_store._init_db()
    client = TestClient(app)

    lookup_body = {
        "model_id": "coder",
        "role": "coding",
        "workspace_id": "ws-1",
        "system_prompt_hash": "sph",
        "tool_contract_hash": "tch",
        "project_memory_hash": "pmh",
        "agents_file_hash": "afh",
    }

    miss = client.post("/context-pack/cache/lookup", json=lookup_body)
    assert miss.status_code == 404

    key = context_pack_api._cache_store.make_key(
        "coder", "coding", "ws-1", "sph", "tch", "pmh", "", "afh",
    )
    store_body = {
        "key": key,
        "model_id": "coder",
        "role": "coding",
        "workspace_id": "ws-1",
        "system_prompt_hash": "sph",
        "tool_contract_hash": "tch",
        "project_memory_hash": "pmh",
        "agents_file_hash": "afh",
        "token_count": 500,
        "sections": [],
        "created_at": "2026-01-01T00:00:00+00:00",
        "last_used_at": "2026-01-01T00:00:00+00:00",
    }
    stored = client.post("/context-pack/cache/store", json=store_body)
    assert stored.status_code == 204

    hit = client.post("/context-pack/cache/lookup", json=lookup_body)
    assert hit.status_code == 200
    assert hit.json()["key"] == key

    invalidate = client.post(
        "/context-pack/cache/invalidate",
        json={"workspace_id": "ws-1", "changed_hash_field": "agents_file_hash", "new_hash": "new-afh"},
    )
    assert invalidate.status_code == 200
    assert key in invalidate.json()["invalidated"]

    miss_after_invalidate = client.post("/context-pack/cache/lookup", json=lookup_body)
    assert miss_after_invalidate.status_code == 404

    client.post("/context-pack/cache/store", json=store_body)
    cleared = client.post("/context-pack/cache/clear")
    assert cleared.status_code == 204
    miss_after_clear = client.post("/context-pack/cache/lookup", json=lookup_body)
    assert miss_after_clear.status_code == 404


def test_full_context_cache_key_is_deterministic_and_invalidates_each_dimension(tmp_path: Path) -> None:
    store = ModelContextCacheStore(tmp_path / "cache.sqlite3")
    base = dict(workspace_hash="workspace", branch="main", file_hash="file", task_type="review",
                query_fingerprint="query", model_id="coder", context_schema_version=1)
    key = store.make_context_key(**base)
    assert key == store.make_context_key(**base)
    for field, value in {"workspace_hash": "other", "branch": "feature", "file_hash": "changed",
                         "task_type": "debugging", "query_fingerprint": "other-query",
                         "model_id": "reviewer", "context_schema_version": 2}.items():
        changed = {**base, field: value}
        assert store.make_context_key(**changed) != key


def test_store_context_pack_snapshot_persists_fragments(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    request = ContextPackBuildRequest(
        workspace_root=str(tmp_path),
        user_request="Behalte nur den wichtigen Kontext fuer die Reparatur.",
        active_file_path="src/main.ts",
        max_files=10,
        max_bytes_per_file=2000,
        repo_map_token_budget=2000,
    )
    response = ContextPackBuildResponse(
        project_name="demo",
        detected_stack=["typescript", "electron"],
        important_files=["src/main.ts", "README.md"],
        package_files=["package.json"],
        test_files=["src/main.test.ts"],
        source_files_sample=["src/main.ts"],
        todo_markers=["src/main.ts: TODO fix routing"],
        risk_notes=["Prompt verliert Kontext bei langen Verlaeufen"],
        recommended_commands=["pnpm test"],
        markdown_context="# Context Pack: demo\n\n## User Request\n...",
        repo_map=RepoMap(
            root_name="demo",
            files=[],
            entry_points=["src/main.ts"],
            config_files=["package.json"],
            test_files=["src/main.test.ts"],
            git_status=[],
            token_budget=2000,
            estimated_tokens=400,
            truncated=False,
        ),
        metadata={},
    )

    snapshot = store.store_context_pack_snapshot(request, response)
    loaded = store.get_snapshot(snapshot.snapshot_id)

    assert loaded is not None
    assert loaded.workspace_id == compute_workspace_id(str(tmp_path))
    assert loaded.source == "context_pack_build"
    assert any(fragment.fragment_type == "user_request" for fragment in loaded.fragments)
    assert any(fragment.fragment_type == "repo_map" for fragment in loaded.fragments)


def test_context_pack_build_api_persists_snapshot_and_exposes_it(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(context_pack_api._cache_store, "storage_path", tmp_path / "context_cache.sqlite3")
    context_pack_api._cache_store._init_db()
    client = TestClient(app)

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "README.md").write_text("# Demo\n", encoding="utf-8")
    (workspace / "package.json").write_text('{"name":"demo"}\n', encoding="utf-8")
    (workspace / "src").mkdir()
    (workspace / "src" / "main.ts").write_text("export const answer = 42;\n", encoding="utf-8")

    build = client.post(
        "/context-pack/build",
        json={
            "workspace_root": str(workspace),
            "user_request": "Analysiere den Fehler und schrumpfe den Kontext.",
            "active_file_path": "src/main.ts",
            "max_files": 10,
            "max_bytes_per_file": 4000,
            "repo_map_token_budget": 4000,
        },
    )
    assert build.status_code == 200

    workspace_id = compute_workspace_id(str(workspace))
    listed = client.get(f"/context-pack/cache/snapshots?workspace_id={workspace_id}&limit=5")
    assert listed.status_code == 200
    payload = listed.json()
    assert len(payload) >= 1
    assert payload[0]["source"] == "context_pack_build"

    snapshot_id = payload[0]["snapshot_id"]
    detail = client.get(f"/context-pack/cache/snapshots/{snapshot_id}")
    assert detail.status_code == 200
    detail_payload = detail.json()
    assert detail_payload["workspace_id"] == workspace_id
    assert any(fragment["fragment_type"] == "important_files" for fragment in detail_payload["fragments"])
