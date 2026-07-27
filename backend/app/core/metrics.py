"""Metrics Collector — Performance & Error Tracking."""

from __future__ import annotations

import sqlite3
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class MetricsCollector:
    """Sammelt Performance-Metriken und Errors."""

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or self._default_db_path()
        self._ensure_table()

    def _default_db_path(self) -> str:
        """Default SQLite-Pfad für Metriken."""
        from app.config import get_app_data_dir
        app_data = get_app_data_dir()
        return str(Path(app_data) / "metrics.db")

    def _ensure_table(self) -> None:
        """Erstellt metrics Tabelle."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    category TEXT NOT NULL,
                    name TEXT NOT NULL,
                    value REAL,
                    metadata TEXT
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_metrics_category 
                ON metrics(category, timestamp)
            """)
            conn.commit()
        finally:
            conn.close()

    def record_job_duration(self, job_id: str, seconds: float, success: bool = True) -> None:
        """Zeichnet Job-Dauer auf."""
        self._record(
            category="jobs",
            name="job_duration",
            value=seconds,
            metadata={"job_id": job_id, "success": success},
        )

    def record_llm_latency(self, provider: str, ms: float, model: str | None = None) -> None:
        """Zeichnet LLM-Latenz auf."""
        self._record(
            category="llm",
            name="latency_ms",
            value=ms,
            metadata={"provider": provider, "model": model},
        )

    def record_token_count(self, provider: str, tokens: int, direction: str = "output") -> None:
        """Zeichnet Token-Verbrauch auf."""
        self._record(
            category="llm",
            name="token_count",
            value=tokens,
            metadata={"provider": provider, "direction": direction},
        )

    def record_error(self, category: str, error_type: str, message: str) -> None:
        """Zeichnet Error auf."""
        self._record(
            category="errors",
            name=error_type,
            value=1,
            metadata={"category": category, "message": message[:500]},
        )

    def record_agent_step(self, agent_id: str, step: int, duration_ms: float) -> None:
        """Zeichnet Agent-Step auf."""
        self._record(
            category="agents",
            name="step_duration_ms",
            value=duration_ms,
            metadata={"agent_id": agent_id, "step": step},
        )

    def _record(self, category: str, name: str, value: float | None, metadata: dict[str, Any]) -> None:
        """Interne Record-Methode."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                """
                INSERT INTO metrics (timestamp, category, name, value, metadata)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(UTC).isoformat(),
                    category,
                    name,
                    value,
                    json.dumps(metadata),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def get_job_stats(self, hours: int = 24) -> dict:
        """Job-Statistiken für letzte N Stunden."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                SELECT 
                    COUNT(*) as total_jobs,
                    AVG(value) as avg_duration,
                    MIN(value) as min_duration,
                    MAX(value) as max_duration
                FROM metrics
                WHERE category = 'jobs'
                  AND name = 'job_duration'
                  AND timestamp >= datetime('now', ?)
                """,
                (f"-{hours} hours",),
            )
            row = cursor.fetchone()
            return {
                "total_jobs": row[0] or 0,
                "avg_duration_seconds": row[1] or 0,
                "min_duration_seconds": row[2] or 0,
                "max_duration_seconds": row[3] or 0,
            }
        finally:
            conn.close()

    def get_llm_stats(self, provider: str | None = None, hours: int = 24) -> dict:
        """LLM-Statistiken."""
        conn = sqlite3.connect(self.db_path)
        try:
            base_query = """
                SELECT AVG(value), SUM(CASE WHEN name = 'token_count' THEN value ELSE 0 END)
                FROM metrics
                WHERE category = 'llm'
                  AND name = 'latency_ms'
                  AND timestamp >= datetime('now', ?)
            """
            params = [f"-{hours} hours"]
            
            if provider:
                base_query += " AND metadata LIKE ?"
                params.append(f'%{provider}%')

            cursor = conn.execute(base_query, params)
            row = cursor.fetchone()
            return {
                "avg_latency_ms": row[0] or 0,
                "total_tokens": row[1] or 0,
            }
        finally:
            conn.close()

    def get_error_count(self, hours: int = 24) -> int:
        """Error-Anzahl für letzte N Stunden."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                SELECT COUNT(*)
                FROM metrics
                WHERE category = 'errors'
                  AND timestamp >= datetime('now', ?)
                """,
                (f"-{hours} hours",),
            )
            return cursor.fetchone()[0] or 0
        finally:
            conn.close()

    def cleanup_old(self, days: int = 30) -> int:
        """Löscht alte Metriken."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                DELETE FROM metrics
                WHERE timestamp < datetime('now', ?)
                """,
                (f"-{days} days",),
            )
            deleted = cursor.rowcount
            conn.commit()
            return deleted
        finally:
            conn.close()
