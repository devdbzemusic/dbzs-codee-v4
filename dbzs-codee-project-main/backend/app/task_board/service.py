from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import json
import sqlite3
import uuid
from typing import cast

from app.core.config import get_app_data_dir
from app.core.sqlite import sqlite_connection
from app.task_board.models import TaskBoardItem, TaskCreateRequest, TaskStatus, TaskUpdateRequest


class TaskBoardService:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or (get_app_data_dir() / "task_board.sqlite3")
        self._init_db()

    def list_tasks(self) -> list[TaskBoardItem]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, title, description, status, priority, created_at, updated_at, job_ids
                FROM task_board
                ORDER BY CASE status
                    WHEN 'in_progress' THEN 1
                    WHEN 'todo' THEN 2
                    WHEN 'done' THEN 3
                    ELSE 4
                END, priority ASC, updated_at DESC
                """
            ).fetchall()
        return [self._to_item(row) for row in rows]

    def create_task(self, request: TaskCreateRequest) -> TaskBoardItem:
        now = _utc_now()
        task_id = f"task_{uuid.uuid4().hex[:10]}"
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO task_board (id, title, description, status, priority, created_at, updated_at)
                VALUES (?, ?, ?, 'todo', ?, ?, ?)
                """,
                (task_id, request.title, request.description, request.priority, now, now),
            )
            row = connection.execute(
                """
                SELECT id, title, description, status, priority, created_at, updated_at, job_ids
                FROM task_board
                WHERE id = ?
                """,
                (task_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("Task creation failed")
        return self._to_item(row)

    def update_task(self, task_id: str, request: TaskUpdateRequest) -> TaskBoardItem:
        current = self.get_task(task_id)
        with self._connect() as connection:
            updated = connection.execute(
                """
                UPDATE task_board
                SET title = ?, description = ?, status = ?, priority = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    request.title if request.title is not None else current.title,
                    request.description if request.description is not None else current.description,
                    request.status if request.status is not None else current.status,
                    request.priority if request.priority is not None else current.priority,
                    _utc_now(),
                    task_id,
                ),
            )
            if updated.rowcount == 0:
                raise KeyError(f"Unknown task: {task_id}")
            row = connection.execute(
                """
                SELECT id, title, description, status, priority, created_at, updated_at, job_ids
                FROM task_board
                WHERE id = ?
                """,
                (task_id,),
            ).fetchone()
        if row is None:
            raise KeyError(f"Unknown task: {task_id}")
        return self._to_item(row)

    def delete_task(self, task_id: str) -> bool:
        with self._connect() as connection:
            result = connection.execute("DELETE FROM task_board WHERE id = ?", (task_id,))
        return result.rowcount > 0

    def get_task(self, task_id: str) -> TaskBoardItem:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, title, description, status, priority, created_at, updated_at, job_ids
                FROM task_board
                WHERE id = ?
                """,
                (task_id,),
            ).fetchone()
        if row is None:
            raise KeyError(f"Unknown task: {task_id}")
        return self._to_item(row)

    def link_job(self, task_id: str, job_id: str) -> TaskBoardItem:
        item = self.get_task(task_id)
        if job_id not in item.job_ids:
            new_ids = [*item.job_ids, job_id]
            with self._connect() as connection:
                connection.execute(
                    "UPDATE task_board SET job_ids = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(new_ids), _utc_now(), task_id),
                )
        return self.get_task(task_id)

    def unlink_job(self, task_id: str, job_id: str) -> TaskBoardItem:
        item = self.get_task(task_id)
        new_ids = [j for j in item.job_ids if j != job_id]
        with self._connect() as connection:
            connection.execute(
                "UPDATE task_board SET job_ids = ?, updated_at = ? WHERE id = ?",
                (json.dumps(new_ids), _utc_now(), task_id),
            )
        return self.get_task(task_id)

    def _init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS task_board (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    status TEXT NOT NULL,
                    priority INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    job_ids TEXT NOT NULL DEFAULT '[]'
                )
                """
            )
            # Migrate existing rows without job_ids column
            columns = {str(row["name"]) for row in connection.execute("PRAGMA table_info(task_board)").fetchall()}
            if "job_ids" not in columns:
                connection.execute("ALTER TABLE task_board ADD COLUMN job_ids TEXT NOT NULL DEFAULT '[]'")

    def _connect(self):
        return sqlite_connection(self.db_path)

    def _to_item(self, row: sqlite3.Row) -> TaskBoardItem:
        try:
            job_ids: list[str] = json.loads(str(row["job_ids"])) if row["job_ids"] else []
        except (json.JSONDecodeError, KeyError):
            job_ids = []
        return TaskBoardItem(
            id=str(row["id"]),
            title=str(row["title"]),
            description=str(row["description"]),
            status=cast(TaskStatus, str(row["status"])),
            priority=int(row["priority"]),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            job_ids=job_ids,
        )


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()
