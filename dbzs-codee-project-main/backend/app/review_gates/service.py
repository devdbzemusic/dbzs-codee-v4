"""Review Gate Service — Verwaltung von User-Freigaben für Patches."""

from __future__ import annotations

import sqlite3
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from app.review_gates.models import (
    ReviewGate,
    ReviewGateStatus,
    ProposedChange,
    ReviewGateCreateRequest,
    ReviewGateApproveRequest,
    ReviewGateRejectRequest,
)
from app.core.context_policy import normalize_workspace_path, workspace_scope_id

if TYPE_CHECKING:
    from app.trajectories.service import TrajectoryService

_RISK_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
_GATE_COLUMNS = """
    id, job_id, step_number, status, created_at, reviewed_at, reviewed_by,
    review_comment, auto_apply_timeout_seconds, run_id, step_id,
    workspace_root, workspace_id
"""


class ReviewGateScopeError(ValueError):
    """Eine Review-Entscheidung wurde fuer den falschen Workspace angefordert."""


class ReviewGateService:
    """Service für Review-Gate-Verwaltung."""

    def __init__(
        self,
        db_path: str | None = None,
        trajectory_service: TrajectoryService | None = None,
    ) -> None:
        self.db_path = db_path or self._default_db_path()
        if trajectory_service is not None:
            self._trajectory_service = trajectory_service
        else:
            from app.trajectories.service import get_trajectory_service
            self._trajectory_service = get_trajectory_service()
        self._auto_apply_logged: set[str] = set()
        self._ensure_table()

    def _default_db_path(self) -> str:
        """Default SQLite-Pfad für Review-Gates."""
        from app.core.config import get_app_data_dir
        app_data = get_app_data_dir()
        return str(Path(app_data) / "review_gates.db")

    def _ensure_table(self) -> None:
        """Erstellt review_gates und proposed_changes Tabellen."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS review_gates (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    step_number INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    reviewed_at TEXT,
                    reviewed_by TEXT,
                    review_comment TEXT,
                    auto_apply_timeout_seconds INTEGER DEFAULT 300,
                    run_id TEXT,
                    step_id TEXT,
                    workspace_root TEXT,
                    workspace_id TEXT
                )
            """)
            # Additive migration for existing databases
            columns = {
                row[1]
                for row in conn.execute("PRAGMA table_info(review_gates)").fetchall()
            }
            if "run_id" not in columns:
                conn.execute("ALTER TABLE review_gates ADD COLUMN run_id TEXT")
            if "step_id" not in columns:
                conn.execute("ALTER TABLE review_gates ADD COLUMN step_id TEXT")
            if "workspace_root" not in columns:
                conn.execute("ALTER TABLE review_gates ADD COLUMN workspace_root TEXT")
            if "workspace_id" not in columns:
                conn.execute("ALTER TABLE review_gates ADD COLUMN workspace_id TEXT")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_review_gates_workspace_pending "
                "ON review_gates(status, workspace_id)"
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS proposed_changes (
                    id TEXT PRIMARY KEY,
                    review_gate_id TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    old_content TEXT,
                    new_content TEXT,
                    diff TEXT NOT NULL,
                    risk_level TEXT DEFAULT 'medium',
                    risk_factors TEXT,
                    FOREIGN KEY (review_gate_id) REFERENCES review_gates(id)
                )
            """)
            conn.commit()
        finally:
            conn.close()

    def create_gate(self, request: ReviewGateCreateRequest) -> ReviewGate:
        """Erstellt neues Review-Gate."""
        conn = sqlite3.connect(self.db_path)
        try:
            gate_id = f"rg-{request.job_id}-{request.step_number}"
            now = datetime.now(UTC).isoformat()
            workspace_root = (
                normalize_workspace_path(request.workspace_root)
                if request.workspace_root
                else None
            )
            workspace_id = request.workspace_id or (
                workspace_scope_id(workspace_root) if workspace_root else None
            )

            conn.execute(
                """
                INSERT INTO review_gates
                (id, job_id, step_number, status, created_at, auto_apply_timeout_seconds,
                 run_id, step_id, workspace_root, workspace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    gate_id,
                    request.job_id,
                    request.step_number,
                    "pending",
                    now,
                    request.auto_apply_timeout_seconds,
                    request.run_id,
                    request.step_id,
                    workspace_root,
                    workspace_id,
                ),
            )

            # Proposed Changes einfügen
            for idx, change in enumerate(request.proposed_changes):
                change_id = f"{gate_id}-change-{idx}"
                risk_factors = json.dumps(change.get("risk_factors", []))
                conn.execute(
                    """
                    INSERT INTO proposed_changes
                    (id, review_gate_id, file_path, old_content, new_content, diff, risk_level, risk_factors)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        change_id,
                        gate_id,
                        change["file_path"],
                        change.get("old_content", ""),
                        change.get("new_content", ""),
                        change["diff"],
                        change.get("risk_level", "medium"),
                        risk_factors,
                    ),
                )

            conn.commit()
            gate = self.get_gate(gate_id)
            self._record_review_gate_created(gate)
            return gate
        finally:
            conn.close()

    def get_gate(self, gate_id: str) -> ReviewGate:
        """Ruft Review-Gate ab."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                f"SELECT {_GATE_COLUMNS} FROM review_gates WHERE id = ?",
                (gate_id,)
            )
            row = cursor.fetchone()
            if not row:
                raise ValueError(f"Review-Gate {gate_id} nicht gefunden")

            changes_cursor = conn.execute(
                "SELECT * FROM proposed_changes WHERE review_gate_id = ?",
                (gate_id,)
            )
            changes = [
                ProposedChange(
                    file_path=c[2],
                    old_content=c[3] or "",
                    new_content=c[4] or "",
                    diff=c[5],
                    risk_level=c[6],
                    risk_factors=json.loads(c[7] or "[]"),
                )
                for c in changes_cursor.fetchall()
            ]

            return self._row_to_gate(row, changes)
        finally:
            conn.close()

    def _row_to_gate(self, row: tuple, changes: list[ProposedChange]) -> ReviewGate:
        return ReviewGate(
            id=row[0],
            job_id=row[1],
            step_number=row[2],
            status=row[3],
            created_at=row[4],
            reviewed_at=row[5],
            reviewed_by=row[6],
            review_comment=row[7],
            auto_apply_timeout_seconds=row[8] or 300,
            proposed_changes=changes,
            run_id=row[9] if len(row) > 9 else None,
            step_id=row[10] if len(row) > 10 else None,
            workspace_root=row[11] if len(row) > 11 else None,
            workspace_id=row[12] if len(row) > 12 else None,
            scope_status="scoped" if len(row) > 12 and row[12] else "legacy_unscoped",
        )

    def list_pending_gates(
        self,
        job_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[ReviewGate]:
        """Listet offene Review-Gates auf."""
        conn = sqlite3.connect(self.db_path)
        try:
            if workspace_id:
                clauses = ["status = 'pending'", "workspace_id = ?"]
                params: list[str] = [workspace_id]
                if job_id:
                    clauses.append("job_id = ?")
                    params.append(job_id)
                cursor = conn.execute(
                    f"SELECT {_GATE_COLUMNS} FROM review_gates WHERE {' AND '.join(clauses)}",
                    params,
                )
            elif job_id:
                cursor = conn.execute(
                    f"SELECT {_GATE_COLUMNS} FROM review_gates WHERE status = 'pending' AND job_id = ?",
                    (job_id,),
                )
            else:
                cursor = conn.execute(
                    f"SELECT {_GATE_COLUMNS} FROM review_gates WHERE status = 'pending'"
                )

            gates = []
            for row in cursor.fetchall():
                changes_cursor = conn.execute(
                    "SELECT * FROM proposed_changes WHERE review_gate_id = ?",
                    (row[0],)
                )
                changes = [
                    ProposedChange(
                        file_path=c[2],
                        old_content=c[3] or "",
                        new_content=c[4] or "",
                        diff=c[5],
                        risk_level=c[6],
                        risk_factors=json.loads(c[7] or "[]"),
                    )
                    for c in changes_cursor.fetchall()
                ]

                gates.append(self._row_to_gate(row, changes))

            return gates
        finally:
            conn.close()

    def approve_gate(self, gate_id: str, request: ReviewGateApproveRequest) -> ReviewGate:
        """Genehmigt Review-Gate."""
        gate_before = self.get_gate(gate_id)
        self._assert_workspace_scope(gate_before, request.workspace_id)
        conn = sqlite3.connect(self.db_path)
        try:
            now = datetime.now(UTC).isoformat()
            conn.execute(
                """
                UPDATE review_gates
                SET status = 'approved',
                    reviewed_at = ?,
                    reviewed_by = ?,
                    review_comment = ?
                WHERE id = ?
                """,
                (now, request.reviewed_by, request.review_comment, gate_id),
            )
            conn.commit()
            gate = self.get_gate(gate_id)
            self._record_trajectory_event(
                job_id=gate.job_id,
                event_type="review_approved",
                summary="Review gate approved",
                step_number=gate.step_number,
                metadata={
                    "review_gate_id": gate_id,
                    "reviewed_by": request.reviewed_by,
                    "review_comment": request.review_comment,
                },
            )
            return gate
        finally:
            conn.close()

    def reject_gate(self, gate_id: str, request: ReviewGateRejectRequest) -> ReviewGate:
        """Lehnt Review-Gate ab."""
        gate_before = self.get_gate(gate_id)
        self._assert_workspace_scope(gate_before, request.workspace_id)
        conn = sqlite3.connect(self.db_path)
        try:
            now = datetime.now(UTC).isoformat()
            conn.execute(
                """
                UPDATE review_gates
                SET status = 'rejected',
                    reviewed_at = ?,
                    reviewed_by = ?,
                    review_comment = ?
                WHERE id = ?
                """,
                (now, request.reviewed_by, request.rejection_reason, gate_id),
            )
            conn.commit()
            gate = self.get_gate(gate_id)
            self._record_trajectory_event(
                job_id=gate.job_id,
                event_type="review_rejected",
                summary="Review gate rejected",
                step_number=gate.step_number,
                metadata={
                    "review_gate_id": gate_id,
                    "reviewed_by": request.reviewed_by,
                    "rejection_reason": request.rejection_reason,
                },
            )
            return gate
        finally:
            conn.close()

    @staticmethod
    def _assert_workspace_scope(gate: ReviewGate, requested_workspace_id: str | None) -> None:
        if gate.workspace_id is None:
            if requested_workspace_id is not None:
                raise ReviewGateScopeError("Legacy-Review-Gate besitzt keine Workspace-Zuordnung.")
            return
        if requested_workspace_id != gate.workspace_id:
            raise ReviewGateScopeError("Review-Gate gehoert zu einem anderen Workspace.")

    def delete_gate(self, gate_id: str) -> bool:
        """Löscht Review-Gate."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("DELETE FROM proposed_changes WHERE review_gate_id = ?", (gate_id,))
            conn.execute("DELETE FROM review_gates WHERE id = ?", (gate_id,))
            conn.commit()
            return True
        finally:
            conn.close()

    def check_auto_apply(self, gate_id: str) -> bool:
        """
        Prüft ob Auto-Apply-Timeout abgelaufen ist.

        Returns:
            True wenn Timeout abgelaufen und Gate noch pending
        """
        gate = self.get_gate(gate_id)
        if gate.status != "pending":
            return False

        created = datetime.fromisoformat(gate.created_at)
        elapsed = (datetime.now(UTC) - created).total_seconds()
        should_apply = elapsed > gate.auto_apply_timeout_seconds

        if should_apply and gate_id not in self._auto_apply_logged:
            self._auto_apply_logged.add(gate_id)
            self._record_trajectory_event(
                job_id=gate.job_id,
                event_type="auto_apply_checked",
                summary="Auto-apply timeout reached",
                step_number=gate.step_number,
                metadata={"review_gate_id": gate_id},
            )

        return should_apply

    def _record_review_gate_created(self, gate: ReviewGate) -> None:
        files = [change.file_path for change in gate.proposed_changes]
        risk_factors: list[str] = []
        for change in gate.proposed_changes:
            risk_factors.extend(change.risk_factors)

        self._record_trajectory_event(
            job_id=gate.job_id,
            event_type="review_gate_created",
            summary="Review gate created for proposed changes",
            step_number=gate.step_number,
            files=files,
            risk_level=self._highest_risk_level(gate.proposed_changes),
            metadata={
                "review_gate_id": gate.id,
                "proposed_changes_count": len(gate.proposed_changes),
                "risk_factors": risk_factors,
            },
        )

    def _highest_risk_level(self, changes: list[ProposedChange]) -> str:
        if not changes:
            return "none"
        highest = max(
            changes,
            key=lambda change: _RISK_ORDER.get(change.risk_level, 2),
        )
        return highest.risk_level

    def _record_trajectory_event(
        self,
        *,
        job_id: str,
        event_type: str,
        summary: str,
        step_number: int | None = None,
        files: list[str] | None = None,
        risk_level: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        from app.trajectories.models import TrajectoryEventCreate

        try:
            self._trajectory_service.record_event(
                TrajectoryEventCreate(
                    job_id=job_id,
                    event_type=event_type,  # type: ignore[arg-type]
                    summary=summary,
                    step_number=step_number,
                    files=files,
                    risk_level=risk_level,  # type: ignore[arg-type]
                    metadata=metadata or {},
                )
            )
        except Exception:
            pass
