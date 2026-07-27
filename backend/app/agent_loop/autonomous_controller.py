"""Autonomous Loop Controller for Phase 2C+

Zweck:
  Steuert die Ausführungsschleife eines Agenten für Multi-Step-Tasks.

Warum:
  Single-Step-Agenten (Phase 2B) können nur eine Aktion pro Job ausführen.
  Komplexe Aufgaben erfordern iterative Bearbeitung mit mehreren Schritten.

Wozu:
  Ermöglicht autonomen Agenten, die solange arbeiten bis:
  - Das Ziel erreicht ist
  - Maximale Schritte erreicht sind
  - Timeout eintritt
  - User manuell stoppt
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal, TypedDict
from pathlib import Path

if TYPE_CHECKING:
    from app.trajectories.service import TrajectoryService


class LoopState(TypedDict):
    job_id: str
    step_count: int
    max_steps: int
    started_at: str
    last_step_at: str | None
    terminated_at: str | None
    termination_reason: str | None
    termination_code: int | None


TerminationReason = Literal[
    "goal_achieved",
    "max_steps_reached",
    "timeout",
    "user_stopped",
    "review_rejected",
    "error"
]


class AutonomousLoopController:
    """Controller für autonome Multi-Step-Agent-Loops."""

    TERMINATION_CODES = {
        "goal_achieved": 0,
        "max_steps_reached": 1,
        "timeout": 2,
        "user_stopped": 3,
        "review_rejected": 4,
        "error": 99,
    }

    def __init__(
        self,
        job_id: str,
        db_path: str | None = None,
        max_steps: int = 10,
        max_runtime_seconds: int = 3600,
        trajectory_service: TrajectoryService | None = None,
    ) -> None:
        self.job_id = job_id
        self.max_steps = max_steps
        self.max_runtime_seconds = max_runtime_seconds
        self.db_path = db_path or self._default_db_path()
        if trajectory_service is not None:
            self._trajectory_service = trajectory_service
        else:
            from app.trajectories.service import get_trajectory_service
            self._trajectory_service = get_trajectory_service()
        self._ensure_table()
        self._init_or_load_state()

    @property
    def step_count(self) -> int:
        return self._state["step_count"]

    @property
    def is_active(self) -> bool:
        return self._state["terminated_at"] is None

    def _default_db_path(self) -> str:
        """Default SQLite-Pfad für Loop-State."""
        from app.config import get_app_data_dir
        app_data = get_app_data_dir()
        return str(Path(app_data) / "job_loop_state.db")

    def _ensure_table(self) -> None:
        """Erstellt job_loop_state Tabelle falls nicht vorhanden."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS job_loop_state (
                    job_id TEXT PRIMARY KEY,
                    step_count INTEGER DEFAULT 0,
                    max_steps INTEGER DEFAULT 10,
                    started_at TEXT NOT NULL,
                    last_step_at TEXT,
                    terminated_at TEXT,
                    termination_reason TEXT,
                    termination_code INTEGER
                )
            """)
            conn.commit()
        finally:
            conn.close()

    def _init_or_load_state(self) -> None:
        """Initialisiert neuen State oder lädt bestehenden."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                "SELECT * FROM job_loop_state WHERE job_id = ?",
                (self.job_id,)
            )
            row = cursor.fetchone()

            if row:
                self._state = LoopState(
                    job_id=row[0],
                    step_count=row[1],
                    max_steps=row[2],
                    started_at=row[3],
                    last_step_at=row[4],
                    terminated_at=row[5],
                    termination_reason=row[6],
                    termination_code=row[7],
                )
            else:
                now = datetime.now(UTC).isoformat()
                self._state = LoopState(
                    job_id=self.job_id,
                    step_count=0,
                    max_steps=self.max_steps,
                    started_at=now,
                    last_step_at=None,
                    terminated_at=None,
                    termination_reason=None,
                    termination_code=None,
                )
                conn.execute(
                    """
                    INSERT INTO job_loop_state
                    (job_id, step_count, max_steps, started_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (self.job_id, 0, self.max_steps, now),
                )
                conn.commit()
        finally:
            conn.close()

    def _persist_state(self) -> None:
        """Speichert aktuellen State in SQLite."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                """
                UPDATE job_loop_state
                SET step_count = ?,
                    last_step_at = ?,
                    terminated_at = ?,
                    termination_reason = ?,
                    termination_code = ?
                WHERE job_id = ?
                """,
                (
                    self._state["step_count"],
                    self._state["last_step_at"],
                    self._state["terminated_at"],
                    self._state["termination_reason"],
                    self._state["termination_code"],
                    self.job_id,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def can_continue(self) -> bool:
        """
        Prüft ob Loop weiterlaufen darf.

        Returns:
            True wenn alle Bedingungen erfüllt sind:
            - Loop nicht terminiert
            - step_count < max_steps
            - Runtime < max_runtime_seconds
            - Nicht user-gestoppt
        """
        if not self.is_active:
            return False

        if self._state["step_count"] >= self.max_steps:
            return False

        started = datetime.fromisoformat(self._state["started_at"])
        elapsed = (datetime.now(UTC) - started).total_seconds()
        if elapsed > self.max_runtime_seconds:
            return False

        return True

    def next_step(self) -> dict:
        """
        Erhöht Schrittzähler und gibt Step-Metadata zurück.

        Returns:
            dict mit step_number, job_id, started_at

        Raises:
            RuntimeError: Wenn Loop nicht可以继续 (can_continue=False)
        """
        if not self.can_continue():
            reason = self._get_termination_reason()
            raise RuntimeError(f"Loop cannot continue: {reason}")

        self._state["step_count"] += 1
        self._state["last_step_at"] = datetime.now(UTC).isoformat()
        self._persist_state()

        self._record_trajectory_event(
            event_type="step_started",
            summary="Autonomous loop step started",
            step_number=self._state["step_count"],
            metadata={
                "max_steps": self.max_steps,
                "max_runtime_seconds": self.max_runtime_seconds,
            },
        )

        return {
            "step": self._state["step_count"],
            "job_id": self.job_id,
            "started_at": self._state["last_step_at"],
        }

    def mark_complete(
        self,
        success: bool,
        reason: str = "goal_achieved",
        summary: str | None = None,
    ) -> None:
        """
        Markiert Loop als abgeschlossen.

        Args:
            success: True wenn Ziel erreicht, False bei Fehler/Abbruch
            reason: Termination-Reason (siehe TerminationReason)
            summary: Optionale Zusammenfassung des Loops
        """
        if reason not in self.TERMINATION_CODES:
            reason = "error"

        self._state["terminated_at"] = datetime.now(UTC).isoformat()
        self._state["termination_reason"] = reason
        self._state["termination_code"] = self.TERMINATION_CODES[reason]
        self._persist_state()

        event_type = self._termination_event_type(reason, success)
        event_summary = summary or reason
        self._record_trajectory_event(
            event_type=event_type,
            summary=event_summary,
            step_number=self._state["step_count"],
            metadata={
                "termination_reason": reason,
                "termination_code": self._state["termination_code"],
                "success": success,
            },
        )

    def mark_user_stopped(self) -> None:
        """Markiert Loop als manuell vom User gestoppt."""
        self.mark_complete(success=False, reason="user_stopped")

    def mark_review_rejected(self) -> None:
        """Markiert Loop als abgelehnt durch Review-Gate."""
        self.mark_complete(success=False, reason="review_rejected")

    def get_state(self) -> LoopState:
        """Gibt aktuellen Loop-State zurück."""
        return self._state.copy()

    def _get_termination_reason(self) -> str:
        """Ermittelt Terminations-Grund für can_continue=False."""
        if not self.is_active:
            return self._state["termination_reason"] or "already_terminated"

        if self._state["step_count"] >= self.max_steps:
            return "max_steps_reached"

        started = datetime.fromisoformat(self._state["started_at"])
        elapsed = (datetime.now(UTC) - started).total_seconds()
        if elapsed > self.max_runtime_seconds:
            return "timeout"

        return "unknown"

    def _termination_event_type(self, reason: str, success: bool) -> str:
        if reason == "user_stopped":
            return "cancelled"
        if reason == "error":
            return "error"
        if reason == "goal_achieved" and success:
            return "completed"
        return "completed"

    def _record_trajectory_event(
        self,
        *,
        event_type: str,
        summary: str,
        step_number: int | None = None,
        metadata: dict | None = None,
    ) -> None:
        from app.trajectories.models import TrajectoryEventCreate

        try:
            self._trajectory_service.record_event(
                TrajectoryEventCreate(
                    job_id=self.job_id,
                    event_type=event_type,  # type: ignore[arg-type]
                    summary=summary,
                    step_number=step_number,
                    metadata=metadata or {},
                )
            )
        except Exception:
            pass
