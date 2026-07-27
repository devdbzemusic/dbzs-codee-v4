/**
 * Agent Workbench shared types — aligned with backend /agent-workbench/* API.
 */

export type AgentRunStatus =
  | "created"
  | "planning"
  | "waiting_plan_review"
  | "ready"
  | "running"
  | "waiting_review"
  | "paused"
  | "paused_recovery"
  | "migration_review_required"
  | "workspace_review_required"
  | "cancelled"
  | "failed"
  | "retrying"
  | "completed";

export type AgentRunExecutionMode = "supervised" | "read_only";

export type AgentStepStatus =
  | "pending"
  | "active"
  | "blocked"
  | "waiting_review"
  | "completed"
  | "failed"
  | "skipped"
  | "retrying";

export type AgentEventSeverity = "debug" | "info" | "warning" | "error";

export type AgentEventType =
  | "run.created"
  | "run.planning_started"
  | "run.plan_ready"
  | "run.started"
  | "run.paused"
  | "run.resumed"
  | "run.cancelled"
  | "run.failed"
  | "run.completed"
  | "run.recovered"
  | "run.resume_baseline_missing"
  | "run.resume_baseline_accepted"
  | "run.workspace_changes_detected"
  | "run.workspace_changes_accepted"
  | "step.created"
  | "step.started"
  | "step.progress"
  | "step.blocked"
  | "step.waiting_review"
  | "step.completed"
  | "step.failed"
  | "step.skipped"
  | "step.retrying"
  | "tool.requested"
  | "tool.started"
  | "tool.output"
  | "tool.completed"
  | "tool.failed"
  | "tool.cancelled"
  | "file.read"
  | "file.search_match"
  | "file.change_proposed"
  | "file.change_approved"
  | "file.change_rejected"
  | "file.change_applying"
  | "file.created"
  | "file.modified"
  | "file.renamed"
  | "file.deleted"
  | "file.rollback"
  | "review.requested"
  | "review.approved"
  | "review.rejected"
  | "command.requested"
  | "command.started"
  | "command.output"
  | "command.completed"
  | "command.failed"
  | "diagnostic.created"
  | "diagnostic.cleared"
  | "followup.received"
  | "followup.applied"
  | "followup.rejected"
  | "plan.revised";

export type HostActionType =
  | "apply_patch"
  | "run_command"
  | "cancel_command"
  | "git_create_branch"
  | "git_commit"
  | "refresh_workspace";

export type HostActionStatus = "pending" | "claimed" | "completed" | "failed";

export type AgentFileChangeOperation = "create" | "modify" | "rename" | "delete";

export type AgentFileChangeStatus =
  | "proposed"
  | "waiting_review"
  | "approved"
  | "rejected"
  | "applying"
  | "applied"
  | "failed"
  | "rolled_back";

export type AgentFollowUpStatus = "pending" | "applied" | "rejected";

export interface AgentRun {
  id: string;
  jobId: string | null;
  workspaceRoot: string;
  workspaceName: string;
  goal: string;
  status: AgentRunStatus;
  executionMode: AgentRunExecutionMode;
  provider: string | null;
  modelId: string | null;
  currentStepId: string | null;
  maxSteps: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  pauseReason: string | null;
  errorMessage: string | null;
  schemaVersion: string;
}

export interface AgentStep {
  id: string;
  runId: string;
  ordinal: number;
  title: string;
  description: string;
  status: AgentStepStatus;
  role: string | null;
  dependsOn: string[];
  attemptCount: number;
  maxAttempts: number;
  inputSummary: string | null;
  outputSummary: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface AgentEvent {
  sequence: number;
  id: string;
  runId: string;
  stepId: string | null;
  eventType: AgentEventType;
  severity: AgentEventSeverity;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
  schemaVersion?: string;
}

export interface AgentFollowUp {
  id: string;
  runId: string;
  text: string;
  status: AgentFollowUpStatus;
  createdAt: string;
  processedAt: string | null;
  effectSummary: string | null;
}

export interface AgentFileChange {
  id: string;
  runId: string;
  stepId: string | null;
  filePath: string;
  operation: AgentFileChangeOperation;
  status: AgentFileChangeStatus;
  summary: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  diff: string | null;
  addedLines: number;
  removedLines: number;
  restorePointId: string | null;
  reviewGateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostAction {
  id: string;
  runId: string;
  stepId: string | null;
  actionType: HostActionType;
  status: HostActionStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface AgentRunDetail {
  run: AgentRun;
  steps: AgentStep[];
  fileChanges?: AgentFileChange[];
  followUps?: AgentFollowUp[];
}

export interface AgentRunListResponse {
  schemaVersion: string;
  runs: AgentRun[];
}

export interface AgentEventListResponse {
  schemaVersion: string;
  events: AgentEvent[];
}

export interface AgentRunCreateRequest {
  goal: string;
  workspaceRoot: string;
  workspaceName?: string;
  executionMode?: AgentRunExecutionMode;
  provider?: string | null;
  modelId?: string | null;
  maxSteps?: number;
  jobId?: string | null;
}

export interface AgentPlanStepInput {
  title: string;
  description?: string;
  role?: string | null;
  dependsOn?: string[];
  maxAttempts?: number;
}

export interface AgentRunPlanRequest {
  steps: AgentPlanStepInput[];
}

export interface AgentFollowUpCreateRequest {
  text: string;
}

export interface HostActionCompleteRequest {
  result?: Record<string, unknown>;
}

export interface HostActionFailRequest {
  errorMessage: string;
  result?: Record<string, unknown>;
}

export type AgentActivityFilter = "all" | "tools" | "files" | "commands" | "reviews" | "errors";

export type AgentOutputTab = "agent" | "commands" | "tests" | "problems" | "artifacts";
