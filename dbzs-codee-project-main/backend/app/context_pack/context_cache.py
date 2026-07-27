"""SQLite-backed model context cache and persistent context snapshots."""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

from app.context_pack.models import (
    ContextPackBuildRequest,
    ContextPackBuildResponse,
    ModelContextCacheEntry,
    PersistentContextFragment,
    PersistentContextSnapshot,
    PersistentContextSnapshotSummary,
)
from app.core.config import get_app_data_dir
from app.core.sqlite import sqlite_connection
from app.rag.service import estimate_tokens, now_iso

logger = logging.getLogger(__name__)


def compute_section_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def compute_workspace_id(workspace_root: str) -> str:
    normalized = str(Path(workspace_root).resolve()).lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]


def _default_storage_path() -> Path:
    return get_app_data_dir() / "context_cache.sqlite3"


def _legacy_storage_path() -> Path:
    return get_app_data_dir() / "context_cache.json"


class ModelContextCacheStore:
    def __init__(self, storage_path: Path | None = None) -> None:
        self.storage_path = storage_path or _default_storage_path()
        self._init_db()
        self._migrate_legacy_json_if_needed()

    def make_key(self, model_id: str, role: str, workspace_id: str, *hashes: str) -> str:
        payload = "|".join([model_id, role, workspace_id, *hashes])
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def make_context_key(
        self,
        *,
        workspace_hash: str,
        branch: str,
        file_hash: str,
        task_type: str,
        query_fingerprint: str,
        model_id: str,
        context_schema_version: int,
    ) -> str:
        payload = {
            "workspace_hash": workspace_hash,
            "branch": branch,
            "file_hash": file_hash,
            "task_type": task_type,
            "query_fingerprint": query_fingerprint,
            "model_id": model_id,
            "context_schema_version": context_schema_version,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    def _init_db(self) -> None:
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite_connection(self.storage_path, foreign_keys=True) as conn:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS context_cache_entries(
                    key TEXT PRIMARY KEY,
                    model_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    workspace_id TEXT NOT NULL,
                    system_prompt_hash TEXT NOT NULL,
                    tool_contract_hash TEXT NOT NULL,
                    project_memory_hash TEXT NOT NULL,
                    architecture_hash TEXT,
                    agents_file_hash TEXT,
                    workspace_hash TEXT NOT NULL DEFAULT '',
                    branch TEXT NOT NULL DEFAULT '',
                    file_hash TEXT NOT NULL DEFAULT '',
                    task_type TEXT NOT NULL DEFAULT '',
                    query_fingerprint TEXT NOT NULL DEFAULT '',
                    context_schema_version INTEGER NOT NULL DEFAULT 1,
                    token_count INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    last_used_at TEXT NOT NULL,
                    expires_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_context_cache_workspace
                    ON context_cache_entries(workspace_id, role, model_id);
                CREATE TABLE IF NOT EXISTS context_cache_sections(
                    entry_key TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    source TEXT NOT NULL,
                    token_count INTEGER NOT NULL,
                    priority INTEGER NOT NULL,
                    cached INTEGER NOT NULL DEFAULT 0,
                    truncated INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(entry_key, ordinal),
                    FOREIGN KEY(entry_key) REFERENCES context_cache_entries(key) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS persistent_context_snapshots(
                    snapshot_id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    cache_key TEXT,
                    source TEXT NOT NULL,
                    token_count INTEGER NOT NULL,
                    fragment_count INTEGER NOT NULL,
                    model_id TEXT,
                    role TEXT,
                    task_type TEXT NOT NULL DEFAULT '',
                    query_fingerprint TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    summary_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_context_snapshots_workspace
                    ON persistent_context_snapshots(workspace_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS persistent_context_fragments(
                    fragment_id TEXT PRIMARY KEY,
                    snapshot_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    fragment_type TEXT NOT NULL,
                    source TEXT NOT NULL,
                    content_text TEXT NOT NULL,
                    token_count INTEGER NOT NULL,
                    priority INTEGER NOT NULL DEFAULT 0,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    last_used_at TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    FOREIGN KEY(snapshot_id) REFERENCES persistent_context_snapshots(snapshot_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_context_fragments_snapshot
                    ON persistent_context_fragments(snapshot_id, ordinal);
                """
            )

    def _migrate_legacy_json_if_needed(self) -> None:
        legacy_path = _legacy_storage_path()
        if self.storage_path == legacy_path or not legacy_path.exists():
            return
        with sqlite_connection(self.storage_path, foreign_keys=True) as conn:
            row = conn.execute("SELECT COUNT(*) AS count FROM context_cache_entries").fetchone()
            if row and row["count"] > 0:
                return
        try:
            data = json.loads(legacy_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Legacy context cache migration skipped: %s", exc)
            return
        entries = data.get("entries")
        if not isinstance(entries, dict):
            return
        for raw in entries.values():
            try:
                self.put(ModelContextCacheEntry.model_validate(raw))
            except Exception as exc:
                logger.warning("Legacy context cache entry migration skipped: %s", exc)

    def _read(self) -> dict:
        with sqlite_connection(self.storage_path, foreign_keys=True) as conn:
            rows = conn.execute("SELECT key FROM context_cache_entries").fetchall()
        return {"entries": {row["key"]: True for row in rows}}

    def _row_to_entry(self, row, section_rows) -> ModelContextCacheEntry:
        return ModelContextCacheEntry(
            key=row["key"],
            model_id=row["model_id"],
            role=row["role"],
            workspace_id=row["workspace_id"],
            system_prompt_hash=row["system_prompt_hash"],
            tool_contract_hash=row["tool_contract_hash"],
            project_memory_hash=row["project_memory_hash"],
            architecture_hash=row["architecture_hash"],
            agents_file_hash=row["agents_file_hash"],
            workspace_hash=row["workspace_hash"],
            branch=row["branch"],
            file_hash=row["file_hash"],
            task_type=row["task_type"],
            query_fingerprint=row["query_fingerprint"],
            context_schema_version=row["context_schema_version"],
            token_count=row["token_count"],
            sections=[
                {
                    "type": section["type"],
                    "source": section["source"],
                    "token_count": section["token_count"],
                    "priority": section["priority"],
                    "cached": bool(section["cached"]),
                    "truncated": bool(section["truncated"]),
                }
                for section in section_rows
            ],
            created_at=row["created_at"],
            last_used_at=row["last_used_at"],
            expires_at=row["expires_at"],
        )

    def get(self, key: str) -> ModelContextCacheEntry | None:
        with sqlite_connection(self.storage_path, foreign_keys=True) as conn:
            row = conn.execute("SELECT * FROM context_cache_entries WHERE key=?", (key,)).fetchone()
            if row is None:
                return None
            section_rows = conn.execute(
                "SELECT * FROM context_cache_sections WHERE entry_key=? ORDER BY ordinal",
                (key,),
            ).fetchall()
            conn.execute(
                "UPDATE context_cache_entries SET last_used_at=? WHERE key=?",
                (now_iso(), key),
            )
        return self._row_to_entry(row, section_rows)

    def put(self, entry: ModelContextCacheEntry) -> None:
        with sqlite_connection(self.storage_path, foreign_keys=True) as conn:
            conn.execute(
                """
                INSERT INTO context_cache_entries(
                    key, model_id, role, workspace_id, system_prompt_hash, tool_contract_hash,
                    project_memory_hash, architecture_hash, agents_file_hash, workspace_hash, branch,
                    file_hash, task_type, query_fingerprint, context_schema_version, token_count,
                    created_at, last_used_at, expires_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(key) DO UPDATE SET
                    model_id=excluded.model_id,
                    role=excluded.role,
                    workspace_id=excluded.workspace_id,
                    system_prompt_hash=excluded.system_prompt_hash,
                    tool_contract_hash=excluded.tool_contract_hash,
                    project_memory_hash=excluded.project_memory_hash,
                    architecture_hash=excluded.architecture_hash,
                    agents_file_hash=excluded.agents_file_hash,
                    workspace_hash=excluded.workspace_hash,
                    branch=excluded.branch,
                    file_hash=excluded.file_hash,
                    task_type=excluded.task_type,
                    query_fingerprint=excluded.query_fingerprint,
                    context_schema_version=excluded.context_schema_version,
                    token_count=excluded.token_count,
                    created_at=excluded.created_at,
                    last_used_at=excluded.last_used_at,
                    expires_at=excluded.expires_at
                """,
                (
                    entry.key,
                    entry.model_id,
                    entry.role,
                    entry.workspace_id,
                    entry.system_prompt_hash,
                    entry.tool_contract_hash,
                    entry.project_memory_hash,
                    entry.architecture_hash,
                    entry.agents_file_hash,
                    entry.workspace_hash,
                    entry.branch,
                    entry.file_hash,
                    entry.task_type,
                    entry.query_fingerprint,
                    entry.context_schema_version,
                    entry.token_count,
                    entry.created_at,
                    entry.last_used_at,
                    entry.expires_at,
                ),
            )
            conn.execute("DELETE FROM context_cache_sections WHERE entry_key=?", (entry.key,))
            for index, section in enumerate(entry.sections):
                conn.execute(
                    """
                    INSERT INTO context_cache_sections(
                        entry_key, ordinal, type, source, token_count, priority, cached, truncated
                    ) VALUES(?,?,?,?,?,?,?,?)
                    """,
                    (
                        entry.key,
                        index,
                        section.type,
                        section.source,
                        section.token_count,
                        section.priority,
                        int(section.cached),
                        int(section.truncated),
                    ),
                )
            self._insert_snapshot(
                conn,
                snapshot_id=self._snapshot_id(entry.workspace_id, entry.key, entry.created_at, "cache_entry"),
                workspace_id=entry.workspace_id,
                cache_key=entry.key,
                source="context_cache_store",
                token_count=entry.token_count,
                model_id=entry.model_id,
                role=entry.role,
                task_type=entry.task_type,
                query_fingerprint=entry.query_fingerprint,
                created_at=entry.created_at,
                fragments=[
                    PersistentContextFragment(
                        fragment_id=self._fragment_id(entry.key, str(index), section.source),
                        fragment_type=section.type,
                        source=section.source,
                        content_text=f"{section.type}: {section.source}",
                        token_count=section.token_count,
                        priority=section.priority,
                        pinned=section.priority >= 80,
                        created_at=entry.created_at,
                        last_used_at=entry.last_used_at,
                        metadata={
                            "cached": section.cached,
                            "truncated": section.truncated,
                        },
                    )
                    for index, section in enumerate(entry.sections)
                ],
                summary={
                    "section_count": len(entry.sections),
                    "hashes": {
                        "system_prompt_hash": entry.system_prompt_hash,
                        "tool_contract_hash": entry.tool_contract_hash,
                        "project_memory_hash": entry.project_memory_hash,
                        "architecture_hash": entry.architecture_hash,
                        "agents_file_hash": entry.agents_file_hash,
                    },
                },
            )

    def invalidate_by_hash_change(
        self,
        workspace_id: str,
        changed_hash_field: str,
        new_hash: str,
    ) -> list[str]:
        allowed_fields = {
            "system_prompt_hash",
            "tool_contract_hash",
            "project_memory_hash",
            "architecture_hash",
            "agents_file_hash",
            "workspace_hash",
            "branch",
            "file_hash",
            "task_type",
            "query_fingerprint",
        }
        if changed_hash_field not in allowed_fields:
            return []
        with sqlite_connection(self.storage_path, foreign_keys=True) as conn:
            rows = conn.execute(
                f"SELECT key FROM context_cache_entries WHERE workspace_id=? AND COALESCE({changed_hash_field}, '') != ?",
                (workspace_id, new_hash),
            ).fetchall()
            invalidated = [row["key"] for row in rows]
            if invalidated:
                conn.executemany("DELETE FROM context_cache_entries WHERE key=?", [(key,) for key in invalidated])
        return invalidated

    def clear(self) -> None:
        with sqlite_connection(self.storage_path, foreign_keys=True) as conn:
            conn.execute("DELETE FROM context_cache_entries")
            conn.execute("DELETE FROM persistent_context_snapshots")

    def store_context_pack_snapshot(
        self,
        request: ContextPackBuildRequest,
        response: ContextPackBuildResponse,
    ) -> PersistentContextSnapshot:
        workspace_id = compute_workspace_id(request.workspace_root)
        created_at = now_iso()
        fragments = self._build_context_pack_fragments(request, response, created_at)
        snapshot = PersistentContextSnapshot(
            snapshot_id=self._snapshot_id(workspace_id, request.user_request, created_at, "context_pack"),
            workspace_id=workspace_id,
            cache_key=None,
            source="context_pack_build",
            token_count=sum(fragment.token_count for fragment in fragments),
            fragment_count=len(fragments),
            model_id=None,
            role=None,
            task_type="context_pack",
            query_fingerprint=compute_section_hash(request.user_request)[:24],
            created_at=created_at,
            summary={
                "project_name": response.project_name,
                "active_file_path": request.active_file_path,
                "detected_stack": response.detected_stack[:8],
                "important_files": response.important_files[:10],
                "risk_notes": response.risk_notes[:10],
                "repo_map_files": len(response.repo_map.files),
                "repo_map_truncated": response.repo_map.truncated,
            },
            fragments=fragments,
        )
        with sqlite_connection(self.storage_path, foreign_keys=True) as conn:
            self._insert_snapshot(
                conn,
                snapshot_id=snapshot.snapshot_id,
                workspace_id=snapshot.workspace_id,
                cache_key=None,
                source=snapshot.source,
                token_count=snapshot.token_count,
                model_id=None,
                role=None,
                task_type=snapshot.task_type,
                query_fingerprint=snapshot.query_fingerprint,
                created_at=snapshot.created_at,
                fragments=snapshot.fragments,
                summary=snapshot.summary,
            )
        return snapshot

    def list_snapshots(self, workspace_id: str, limit: int = 20) -> list[PersistentContextSnapshotSummary]:
        with sqlite_connection(self.storage_path, foreign_keys=True) as conn:
            rows = conn.execute(
                """
                SELECT snapshot_id, workspace_id, cache_key, source, token_count, fragment_count,
                       model_id, role, task_type, query_fingerprint, created_at, summary_json
                FROM persistent_context_snapshots
                WHERE workspace_id=?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (workspace_id, max(1, min(limit, 100))),
            ).fetchall()
        return [self._row_to_snapshot_summary(row) for row in rows]

    def get_snapshot(self, snapshot_id: str) -> PersistentContextSnapshot | None:
        with sqlite_connection(self.storage_path, foreign_keys=True) as conn:
            row = conn.execute(
                """
                SELECT snapshot_id, workspace_id, cache_key, source, token_count, fragment_count,
                       model_id, role, task_type, query_fingerprint, created_at, summary_json
                FROM persistent_context_snapshots
                WHERE snapshot_id=?
                """,
                (snapshot_id,),
            ).fetchone()
            if row is None:
                return None
            fragment_rows = conn.execute(
                """
                SELECT fragment_id, fragment_type, source, content_text, token_count, priority, pinned,
                       created_at, last_used_at, metadata_json
                FROM persistent_context_fragments
                WHERE snapshot_id=?
                ORDER BY ordinal
                """,
                (snapshot_id,),
            ).fetchall()
        return PersistentContextSnapshot(
            **self._row_to_snapshot_summary(row).model_dump(),
            fragments=[
                PersistentContextFragment(
                    fragment_id=fragment["fragment_id"],
                    fragment_type=fragment["fragment_type"],
                    source=fragment["source"],
                    content_text=fragment["content_text"],
                    token_count=fragment["token_count"],
                    priority=fragment["priority"],
                    pinned=bool(fragment["pinned"]),
                    created_at=fragment["created_at"],
                    last_used_at=fragment["last_used_at"],
                    metadata=json.loads(fragment["metadata_json"]),
                )
                for fragment in fragment_rows
            ],
        )

    def _row_to_snapshot_summary(self, row) -> PersistentContextSnapshotSummary:
        return PersistentContextSnapshotSummary(
            snapshot_id=row["snapshot_id"],
            workspace_id=row["workspace_id"],
            cache_key=row["cache_key"],
            source=row["source"],
            token_count=row["token_count"],
            fragment_count=row["fragment_count"],
            model_id=row["model_id"],
            role=row["role"],
            task_type=row["task_type"],
            query_fingerprint=row["query_fingerprint"],
            created_at=row["created_at"],
            summary=json.loads(row["summary_json"]),
        )

    def _insert_snapshot(
        self,
        conn,
        *,
        snapshot_id: str,
        workspace_id: str,
        cache_key: str | None,
        source: str,
        token_count: int,
        model_id: str | None,
        role: str | None,
        task_type: str,
        query_fingerprint: str,
        created_at: str,
        fragments: list[PersistentContextFragment],
        summary: dict,
    ) -> None:
        conn.execute("DELETE FROM persistent_context_snapshots WHERE snapshot_id=?", (snapshot_id,))
        conn.execute(
            """
            INSERT INTO persistent_context_snapshots(
                snapshot_id, workspace_id, cache_key, source, token_count, fragment_count,
                model_id, role, task_type, query_fingerprint, created_at, summary_json
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                snapshot_id,
                workspace_id,
                cache_key,
                source,
                token_count,
                len(fragments),
                model_id,
                role,
                task_type,
                query_fingerprint,
                created_at,
                json.dumps(summary, ensure_ascii=False),
            ),
        )
        for index, fragment in enumerate(fragments):
            conn.execute(
                """
                INSERT INTO persistent_context_fragments(
                    fragment_id, snapshot_id, ordinal, fragment_type, source, content_text,
                    token_count, priority, pinned, created_at, last_used_at, metadata_json
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    fragment.fragment_id,
                    snapshot_id,
                    index,
                    fragment.fragment_type,
                    fragment.source,
                    fragment.content_text,
                    fragment.token_count,
                    fragment.priority,
                    int(fragment.pinned),
                    fragment.created_at,
                    fragment.last_used_at,
                    json.dumps(fragment.metadata, ensure_ascii=False),
                ),
            )

    def _build_context_pack_fragments(
        self,
        request: ContextPackBuildRequest,
        response: ContextPackBuildResponse,
        created_at: str,
    ) -> list[PersistentContextFragment]:
        def fragment(fragment_type: str, source: str, content: str, priority: int, pinned: bool = False, metadata: dict | None = None) -> PersistentContextFragment:
            compact = content.strip()[:4000]
            return PersistentContextFragment(
                fragment_id=self._fragment_id(request.workspace_root, fragment_type, source),
                fragment_type=fragment_type,
                source=source,
                content_text=compact,
                token_count=estimate_tokens(compact),
                priority=priority,
                pinned=pinned,
                created_at=created_at,
                last_used_at=created_at,
                metadata=metadata or {},
            )

        fragments = [
            fragment("user_request", "request.user_request", request.user_request, 100, True),
        ]
        if request.active_file_path:
            fragments.append(fragment("active_file", "request.active_file_path", request.active_file_path, 95, True))
        if response.detected_stack:
            fragments.append(fragment("detected_stack", "response.detected_stack", "\n".join(response.detected_stack[:12]), 80, True))
        if response.important_files:
            fragments.append(fragment("important_files", "response.important_files", "\n".join(response.important_files[:20]), 85, True))
        if response.test_files:
            fragments.append(fragment("test_files", "response.test_files", "\n".join(response.test_files[:20]), 60))
        if response.todo_markers:
            fragments.append(fragment("todo_markers", "response.todo_markers", "\n".join(response.todo_markers[:15]), 70))
        if response.risk_notes:
            fragments.append(fragment("risk_notes", "response.risk_notes", "\n".join(response.risk_notes[:15]), 75, True))
        if response.recommended_commands:
            fragments.append(fragment("recommended_commands", "response.recommended_commands", "\n".join(response.recommended_commands[:10]), 55))
        repo_summary = json.dumps(
            {
                "files": [item.path for item in response.repo_map.files[:25]],
                "entry_points": response.repo_map.entry_points[:10],
                "config_files": response.repo_map.config_files[:10],
                "git_status": response.repo_map.git_status[:20],
                "truncated": response.repo_map.truncated,
            },
            ensure_ascii=False,
        )
        fragments.append(fragment("repo_map", "response.repo_map", repo_summary, 65, metadata={"estimated_tokens": response.repo_map.estimated_tokens}))
        fragments.append(
            fragment(
                "markdown_context",
                "response.markdown_context",
                response.markdown_context[:4000],
                50,
                metadata={"full_length": len(response.markdown_context)},
            )
        )
        return fragments

    @staticmethod
    def _snapshot_id(workspace_id: str, seed: str, created_at: str, kind: str) -> str:
        value = f"{kind}|{workspace_id}|{seed}|{created_at}"
        return f"ctxsnap-{hashlib.sha256(value.encode('utf-8')).hexdigest()[:24]}"

    @staticmethod
    def _fragment_id(*parts: str) -> str:
        return f"ctxfrag-{hashlib.sha256('|'.join(parts).encode('utf-8')).hexdigest()[:24]}"
