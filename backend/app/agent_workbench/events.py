"""Atomic event append with monotonic sequence per run."""

from __future__ import annotations

import sqlite3
from typing import Any

from app.agent_workbench.models import AgentEvent, EventSeverity, EventType
from app.agent_workbench.repository import AgentWorkbenchRepository


class EventService:
    """Append typed events atomically with status changes."""

    def __init__(self, repo: AgentWorkbenchRepository) -> None:
        self._repo = repo

    def append_event(
        self,
        conn: sqlite3.Connection,
        *,
        run_id: str,
        event_type: EventType,
        summary: str,
        step_id: str | None = None,
        severity: EventSeverity = "info",
        payload: dict[str, Any] | None = None,
    ) -> AgentEvent:
        sequence = self._repo.next_event_sequence(conn, run_id)
        event = AgentEvent(
            sequence=sequence,
            id=self._repo.make_event_id(),
            run_id=run_id,
            step_id=step_id,
            event_type=event_type,
            severity=severity,
            summary=summary,
            payload_json=self._repo.dumps(payload or {}),
            created_at=self._repo.now(),
        )
        return self._repo.insert_event_in_tx(conn, event)

    def append_event_standalone(
        self,
        *,
        run_id: str,
        event_type: EventType,
        summary: str,
        step_id: str | None = None,
        severity: EventSeverity = "info",
        payload: dict[str, Any] | None = None,
    ) -> AgentEvent:
        conn = self._repo.transaction()
        try:
            event = self.append_event(
                conn,
                run_id=run_id,
                event_type=event_type,
                summary=summary,
                step_id=step_id,
                severity=severity,
                payload=payload,
            )
            self._repo.commit(conn)
            return event
        except Exception:
            self._repo.rollback(conn)
            raise

    def transition_run_with_event(
        self,
        conn: sqlite3.Connection,
        *,
        run_id: str,
        new_status: str,
        event_type: EventType,
        summary: str,
        step_id: str | None = None,
        severity: EventSeverity = "info",
        payload: dict[str, Any] | None = None,
        **run_updates: Any,
    ) -> AgentEvent:
        self._repo.update_run_status(run_id, new_status, conn=conn, **run_updates)
        return self.append_event(
            conn,
            run_id=run_id,
            event_type=event_type,
            summary=summary,
            step_id=step_id,
            severity=severity,
            payload=payload,
        )

    def transition_step_with_event(
        self,
        conn: sqlite3.Connection,
        *,
        run_id: str,
        step_id: str,
        new_status: str,
        event_type: EventType,
        summary: str,
        severity: EventSeverity = "info",
        payload: dict[str, Any] | None = None,
        **step_updates: Any,
    ) -> AgentEvent:
        self._repo.update_step_status(step_id, new_status, conn=conn, **step_updates)
        return self.append_event(
            conn,
            run_id=run_id,
            event_type=event_type,
            summary=summary,
            step_id=step_id,
            severity=severity,
            payload=payload,
        )
