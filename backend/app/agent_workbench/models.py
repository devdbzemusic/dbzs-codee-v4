"""Agent Workbench data models and request/response schemas."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# --- Run ---

AgentRunStatus = Literal[
    "created",
    "planning",
    "waiting_plan_review",
    "ready",
    "running",
    "waiting_review",
    "paused",
    "paused_recovery",
    "migration_review_required",
    "workspace_review_required",
    "completed",
    "cancelled",
    "failed",
    "retrying",
]

ExecutionMode = Literal["supervised", "read_only", "trusted_local"]

# --- Step ---

AgentStepStatus = Literal[
    "pending",
    "active",
    "waiting_review",
    "completed",
    "failed",
    "retrying",
    "skipped",
    "rejected",
]

StepRole = Literal[
    "planner",
    "researcher",
    "coder",
    "reviewer",
    "tester",
    "debugger",
    "general",
]

# --- Events ---

EventSeverity = Literal["debug", "info", "warning", "error"]
EventType = Literal[
    "run.created",
    "run.planning_started",
    "run.plan_ready",
    "run.started",
    "run.paused",
    "run.resumed",
    "run.cancelled",
    "run.failed",
    "run.completed",
    "run.recovered",
    "run.resume_baseline_missing",
    "run.resume_baseline_accepted",
    "run.workspace_changes_detected",
    "run.workspace_changes_accepted",
    "step.created",
    "step.started",
    "step.progress",
    "step.blocked",
    "step.waiting_review",
    "step.completed",
    "step.failed",
    "step.skipped",
    "step.retrying",
    "tool.requested",
    "tool.started",
    "tool.output",
    "tool.completed",
    "tool.failed",
    "tool.cancelled",
    "file.read",
    "file.search_match",
    "file.change_proposed",
    "file.change_approved",
    "file.change_rejected",
    "file.change_applying",
    "file.created",
    "file.modified",
    "file.renamed",
    "file.deleted",
    "file.rollback",
    "review.requested",
    "review.approved",
    "review.rejected",
    "command.requested",
    "command.started",
    "command.output",
    "command.completed",
    "command.failed",
    "diagnostic.created",
    "diagnostic.cleared",
    "followup.received",
    "followup.applied",
    "followup.rejected",
    "plan.revised",
]

# --- Tool calls ---

ToolCallStatus = Literal["pending", "running", "completed", "failed", "cancelled"]

# --- File changes ---

FileChangeOperation = Literal["create", "modify", "rename", "delete"]
FileChangeStatus = Literal[
    "proposed",
    "waiting_review",
    "approved",
    "rejected",
    "applying",
    "applied",
    "failed",
    "rolled_back",
]

# --- Follow-ups ---

FollowUpStatus = Literal["pending", "applied", "rejected"]

# --- Host actions ---

HostActionType = Literal[
    "apply_patch",
    "run_command",
    "cancel_command",
    "git_create_branch",
    "git_commit",
    "refresh_workspace",
]
HostActionStatus = Literal["pending", "claimed", "completed", "failed", "cancelled"]


@dataclass
class AgentRun:
    id: str
    workspace_root: str
    workspace_name: str
    goal: str
    status: AgentRunStatus
    execution_mode: ExecutionMode
    provider: str
    model_id: str
    max_steps: int
    created_at: str
    updated_at: str
    schema_version: str = "agent-run-v1"
    job_id: str | None = None
    current_step_id: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    pause_reason: str | None = None
    error_message: str | None = None
    execution_backend: str = "simulation"
    runtime_provider: str | None = None
    runtime_model_id: str | None = None
    runtime_model_name: str | None = None
    runtime_endpoint: str | None = None
    runtime_pid: int | None = None
    runtime_health_state: str | None = None
    runtime_verified_at: str | None = None


@dataclass
class AgentStep:
    id: str
    run_id: str
    ordinal: int
    title: str
    description: str
    status: AgentStepStatus
    role: StepRole
    attempt_count: int
    max_attempts: int
    created_at: str
    depends_on_json: str = "[]"
    tool_policy_json: str = "{}"
    input_summary: str | None = None
    output_summary: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    error_message: str | None = None


@dataclass
class AgentEvent:
    sequence: int
    id: str
    run_id: str
    event_type: EventType
    severity: EventSeverity
    summary: str
    created_at: str
    step_id: str | None = None
    payload_json: str = "{}"


@dataclass
class AgentToolCall:
    id: str
    run_id: str
    step_id: str
    tool_id: str
    status: ToolCallStatus
    arguments_json: str
    created_at: str
    result_json: str | None = None
    stdout_tail: str | None = None
    stderr_tail: str | None = None
    exit_code: int | None = None
    started_at: str | None = None
    finished_at: str | None = None
    error_message: str | None = None


@dataclass
class AgentFileChange:
    id: str
    run_id: str
    step_id: str
    file_path: str
    operation: FileChangeOperation
    status: FileChangeStatus
    summary: str
    created_at: str
    updated_at: str
    before_hash: str | None = None
    after_hash: str | None = None
    diff: str | None = None
    added_lines: int = 0
    removed_lines: int = 0
    restore_point_id: str | None = None
    review_gate_id: str | None = None


@dataclass
class AgentFollowUp:
    id: str
    run_id: str
    text: str
    status: FollowUpStatus
    created_at: str
    processed_at: str | None = None
    effect_summary: str | None = None


@dataclass
class HostAction:
    id: str
    run_id: str
    step_id: str
    action_type: HostActionType
    status: HostActionStatus
    payload_json: str
    created_at: str
    result_json: str | None = None
    claimed_at: str | None = None
    completed_at: str | None = None
    error_message: str | None = None
    executor_id: str | None = None


# --- API request/response schemas ---


@dataclass
class CreateRunRequest:
    workspace_root: str
    goal: str
    workspace_name: str = ""
    execution_mode: ExecutionMode = "supervised"
    provider: str = "local"
    model_id: str = "default"
    max_steps: int = 20
    job_id: str | None = None


@dataclass
class PlanStepInput:
    title: str
    description: str = ""
    role: StepRole = "general"
    depends_on: list[str] = field(default_factory=list)
    tool_policy: dict[str, Any] = field(default_factory=dict)
    max_attempts: int = 3


@dataclass
class SetPlanRequest:
    steps: list[PlanStepInput]
    auto_start: bool = False


@dataclass
class PauseRunRequest:
    reason: str = "user_requested"


@dataclass
class FollowUpRequest:
    text: str


@dataclass
class ProposeFileChangeRequest:
    file_path: str
    operation: FileChangeOperation
    summary: str
    proposed_content: str = ""
    expected_before_hash: str | None = None


@dataclass
class HostActionCompleteRequest:
    result: dict[str, Any] = field(default_factory=dict)
    executor_id: str = "desktop-primary"


@dataclass
class HostActionFailRequest:
    error_message: str
    executor_id: str = "desktop-primary"


@dataclass
class HostActionClaimRequest:
    executor_id: str = "desktop-primary"


@dataclass
class AcceptWorkspaceChangesRequest:
    expected_changed_files: list[str] | None = None
