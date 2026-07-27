from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import json
import sqlite3

from app.core.config import get_app_data_dir
from app.core.sqlite import sqlite_connection
from app.project_memory.models import ProjectMemoryEntry, ProjectMemoryUpsertRequest


class ProjectMemoryService:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or (get_app_data_dir() / "project_memory.sqlite3")
        self._init_db()

    def list_entries(self, workspace: str) -> list[ProjectMemoryEntry]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, workspace, memory_key, content, tags_json, created_at, updated_at
                FROM project_memory
                WHERE workspace = ?
                ORDER BY updated_at DESC, id DESC
                """,
                (workspace,),
            ).fetchall()
        return [self._to_entry(row) for row in rows]

    def upsert_entry(self, request: ProjectMemoryUpsertRequest) -> ProjectMemoryEntry:
        now = _utc_now()
        tags_json = json.dumps(sorted({tag.strip() for tag in request.tags if tag.strip()}))

        with self._connect() as connection:
            existing = connection.execute(
                "SELECT id FROM project_memory WHERE workspace = ? AND memory_key = ?",
                (request.workspace, request.memory_key),
            ).fetchone()

            if existing is None:
                cursor = connection.execute(
                    """
                    INSERT INTO project_memory (workspace, memory_key, content, tags_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (request.workspace, request.memory_key, request.content, tags_json, now, now),
                )
                if cursor.lastrowid is None:
                    raise RuntimeError("Project memory insert did not return row id")
                entry_id = int(cursor.lastrowid)
            else:
                entry_id = int(existing["id"])
                connection.execute(
                    """
                    UPDATE project_memory
                    SET content = ?, tags_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (request.content, tags_json, now, entry_id),
                )

            row = connection.execute(
                """
                SELECT id, workspace, memory_key, content, tags_json, created_at, updated_at
                FROM project_memory
                WHERE id = ?
                """,
                (entry_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("Project memory upsert failed")
        return self._to_entry(row)

    def delete_entry(self, entry_id: int) -> bool:
        with self._connect() as connection:
            result = connection.execute("DELETE FROM project_memory WHERE id = ?", (entry_id,))
        return result.rowcount > 0

    def _init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS project_memory (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace TEXT NOT NULL,
                    memory_key TEXT NOT NULL,
                    content TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(workspace, memory_key)
                )
                """
            )

    def _connect(self):
        return sqlite_connection(self.db_path)

    def _to_entry(self, row: sqlite3.Row) -> ProjectMemoryEntry:
        return ProjectMemoryEntry(
            id=int(row["id"]),
            workspace=str(row["workspace"]),
            memory_key=str(row["memory_key"]),
            content=str(row["content"]),
            tags=_parse_tags(str(row["tags_json"])),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _parse_tags(raw: str) -> list[str]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]
