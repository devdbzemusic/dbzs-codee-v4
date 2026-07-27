import type { ModelTargetAgent } from "@dbzs/shared";
import type { UserExecutionIntent } from "@/services/executionIntent";

export type ImplementationWorkflowPhase =
  | "clarification"
  | "planning"
  | "awaiting_plan_approval"
  | "awaiting_dependency_approval"
  | "executing"
  | "testing"
  | "awaiting_patch_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ExecutionOutcome =
  | "plan_ready_for_approval"
  | "awaiting_dependency_approval"
  | "awaiting_patch_approval"
  | "executing"
  | "implemented"
  | "implemented_with_warnings"
  | "execution_no_action"
  | "invalid_protocol"
  | "skill_tool_policy_violation"
  | "command_spawn_failed"
  | "dependency_install_failed"
  | "patch_failed"
  | "validation_failed"
  | "cancelled";

export interface PlannedFileChange {
  path: string;
  changeType: "create" | "modify" | "delete";
  reason?: string;
}

export interface PlannedCommand {
  commandId?: string;
  command: string;
  args: string[];
  reason?: string;
}

export interface PlannedDependencyChange {
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  packages: Array<{ name: string; version?: string }>;
  dependencyType: "production" | "development";
  reason?: string;
}

export interface ExecutionHandoff {
  runId: string;
  workflowId: string;
  workspaceId: string;
  approvedPlanId: string;
  fromAgent: "planner";
  toAgent: "coder";
  executionIntent: "implement" | "fix" | "refactor";
  approvedFiles: PlannedFileChange[];
  approvedCommands: PlannedCommand[];
  approvedDependencies: PlannedDependencyChange[];
  settingsRevision: number;
  coderModelId: string;
  createdAt: string;
}

export type AgentTurnTerminalReason =
  | "final_answer"
  | "tool_calls_executed"
  | "patch_proposed"
  | "needs_user_input"
  | "execution_no_action"
  | "invalid_protocol"
  | "skill_tool_policy_violation"
  | "budget_exceeded"
  | "cancelled";

export type AgentLoopState =
  | "awaiting_model"
  | "executing_tool"
  | "awaiting_approval"
  | "continuing_after_tool"
  | "finalizing";

export interface AgentProtocolFailure {
  parser: string;
  rawContentLength: number;
  rawPreview: string;
  errorCode: string;
  errorMessage: string;
  repairAttempted: boolean;
}

export const EXECUTION_PROTOCOL_REPAIR_HINT = [
  "Du bist im Codee-Agentenworkflow.",
  "Beschreibe keinen Toolaufruf.",
  "Nutze das Werkzeug direkt im CODEE_TOOL_CALL-Envelope oder liefere einen strukturierten Fix-Plan.",
  "Falls die Umsetzung blockiert ist, nenne ausschließlich den konkreten Blocker."
].join("\n");

export function mapExecutionIntentToHandoffIntent(
  intent: UserExecutionIntent
): "implement" | "fix" | "refactor" | null {
  switch (intent) {
    case "implement":
    case "build":
    case "test":
      return "implement";
    case "fix":
    case "fix_review_findings":
      return "fix";
    case "refactor":
      return "refactor";
    case "explain_only":
    case "plan_only":
    case "inspect":
    case "review":
      return null;
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

export function buildExecutionHandoff(input: {
  runId: string;
  workflowId: string;
  workspaceId: string;
  approvedPlanId: string;
  executionIntent: "implement" | "fix" | "refactor";
  coderModelId: string;
  settingsRevision?: number;
  approvedFiles?: PlannedFileChange[];
  approvedCommands?: PlannedCommand[];
  approvedDependencies?: PlannedDependencyChange[];
}): ExecutionHandoff {
  return {
    runId: input.runId,
    workflowId: input.workflowId,
    workspaceId: input.workspaceId,
    approvedPlanId: input.approvedPlanId,
    fromAgent: "planner",
    toAgent: "coder",
    executionIntent: input.executionIntent,
    approvedFiles: input.approvedFiles ?? [],
    approvedCommands: input.approvedCommands ?? [],
    approvedDependencies: input.approvedDependencies ?? [],
    settingsRevision: input.settingsRevision ?? 0,
    coderModelId: input.coderModelId,
    createdAt: new Date().toISOString()
  };
}

export function handoffTargetAgent(_handoff: ExecutionHandoff): ModelTargetAgent {
  return "coder";
}
