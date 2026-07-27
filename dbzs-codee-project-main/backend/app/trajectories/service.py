"""ATIF-light trajectory persistence service."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import get_app_data_dir
from app.trajectories.models import (
    ATIF_LIGHT_SCHEMA_VERSION,
    TrajectoryEvent,
    TrajectoryEventCreate,
)

_default_service: TrajectoryService | None = None


class TrajectoryService:
    """SQLite-backed trajectory event store."""

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or self._default_db_path()
        self._ensure_table()

    def _default_db_path(self) -> str:
        app_data = get_app_data_dir()
        return str(Path(app_data) / "trajectory_events.db")

    def _ensure_table(self) -> None:
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS trajectory_events (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    step_number INTEGER,
                    event_type TEXT NOT NULL,
                    agent_role TEXT,
                    model TEXT,
                    summary TEXT NOT NULL,
                    files_json TEXT NOT NULL DEFAULT '[]',
                    risk_level TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_trajectory_events_job_created
                ON trajectory_events(job_id, created_at DESC)
            """)
            conn.commit()
        finally:
            conn.close()

    def record_event(self, request: TrajectoryEventCreate) -> TrajectoryEvent:
        event_id = f"traj_{uuid.uuid4().hex[:16]}"
        created_at = datetime.now(UTC).isoformat()
        files = request.files or []
        metadata = request.metadata or {}

        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                """
                INSERT INTO trajectory_events
                (id, job_id, step_number, event_type, agent_role, model,
                 summary, files_json, risk_level, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    request.job_id,
                    request.step_number,
                    request.event_type,
                    request.agent_role,
                    request.model,
                    request.summary,
                    json.dumps(files),
                    request.risk_level,
                    json.dumps(metadata),
                    created_at,
                ),
            )
            conn.commit()
        finally:
            conn.close()

        return TrajectoryEvent(
            id=event_id,
            job_id=request.job_id,
            step_number=request.step_number,
            event_type=request.event_type,
            agent_role=request.agent_role,
            model=request.model,
            summary=request.summary,
            files=files,
            risk_level=request.risk_level,
            metadata=metadata,
            created_at=created_at,
        )

    def list_events_for_job(self, job_id: str) -> list[TrajectoryEvent]:
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                SELECT id, job_id, step_number, event_type, agent_role, model,
                       summary, files_json, risk_level, metadata_json, created_at
                FROM trajectory_events
                WHERE job_id = ?
                ORDER BY created_at ASC
                """,
                (job_id,),
            )
            return [self._row_to_event(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def list_recent_events(self, limit: int = 100) -> list[TrajectoryEvent]:
        safe_limit = max(1, min(limit, 500))
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                SELECT id, job_id, step_number, event_type, agent_role, model,
                       summary, files_json, risk_level, metadata_json, created_at
                FROM trajectory_events
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (safe_limit,),
            )
            return [self._row_to_event(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def delete_events_for_job(self, job_id: str) -> bool:
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                "DELETE FROM trajectory_events WHERE job_id = ?",
                (job_id,),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def _row_to_event(self, row: tuple) -> TrajectoryEvent:
        return TrajectoryEvent(
            id=row[0],
            job_id=row[1],
            step_number=row[2],
            event_type=row[3],
            agent_role=row[4],
            model=row[5],
            summary=row[6],
            files=json.loads(row[7] or "[]"),
            risk_level=row[8],
            metadata=json.loads(row[9] or "{}"),
            created_at=row[10],
        )


def get_trajectory_service() -> TrajectoryService:
    global _default_service
    if _default_service is None:
        _default_service = TrajectoryService()
    return _default_service


def reset_trajectory_service() -> None:
    """Reset singleton — for tests."""
    global _default_service
    _default_service = None
