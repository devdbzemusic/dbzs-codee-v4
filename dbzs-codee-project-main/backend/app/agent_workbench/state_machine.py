"""Run and step state transition validation."""

from __future__ import annotations

from app.agent_workbench.models import AgentRunStatus, AgentStepStatus

RUN_TRANSITIONS: dict[AgentRunStatus, set[AgentRunStatus]] = {
    "created": {"planning", "cancelled"},
    "planning": {"waiting_plan_review", "ready", "failed", "cancelled", "paused"},
    "waiting_plan_review": {"ready", "planning", "cancelled", "paused"},
    "ready": {"running", "cancelled", "paused", "planning"},
    "running": {"waiting_review", "completed", "paused", "cancelled", "failed"},
    "waiting_review": {"running", "completed", "cancelled", "failed", "paused"},
    "paused": {"running", "cancelled", "failed", "planning", "migration_review_required", "workspace_review_required"},
    "paused_recovery": {"running", "cancelled", "failed", "planning", "migration_review_required", "workspace_review_required"},
    "migration_review_required": {"paused", "cancelled", "failed"},
    "workspace_review_required": {"running", "paused", "cancelled", "failed"},
    "failed": {"retrying", "cancelled"},
    "retrying": {"running", "failed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}

STEP_TRANSITIONS: dict[AgentStepStatus, set[AgentStepStatus]] = {
    "pending": {"active", "skipped"},
    "active": {"waiting_review", "completed", "failed"},
    "waiting_review": {"active", "rejected", "completed"},
    "failed": {"retrying"},
    "retrying": {"active", "failed"},
    "completed": set(),
    "skipped": set(),
    "rejected": set(),
}


class InvalidTransitionError(Exception):
    """Raised when a status transition is not allowed."""

    def __init__(self, entity: str, current: str, target: str) -> None:
        self.entity = entity
        self.current = current
        self.target = target
        super().__init__(f"Invalid {entity} transition: {current} -> {target}")


def validate_run_transition(current: AgentRunStatus, target: AgentRunStatus) -> None:
    allowed = RUN_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise InvalidTransitionError("run", current, target)


def validate_step_transition(current: AgentStepStatus, target: AgentStepStatus) -> None:
    allowed = STEP_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise InvalidTransitionError("step", current, target)


def is_run_terminal(status: AgentRunStatus) -> bool:
    return status in {"completed", "cancelled"}


def is_step_terminal(status: AgentStepStatus) -> bool:
    return status in {"completed", "skipped", "rejected"}
