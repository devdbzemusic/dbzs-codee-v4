"""Audit Logging — Nachvollziehbarkeit von Agent-Actions."""

from __future__ import annotations

import sqlite3
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal


AuditAction = Literal[
    "job_started",
    "job_completed",
    "job_failed",
    "patch_proposed",
    "patch_applied",
    "patch_rejected",
    "review_approved",
    "review_rejected",
    "file_read",
    "file_written",
    "command_executed",
    "tool_called",
]


class AuditLogger:
    """Audit-Logger für Agent-Actions."""

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or self._default_db_path()
        self._ensure_table()

    def _default_db_path(self) -> str:
        """Default SQLite-Pfad für Audit-Logs."""
        from app.config import get_app_data_dir
        app_data = get_app_data_dir()
        return str(Path(app_data) / "audit_log.db")

    def _ensure_table(self) -> None:
        """Erstellt audit_log Tabelle."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    agent_id TEXT,
                    job_id TEXT,
                    action TEXT NOT NULL,
                    workspace TEXT,
                    details TEXT,
                    risk_level TEXT
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_audit_timestamp 
                ON audit_log(timestamp)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_audit_agent 
                ON audit_log(agent_id)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_audit_job 
                ON audit_log(job_id)
            """)
            conn.commit()
        finally:
            conn.close()

    def log(
        self,
        action: AuditAction,
        agent_id: str | None = None,
        job_id: str | None = None,
        workspace: str | None = None,
        details: dict[str, Any] | None = None,
        risk_level: str = "info",
    ) -> int:
        """
        Loggt eine Agent-Action.

        Args:
            action: Art der Aktion (siehe AuditAction)
            agent_id: ID des Agenten
            job_id: ID des Jobs
            workspace: Workspace-Pfad
            details: Zusätzliche Details als Dict
            risk_level: "info", "low", "medium", "high"

        Returns:
            ID des eingefügten Log-Eintrags
        """
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                INSERT INTO audit_log
                (timestamp, agent_id, job_id, action, workspace, details, risk_level)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(UTC).isoformat(),
                    agent_id,
                    job_id,
                    action,
                    workspace,
                    json.dumps(details or {}),
                    risk_level,
                ),
            )
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def log_job_started(self, job_id: str, agent_id: str, workspace: str) -> int:
        """Loggt Job-Start."""
        return self.log(
            action="job_started",
            agent_id=agent_id,
            job_id=job_id,
            workspace=workspace,
            details={"agent_id": agent_id},
        )

    def log_job_completed(self, job_id: str, agent_id: str, success: bool) -> int:
        """Loggt Job-Abschluss."""
        return self.log(
            action="job_completed" if success else "job_failed",
            agent_id=agent_id,
            job_id=job_id,
            details={"success": success},
            risk_level="info" if success else "medium",
        )

    def log_patch_proposed(
        self,
        job_id: str,
        agent_id: str,
        file_path: str,
        risk_level: str = "medium",
    ) -> int:
        """Loggt Patch-Vorschlag."""
        return self.log(
            action="patch_proposed",
            agent_id=agent_id,
            job_id=job_id,
            details={"file_path": file_path},
            risk_level=risk_level,
        )

    def log_patch_applied(
        self,
        job_id: str,
        agent_id: str,
        file_path: str,
        auto_applied: bool = False,
    ) -> int:
        """Loggt angewendeten Patch."""
        return self.log(
            action="patch_applied",
            agent_id=agent_id,
            job_id=job_id,
            details={"file_path": file_path, "auto_applied": auto_applied},
            risk_level="low" if auto_applied else "medium",
        )

    def log_review_decision(
        self,
        gate_id: str,
        job_id: str,
        agent_id: str,
        approved: bool,
        reviewer: str,
    ) -> int:
        """Loggt Review-Entscheidung."""
        return self.log(
            action="review_approved" if approved else "review_rejected",
            agent_id=agent_id,
            job_id=job_id,
            details={"gate_id": gate_id, "reviewer": reviewer},
            risk_level="low",
        )

    def log_file_access(
        self,
        agent_id: str,
        file_path: str,
        operation: str = "read",
    ) -> int:
        """Loggt Datei-Zugriff."""
        action: AuditAction = "file_read" if operation == "read" else "file_written"
        return self.log(
            action=action,
            agent_id=agent_id,
            details={"file_path": file_path, "operation": operation},
            risk_level="low",
        )

    def log_command_execution(
        self,
        agent_id: str,
        command: str,
        workspace: str,
        success: bool,
    ) -> int:
        """Loggt Kommando-Ausführung."""
        return self.log(
            action="command_executed",
            agent_id=agent_id,
            workspace=workspace,
            details={"command": command[:200], "success": success},
            risk_level="medium" if success else "high",
        )

    def log_tool_call(
        self,
        agent_id: str,
        tool_id: str,
        params: dict[str, Any],
        success: bool,
    ) -> int:
        """Loggt Tool-Aufruf."""
        return self.log(
            action="tool_called",
            agent_id=agent_id,
            details={"tool_id": tool_id, "params": params, "success": success},
            risk_level="low" if success else "medium",
        )

    def get_logs(
        self,
        agent_id: str | None = None,
        job_id: str | None = None,
        limit: int = 100,
        hours: int = 24,
    ) -> list[dict]:
        """
        Ruft Audit-Logs ab.

        Args:
            agent_id: Filter nach Agent
            job_id: Filter nach Job
            limit: Maximale Anzahl Einträge
            hours: Nur letzte N Stunden

        Returns:
            Liste von Log-Einträgen als Dicts
        """
        conn = sqlite3.connect(self.db_path)
        try:
            query = """
                SELECT * FROM audit_log
                WHERE timestamp >= datetime('now', ?)
            """
            params = [f"-{hours} hours"]

            if agent_id:
                query += " AND agent_id = ?"
                params.append(agent_id)

            if job_id:
                query += " AND job_id = ?"
                params.append(job_id)

            query += " ORDER BY timestamp DESC LIMIT ?"
            params.append(limit)

            cursor = conn.execute(query, params)
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_high_risk_actions(self, hours: int = 24) -> list[dict]:
        """Ruft高风险 Actions ab."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                SELECT * FROM audit_log
                WHERE risk_level IN ('high', 'medium')
                  AND timestamp >= datetime('now', ?)
                ORDER BY timestamp DESC
                LIMIT 100
                """,
                (f"-{hours} hours",),
            )
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            conn.close()

    def cleanup_old(self, days: int = 90) -> int:
        """Löscht alte Audit-Logs."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                DELETE FROM audit_log
                WHERE timestamp < datetime('now', ?)
                """,
                (f"-{days} days",),
            )
            deleted = cursor.rowcount
            conn.commit()
            return deleted
        finally:
            conn.close()
