"""Host action queue — claim/complete/fail with idempotency."""

from __future__ import annotations

from typing import Any

from app.agent_workbench.models import HostAction
from app.agent_workbench.repository import AgentWorkbenchRepository
from app.agent_workbench.state_machine import InvalidTransitionError


class HostActionService:
    """Manage privileged host actions for desktop executor."""

    MAX_CONCURRENT_CLAIMED = 1

    def __init__(self, repo: AgentWorkbenchRepository) -> None:
        self._repo = repo

    def create_action(
        self,
        *,
        run_id: str,
        step_id: str,
        action_type: str,
        payload: dict[str, Any],
    ) -> HostAction:
        action = HostAction(
            id=self._repo.make_host_action_id(),
            run_id=run_id,
            step_id=step_id,
            action_type=action_type,  # type: ignore[arg-type]
            status="pending",
            payload_json=self._repo.dumps(payload),
            created_at=self._repo.now(),
        )
        return self._repo.insert_host_action(action)

    def next_pending(self, executor_id: str | None = None) -> HostAction | None:
        return self._repo.next_pending_host_action(executor_id)

    def claim(self, action_id: str, executor_id: str = "desktop-primary") -> HostAction:
        action = self._repo.get_host_action(action_id)
        if action is None:
            raise ValueError(f"Host action {action_id} nicht gefunden")

        if action.status == "claimed" and action.executor_id == executor_id:
            return action
        if action.status == "completed":
            return action
        if action.status != "pending":
            raise InvalidTransitionError("host_action", action.status, "claimed")

        if self._repo.count_claimed_host_actions() >= self.MAX_CONCURRENT_CLAIMED:
            raise InvalidTransitionError("host_action", "pending", "claimed")

        now = self._repo.now()
        self._repo.update_host_action(
            action_id,
            status="claimed",
            executor_id=executor_id,
            claimed_at=now,
        )
        updated = self._repo.get_host_action(action_id)
        assert updated is not None
        return updated

    def complete(
        self,
        action_id: str,
        *,
        result: dict[str, Any] | None = None,
        executor_id: str = "desktop-primary",
    ) -> HostAction:
        action = self._repo.get_host_action(action_id)
        if action is None:
            raise ValueError(f"Host action {action_id} nicht gefunden")

        if action.status == "completed":
            return action

        if action.status not in {"claimed", "pending"}:
            raise InvalidTransitionError("host_action", action.status, "completed")

        if action.status == "claimed" and action.executor_id and action.executor_id != executor_id:
            raise InvalidTransitionError("host_action", action.status, "completed")

        now = self._repo.now()
        self._repo.update_host_action(
            action_id,
            status="completed",
            result_json=self._repo.dumps(result or {}),
            completed_at=now,
        )
        updated = self._repo.get_host_action(action_id)
        assert updated is not None
        return updated

    def fail(
        self,
        action_id: str,
        *,
        error_message: str,
        executor_id: str = "desktop-primary",
    ) -> HostAction:
        action = self._repo.get_host_action(action_id)
        if action is None:
            raise ValueError(f"Host action {action_id} nicht gefunden")

        if action.status == "failed":
            return action

        if action.status not in {"claimed", "pending"}:
            raise InvalidTransitionError("host_action", action.status, "failed")

        now = self._repo.now()
        self._repo.update_host_action(
            action_id,
            status="failed",
            error_message=error_message,
            completed_at=now,
        )
        updated = self._repo.get_host_action(action_id)
        assert updated is not None
        return updated
