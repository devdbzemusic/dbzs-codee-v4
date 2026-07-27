"""File change proposals linked to review gates."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.agent_workbench.models import AgentFileChange, ProposeFileChangeRequest
from app.agent_workbench.repository import AgentWorkbenchRepository
from app.agent_workbench.tools import compute_diff_stats, resolve_safe_path, sha256_content
from app.review_gates.models import ReviewGateCreateRequest
from app.review_gates.service import ReviewGateService
from app.core.context_policy import normalize_workspace_path, workspace_scope_id


class FileChangeService:
    """Propose, approve, reject file changes with review gate integration."""

    def __init__(
        self,
        repo: AgentWorkbenchRepository,
        review_gate_service: ReviewGateService | None = None,
    ) -> None:
        self._repo = repo
        if review_gate_service is not None:
            self._review_gates = review_gate_service
        else:
            self._review_gates = ReviewGateService()

    def propose_change(
        self,
        *,
        run_id: str,
        step_id: str,
        workspace_root: str,
        request: ProposeFileChangeRequest,
        job_id: str | None = None,
        step_number: int = 1,
    ) -> AgentFileChange:
        safe = resolve_safe_path(workspace_root, request.file_path)
        requested_path = Path(request.file_path)
        if requested_path.is_absolute():
            canonical_root = resolve_safe_path(workspace_root, ".")
            try:
                rel_path = safe.relative_to(canonical_root).as_posix()
            except ValueError as exc:
                raise ValueError("Absoluter Aenderungspfad ist nicht kanonisch relativierbar.") from exc
        else:
            # Der Request-Pfad bleibt die stabile Darstellung. `safe` wurde oben bereits
            # kanonisch gegen Workspace, Symlinks und Traversals validiert.
            rel_path = requested_path.as_posix()

        old_content = ""
        before_hash: str | None = None
        if safe.exists() and safe.is_file():
            old_content = safe.read_text(encoding="utf-8", errors="replace")
            before_hash = sha256_content(old_content)

        if request.expected_before_hash and before_hash != request.expected_before_hash:
            raise ValueError("Before-Hash stimmt nicht ueberein (409)")

        diff, added, removed = compute_diff_stats(old_content, request.proposed_content)
        now = self._repo.now()

        change = AgentFileChange(
            id=self._repo.make_file_change_id(),
            run_id=run_id,
            step_id=step_id,
            file_path=rel_path,
            operation=request.operation,
            status="proposed",
            summary=request.summary,
            before_hash=before_hash,
            after_hash=sha256_content(request.proposed_content),
            diff=diff,
            added_lines=added,
            removed_lines=removed,
            created_at=now,
            updated_at=now,
        )
        self._repo.insert_file_change(change)

        gate_job_id = job_id or run_id
        gate = self._review_gates.create_gate(
            ReviewGateCreateRequest(
                job_id=gate_job_id,
                step_number=step_number,
                run_id=run_id,
                step_id=step_id,
                workspace_root=normalize_workspace_path(workspace_root),
                workspace_id=workspace_scope_id(workspace_root),
                proposed_changes=[
                    {
                        "file_path": rel_path,
                        "old_content": old_content,
                        "new_content": request.proposed_content,
                        "diff": diff,
                        "risk_level": "medium",
                    }
                ],
            )
        )
        self._repo.update_file_change_status(change.id, "waiting_review", review_gate_id=gate.id)
        change.status = "waiting_review"
        change.review_gate_id = gate.id
        return change

    def approve_change(self, change_id: str, reviewed_by: str = "user") -> AgentFileChange:
        change = self._repo.get_file_change(change_id)
        if change is None:
            raise ValueError(f"File change {change_id} nicht gefunden")
        if change.status in {"approved", "applied"}:
            return change
        if change.status not in {"proposed", "waiting_review"}:
            raise ValueError(f"Ungueltiger Status: {change.status}")

        if change.review_gate_id:
            from app.review_gates.models import ReviewGateApproveRequest

            run = self._repo.get_run(change.run_id)
            self._review_gates.approve_gate(
                change.review_gate_id,
                ReviewGateApproveRequest(
                    reviewed_by=reviewed_by,
                    workspace_id=workspace_scope_id(run.workspace_root) if run else None,
                ),
            )

        self._repo.update_file_change_status(change_id, "approved")
        change.status = "approved"
        return change

    def reject_change(self, change_id: str, reviewed_by: str = "user", reason: str = "") -> AgentFileChange:
        change = self._repo.get_file_change(change_id)
        if change is None:
            raise ValueError(f"File change {change_id} nicht gefunden")
        if change.status == "rejected":
            return change

        if change.review_gate_id:
            from app.review_gates.models import ReviewGateRejectRequest

            run = self._repo.get_run(change.run_id)
            self._review_gates.reject_gate(
                change.review_gate_id,
                ReviewGateRejectRequest(
                    reviewed_by=reviewed_by,
                    rejection_reason=reason or "Rejected",
                    workspace_id=workspace_scope_id(run.workspace_root) if run else None,
                ),
            )

        self._repo.update_file_change_status(change_id, "rejected")
        change.status = "rejected"
        return change

    def create_apply_host_action(
        self,
        host_action_service: Any,
        change: AgentFileChange,
        proposed_content: str,
    ) -> Any:
        """Queue apply_patch host action after approval."""
        self._repo.update_file_change_status(change.id, "applying")
        return host_action_service.create_action(
            run_id=change.run_id,
            step_id=change.step_id,
            action_type="apply_patch",
            payload={
                "file_change_id": change.id,
                "file_path": change.file_path,
                "operation": change.operation,
                "content": proposed_content,
                "expected_before_hash": change.before_hash,
            },
        )

    def mark_applied(self, change_id: str, *, restore_point_id: str | None = None) -> AgentFileChange:
        change = self._repo.get_file_change(change_id)
        if change is None:
            raise ValueError(f"File change {change_id} nicht gefunden")
        self._repo.update_file_change_status(
            change_id,
            "applied",
            restore_point_id=restore_point_id,
        )
        updated = self._repo.get_file_change(change_id)
        assert updated is not None
        return updated
