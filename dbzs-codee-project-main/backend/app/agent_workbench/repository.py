"""SQLite persistence for Agent Workbench."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.agent_workbench.migrations import ensure_tables
from app.agent_workbench.models import (
    AgentEvent,
    AgentFileChange,
    AgentFollowUp,
    AgentRun,
    AgentStep,
    AgentToolCall,
    HostAction,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


class AgentWorkbenchRepository:
    """SQLite CRUD for agent workbench entities."""

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or self._default_db_path()
        self._ensure_db()

    def _default_db_path(self) -> str:
        from app.core.config import get_app_data_dir

        return str(Path(get_app_data_dir()) / "agent_workbench.db")

    def _ensure_db(self) -> None:
        conn = sqlite3.connect(self.db_path)
        try:
            ensure_tables(conn)
        finally:
            conn.close()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        return conn

    # --- Runs ---

    def insert_run(self, run: AgentRun, *, conn: sqlite3.Connection | None = None) -> AgentRun:
        own_conn = conn is None
        db = conn or self._connect()
        try:
            db.execute(
                """
                INSERT INTO agent_runs (
                    id, job_id, workspace_root, workspace_name, goal, status,
                    execution_mode, provider, model_id, current_step_id, max_steps,
                    created_at, updated_at, started_at, finished_at,
                    pause_reason, error_message, schema_version,
                    execution_backend, runtime_provider, runtime_model_id,
                    runtime_model_name, runtime_endpoint, runtime_pid,
                    runtime_health_state, runtime_verified_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run.id,
                    run.job_id,
                    run.workspace_root,
                    run.workspace_name,
                    run.goal,
                    run.status,
                    run.execution_mode,
                    run.provider,
                    run.model_id,
                    run.current_step_id,
                    run.max_steps,
                    run.created_at,
                    run.updated_at,
                    run.started_at,
                    run.finished_at,
                    run.pause_reason,
                    run.error_message,
                    run.schema_version,
                    run.execution_backend,
                    run.runtime_provider,
                    run.runtime_model_id,
                    run.runtime_model_name,
                    run.runtime_endpoint,
                    run.runtime_pid,
                    run.runtime_health_state,
                    run.runtime_verified_at,
                ),
            )
            if own_conn:
                db.commit()
            return run
        finally:
            if own_conn:
                db.close()

    def get_run(self, run_id: str) -> AgentRun | None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM agent_runs WHERE id = ?", (run_id,)).fetchone()
            return self._row_to_run(row) if row else None
        finally:
            conn.close()

    def list_runs(self, limit: int = 50) -> list[AgentRun]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [self._row_to_run(r) for r in rows]
        finally:
            conn.close()

    def update_run(self, run: AgentRun) -> None:
        """Fully persists the run's dynamic columns (e.g., runtime properties) into the DB."""
        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE agent_runs
                SET execution_backend = ?,
                    runtime_provider = ?,
                    runtime_model_id = ?,
                    runtime_model_name = ?,
                    runtime_endpoint = ?,
                    runtime_pid = ?,
                    runtime_health_state = ?,
                    runtime_verified_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    run.execution_backend,
                    run.runtime_provider,
                    run.runtime_model_id,
                    run.runtime_model_name,
                    run.runtime_endpoint,
                    run.runtime_pid,
                    run.runtime_health_state,
                    run.runtime_verified_at,
                    self.now(),
                    run.id,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def update_run_status(
        self,
        run_id: str,
        status: str,
        *,
        conn: sqlite3.Connection | None = None,
        current_step_id: str | None = None,
        pause_reason: str | None = None,
        error_message: str | None = None,
        started_at: str | None = None,
        finished_at: str | None = None,
        clear_pause_reason: bool = False,
    ) -> None:
        own_conn = conn is None
        db = conn or self._connect()
        try:
            self._apply_run_status_update(
                db,
                run_id,
                status,
                current_step_id=current_step_id,
                pause_reason=pause_reason,
                error_message=error_message,
                started_at=started_at,
                finished_at=finished_at,
                clear_pause_reason=clear_pause_reason,
            )
            if own_conn:
                db.commit()
        finally:
            if own_conn:
                db.close()

    def _apply_run_status_update(
        self,
        conn: sqlite3.Connection,
        run_id: str,
        status: str,
        *,
        current_step_id: str | None = None,
        pause_reason: str | None = None,
        error_message: str | None = None,
        started_at: str | None = None,
        finished_at: str | None = None,
        clear_pause_reason: bool = False,
    ) -> None:
        now = _now_iso()
        fields: list[str] = ["status = ?", "updated_at = ?"]
        values: list[Any] = [status, now]

        if current_step_id is not None:
            fields.append("current_step_id = ?")
            values.append(current_step_id)
        if pause_reason is not None:
            fields.append("pause_reason = ?")
            values.append(pause_reason)
        if clear_pause_reason:
            fields.append("pause_reason = NULL")
        if error_message is not None:
            fields.append("error_message = ?")
            values.append(error_message)
        if started_at is not None:
            fields.append("started_at = ?")
            values.append(started_at)
        if finished_at is not None:
            fields.append("finished_at = ?")
            values.append(finished_at)

        values.append(run_id)
        conn.execute(
            f"UPDATE agent_runs SET {', '.join(fields)} WHERE id = ?",
            values,
        )

    def list_runs_by_status(self, status: str) -> list[AgentRun]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM agent_runs WHERE status = ?",
                (status,),
            ).fetchall()
            return [self._row_to_run(r) for r in rows]
        finally:
            conn.close()

    def _row_to_run(self, row: sqlite3.Row) -> AgentRun:
        return AgentRun(
            id=row["id"],
            job_id=row["job_id"],
            workspace_root=row["workspace_root"],
            workspace_name=row["workspace_name"] or "",
            goal=row["goal"],
            status=row["status"],
            execution_mode=row["execution_mode"],
            provider=row["provider"],
            model_id=row["model_id"],
            current_step_id=row["current_step_id"],
            max_steps=row["max_steps"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            pause_reason=row["pause_reason"],
            error_message=row["error_message"],
            schema_version=row["schema_version"],
            execution_backend=row["execution_backend"] if "execution_backend" in row.keys() else "simulation",
            runtime_provider=row["runtime_provider"] if "runtime_provider" in row.keys() else None,
            runtime_model_id=row["runtime_model_id"] if "runtime_model_id" in row.keys() else None,
            runtime_model_name=row["runtime_model_name"] if "runtime_model_name" in row.keys() else None,
            runtime_endpoint=row["runtime_endpoint"] if "runtime_endpoint" in row.keys() else None,
            runtime_pid=row["runtime_pid"] if "runtime_pid" in row.keys() else None,
            runtime_health_state=row["runtime_health_state"] if "runtime_health_state" in row.keys() else None,
            runtime_verified_at=row["runtime_verified_at"] if "runtime_verified_at" in row.keys() else None,
        )

    # --- Steps ---

    def insert_step(self, step: AgentStep, conn: sqlite3.Connection | None = None) -> AgentStep:
        own_conn = conn is None
        db = conn or self._connect()
        try:
            self._insert_step_row(db, step)
            if own_conn:
                db.commit()
            return step
        finally:
            if own_conn:
                db.close()

    def _insert_step_row(self, conn: sqlite3.Connection, step: AgentStep) -> None:
        conn.execute(
            """
            INSERT INTO agent_steps (
                id, run_id, ordinal, title, description, status, role,
                depends_on_json, tool_policy_json, attempt_count, max_attempts,
                input_summary, output_summary, created_at, started_at,
                finished_at, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                step.id,
                step.run_id,
                step.ordinal,
                step.title,
                step.description,
                step.status,
                step.role,
                step.depends_on_json,
                step.tool_policy_json,
                step.attempt_count,
                step.max_attempts,
                step.input_summary,
                step.output_summary,
                step.created_at,
                step.started_at,
                step.finished_at,
                step.error_message,
            ),
        )

    def get_step(self, step_id: str) -> AgentStep | None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM agent_steps WHERE id = ?", (step_id,)).fetchone()
            return self._row_to_step(row) if row else None
        finally:
            conn.close()

    def list_steps_for_run(self, run_id: str) -> list[AgentStep]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM agent_steps WHERE run_id = ? ORDER BY ordinal",
                (run_id,),
            ).fetchall()
            return [self._row_to_step(r) for r in rows]
        finally:
            conn.close()

    def count_active_steps(self, run_id: str) -> int:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT COUNT(*) FROM agent_steps WHERE run_id = ? AND status = 'active'",
                (run_id,),
            ).fetchone()
            return int(row[0]) if row else 0
        finally:
            conn.close()

    def update_step_status(
        self,
        step_id: str,
        status: str,
        *,
        conn: sqlite3.Connection | None = None,
        started_at: str | None = None,
        finished_at: str | None = None,
        error_message: str | None = None,
        output_summary: str | None = None,
        attempt_count: int | None = None,
    ) -> None:
        own_conn = conn is None
        db = conn or self._connect()
        try:
            self._apply_step_status_update(
                db,
                step_id,
                status,
                started_at=started_at,
                finished_at=finished_at,
                error_message=error_message,
                output_summary=output_summary,
                attempt_count=attempt_count,
            )
            if own_conn:
                db.commit()
        finally:
            if own_conn:
                db.close()

    def _apply_step_status_update(
        self,
        conn: sqlite3.Connection,
        step_id: str,
        status: str,
        *,
        started_at: str | None = None,
        finished_at: str | None = None,
        error_message: str | None = None,
        output_summary: str | None = None,
        attempt_count: int | None = None,
    ) -> None:
        fields = ["status = ?"]
        values: list[Any] = [status]
        if started_at is not None:
            fields.append("started_at = ?")
            values.append(started_at)
        if finished_at is not None:
            fields.append("finished_at = ?")
            values.append(finished_at)
        if error_message is not None:
            fields.append("error_message = ?")
            values.append(error_message)
        if output_summary is not None:
            fields.append("output_summary = ?")
            values.append(output_summary)
        if attempt_count is not None:
            fields.append("attempt_count = ?")
            values.append(attempt_count)
        values.append(step_id)
        conn.execute(
            f"UPDATE agent_steps SET {', '.join(fields)} WHERE id = ?",
            values,
        )

    def delete_steps_for_run(self, run_id: str, conn: sqlite3.Connection | None = None) -> None:
        own_conn = conn is None
        db = conn or self._connect()
        try:
            db.execute("DELETE FROM agent_steps WHERE run_id = ?", (run_id,))
            if own_conn:
                db.commit()
        finally:
            if own_conn:
                db.close()

    def _row_to_step(self, row: sqlite3.Row) -> AgentStep:
        return AgentStep(
            id=row["id"],
            run_id=row["run_id"],
            ordinal=row["ordinal"],
            title=row["title"],
            description=row["description"] or "",
            status=row["status"],
            role=row["role"],
            depends_on_json=row["depends_on_json"] or "[]",
            tool_policy_json=row["tool_policy_json"] or "{}",
            attempt_count=row["attempt_count"],
            max_attempts=row["max_attempts"],
            input_summary=row["input_summary"],
            output_summary=row["output_summary"],
            created_at=row["created_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            error_message=row["error_message"],
        )

    # --- Events ---

    def next_event_sequence(self, conn: sqlite3.Connection, run_id: str) -> int:
        row = conn.execute(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_events WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        return int(row[0])

    def insert_event_in_tx(
        self,
        conn: sqlite3.Connection,
        event: AgentEvent,
    ) -> AgentEvent:
        conn.execute(
            """
            INSERT INTO agent_events (
                sequence, id, run_id, step_id, event_type, severity,
                summary, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.sequence,
                event.id,
                event.run_id,
                event.step_id,
                event.event_type,
                event.severity,
                event.summary,
                event.payload_json,
                event.created_at,
            ),
        )
        return event

    def list_events(
        self,
        run_id: str,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> list[AgentEvent]:
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT * FROM agent_events
                WHERE run_id = ? AND sequence > ?
                ORDER BY sequence
                LIMIT ?
                """,
                (run_id, after_sequence, limit),
            ).fetchall()
            return [self._row_to_event(r) for r in rows]
        finally:
            conn.close()

    def get_latest_event_sequence(self, run_id: str) -> int:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT COALESCE(MAX(sequence), 0) FROM agent_events WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            return int(row[0]) if row else 0
        finally:
            conn.close()

    def _row_to_event(self, row: sqlite3.Row) -> AgentEvent:
        return AgentEvent(
            sequence=row["sequence"],
            id=row["id"],
            run_id=row["run_id"],
            step_id=row["step_id"],
            event_type=row["event_type"],
            severity=row["severity"],
            summary=row["summary"],
            payload_json=row["payload_json"] or "{}",
            created_at=row["created_at"],
        )

    # --- Tool calls ---

    def insert_tool_call(self, tool_call: AgentToolCall) -> AgentToolCall:
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO agent_tool_calls (
                    id, run_id, step_id, tool_id, status, arguments_json,
                    result_json, stdout_tail, stderr_tail, exit_code,
                    created_at, started_at, finished_at, error_message
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tool_call.id,
                    tool_call.run_id,
                    tool_call.step_id,
                    tool_call.tool_id,
                    tool_call.status,
                    tool_call.arguments_json,
                    tool_call.result_json,
                    tool_call.stdout_tail,
                    tool_call.stderr_tail,
                    tool_call.exit_code,
                    tool_call.created_at,
                    tool_call.started_at,
                    tool_call.finished_at,
                    tool_call.error_message,
                ),
            )
            conn.commit()
            return tool_call
        finally:
            conn.close()

    def update_tool_call(
        self,
        tool_call_id: str,
        *,
        status: str | None = None,
        result_json: str | None = None,
        stdout_tail: str | None = None,
        stderr_tail: str | None = None,
        exit_code: int | None = None,
        started_at: str | None = None,
        finished_at: str | None = None,
        error_message: str | None = None,
    ) -> None:
        conn = self._connect()
        try:
            fields: list[str] = []
            values: list[Any] = []
            if status is not None:
                fields.append("status = ?")
                values.append(status)
            if result_json is not None:
                fields.append("result_json = ?")
                values.append(result_json)
            if stdout_tail is not None:
                fields.append("stdout_tail = ?")
                values.append(stdout_tail)
            if stderr_tail is not None:
                fields.append("stderr_tail = ?")
                values.append(stderr_tail)
            if exit_code is not None:
                fields.append("exit_code = ?")
                values.append(exit_code)
            if started_at is not None:
                fields.append("started_at = ?")
                values.append(started_at)
            if finished_at is not None:
                fields.append("finished_at = ?")
                values.append(finished_at)
            if error_message is not None:
                fields.append("error_message = ?")
                values.append(error_message)
            if not fields:
                return
            values.append(tool_call_id)
            conn.execute(
                f"UPDATE agent_tool_calls SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            conn.commit()
        finally:
            conn.close()

    def list_tool_calls_for_step(self, step_id: str) -> list[AgentToolCall]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM agent_tool_calls WHERE step_id = ? ORDER BY created_at",
                (step_id,),
            ).fetchall()
            return [self._row_to_tool_call(r) for r in rows]
        finally:
            conn.close()

    def _row_to_tool_call(self, row: sqlite3.Row) -> AgentToolCall:
        return AgentToolCall(
            id=row["id"],
            run_id=row["run_id"],
            step_id=row["step_id"],
            tool_id=row["tool_id"],
            status=row["status"],
            arguments_json=row["arguments_json"] or "{}",
            result_json=row["result_json"],
            stdout_tail=row["stdout_tail"],
            stderr_tail=row["stderr_tail"],
            exit_code=row["exit_code"],
            created_at=row["created_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            error_message=row["error_message"],
        )

    # --- File changes ---

    def insert_file_change(self, change: AgentFileChange) -> AgentFileChange:
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO agent_file_changes (
                    id, run_id, step_id, file_path, operation, status, summary,
                    before_hash, after_hash, diff, added_lines, removed_lines,
                    restore_point_id, review_gate_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    change.id,
                    change.run_id,
                    change.step_id,
                    change.file_path,
                    change.operation,
                    change.status,
                    change.summary,
                    change.before_hash,
                    change.after_hash,
                    change.diff,
                    change.added_lines,
                    change.removed_lines,
                    change.restore_point_id,
                    change.review_gate_id,
                    change.created_at,
                    change.updated_at,
                ),
            )
            conn.commit()
            return change
        finally:
            conn.close()

    def get_file_change(self, change_id: str) -> AgentFileChange | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM agent_file_changes WHERE id = ?",
                (change_id,),
            ).fetchone()
            return self._row_to_file_change(row) if row else None
        finally:
            conn.close()

    def update_file_change_status(
        self,
        change_id: str,
        status: str,
        *,
        review_gate_id: str | None = None,
        after_hash: str | None = None,
        restore_point_id: str | None = None,
    ) -> None:
        conn = self._connect()
        try:
            fields = ["status = ?", "updated_at = ?"]
            values: list[Any] = [status, _now_iso()]
            if review_gate_id is not None:
                fields.append("review_gate_id = ?")
                values.append(review_gate_id)
            if after_hash is not None:
                fields.append("after_hash = ?")
                values.append(after_hash)
            if restore_point_id is not None:
                fields.append("restore_point_id = ?")
                values.append(restore_point_id)
            values.append(change_id)
            conn.execute(
                f"UPDATE agent_file_changes SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            conn.commit()
        finally:
            conn.close()

    def list_file_changes_for_run(self, run_id: str) -> list[AgentFileChange]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM agent_file_changes WHERE run_id = ? ORDER BY created_at",
                (run_id,),
            ).fetchall()
            return [self._row_to_file_change(r) for r in rows]
        finally:
            conn.close()

    def _row_to_file_change(self, row: sqlite3.Row) -> AgentFileChange:
        return AgentFileChange(
            id=row["id"],
            run_id=row["run_id"],
            step_id=row["step_id"],
            file_path=row["file_path"],
            operation=row["operation"],
            status=row["status"],
            summary=row["summary"] or "",
            before_hash=row["before_hash"],
            after_hash=row["after_hash"],
            diff=row["diff"],
            added_lines=row["added_lines"],
            removed_lines=row["removed_lines"],
            restore_point_id=row["restore_point_id"],
            review_gate_id=row["review_gate_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    # --- Follow-ups ---

    def insert_followup(self, followup: AgentFollowUp) -> AgentFollowUp:
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO agent_followups (
                    id, run_id, text, status, created_at, processed_at, effect_summary
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    followup.id,
                    followup.run_id,
                    followup.text,
                    followup.status,
                    followup.created_at,
                    followup.processed_at,
                    followup.effect_summary,
                ),
            )
            conn.commit()
            return followup
        finally:
            conn.close()

    def get_followup(self, followup_id: str) -> AgentFollowUp | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM agent_followups WHERE id = ?",
                (followup_id,),
            ).fetchone()
            return self._row_to_followup(row) if row else None
        finally:
            conn.close()

    def update_followup(
        self,
        followup_id: str,
        status: str,
        *,
        processed_at: str | None = None,
        effect_summary: str | None = None,
    ) -> None:
        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE agent_followups
                SET status = ?, processed_at = ?, effect_summary = ?
                WHERE id = ?
                """,
                (status, processed_at, effect_summary, followup_id),
            )
            conn.commit()
        finally:
            conn.close()

    def list_followups_for_run(self, run_id: str) -> list[AgentFollowUp]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM agent_followups WHERE run_id = ? ORDER BY created_at",
                (run_id,),
            ).fetchall()
            return [self._row_to_followup(r) for r in rows]
        finally:
            conn.close()

    def _row_to_followup(self, row: sqlite3.Row) -> AgentFollowUp:
        return AgentFollowUp(
            id=row["id"],
            run_id=row["run_id"],
            text=row["text"],
            status=row["status"],
            created_at=row["created_at"],
            processed_at=row["processed_at"],
            effect_summary=row["effect_summary"],
        )

    # --- Host actions ---

    def insert_host_action(self, action: HostAction) -> HostAction:
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO host_actions (
                    id, run_id, step_id, action_type, status, payload_json,
                    result_json, executor_id, created_at, claimed_at,
                    completed_at, error_message
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    action.id,
                    action.run_id,
                    action.step_id,
                    action.action_type,
                    action.status,
                    action.payload_json,
                    action.result_json,
                    action.executor_id,
                    action.created_at,
                    action.claimed_at,
                    action.completed_at,
                    action.error_message,
                ),
            )
            conn.commit()
            return action
        finally:
            conn.close()

    def get_host_action(self, action_id: str) -> HostAction | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM host_actions WHERE id = ?",
                (action_id,),
            ).fetchone()
            return self._row_to_host_action(row) if row else None
        finally:
            conn.close()

    def update_host_action(
        self,
        action_id: str,
        *,
        status: str | None = None,
        result_json: str | None = None,
        executor_id: str | None = None,
        claimed_at: str | None = None,
        completed_at: str | None = None,
        error_message: str | None = None,
    ) -> None:
        conn = self._connect()
        try:
            fields: list[str] = []
            values: list[Any] = []
            if status is not None:
                fields.append("status = ?")
                values.append(status)
            if result_json is not None:
                fields.append("result_json = ?")
                values.append(result_json)
            if executor_id is not None:
                fields.append("executor_id = ?")
                values.append(executor_id)
            if claimed_at is not None:
                fields.append("claimed_at = ?")
                values.append(claimed_at)
            if completed_at is not None:
                fields.append("completed_at = ?")
                values.append(completed_at)
            if error_message is not None:
                fields.append("error_message = ?")
                values.append(error_message)
            if not fields:
                return
            values.append(action_id)
            conn.execute(
                f"UPDATE host_actions SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            conn.commit()
        finally:
            conn.close()

    def next_pending_host_action(self, executor_id: str | None = None) -> HostAction | None:
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT * FROM host_actions
                WHERE status = 'pending'
                ORDER BY created_at
                LIMIT 1
                """,
            ).fetchone()
            return self._row_to_host_action(row) if row else None
        finally:
            conn.close()

    def count_claimed_host_actions(self) -> int:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT COUNT(*) FROM host_actions WHERE status = 'claimed'",
            ).fetchone()
            return int(row[0]) if row else 0
        finally:
            conn.close()

    def _row_to_host_action(self, row: sqlite3.Row) -> HostAction:
        return HostAction(
            id=row["id"],
            run_id=row["run_id"],
            step_id=row["step_id"],
            action_type=row["action_type"],
            status=row["status"],
            payload_json=row["payload_json"] or "{}",
            result_json=row["result_json"],
            executor_id=row["executor_id"],
            created_at=row["created_at"],
            claimed_at=row["claimed_at"],
            completed_at=row["completed_at"],
            error_message=row["error_message"],
        )

    # --- Transaction helper ---

    def transaction(self) -> sqlite3.Connection:
        conn = self._connect()
        conn.execute("BEGIN")
        return conn

    def commit(self, conn: sqlite3.Connection) -> None:
        conn.commit()
        conn.close()

    def rollback(self, conn: sqlite3.Connection) -> None:
        conn.rollback()
        conn.close()

    @staticmethod
    def make_run_id() -> str:
        return _new_id("run")

    @staticmethod
    def make_step_id() -> str:
        return _new_id("step")

    @staticmethod
    def make_event_id() -> str:
        return _new_id("evt")

    @staticmethod
    def make_tool_call_id() -> str:
        return _new_id("tool")

    @staticmethod
    def make_file_change_id() -> str:
        return _new_id("chg")

    @staticmethod
    def make_followup_id() -> str:
        return _new_id("fu")

    @staticmethod
    def make_host_action_id() -> str:
        return _new_id("ha")

    @staticmethod
    def now() -> str:
        return _now_iso()

    @staticmethod
    def dumps(obj: Any) -> str:
        return json.dumps(obj, ensure_ascii=False)

    @staticmethod
    def loads(text: str | None) -> Any:
        if not text:
            return {}
        return json.loads(text)
