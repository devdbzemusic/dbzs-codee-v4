import type { UserExecutionIntent } from "@/services/executionIntent";
import { isToolRequiredExecutionIntent } from "@/services/executionIntent";

export type ExecutionApproval =
  | "approve_plan"
  | "approve_file_changes"
  | "approve_dependency_install"
  | "approve_command"
  | "approve_destructive_action"
  | "approve_commit"
  | "approve_push";

export type AgentExecutionStatus =
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "testing"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentExecutionOutcome =
  | "implemented"
  | "implemented_with_warnings"
  | "plan_ready_for_approval"
  | "blocked_by_missing_approval"
  | "blocked_by_environment"
  | "blocked_by_dependency"
  | "failed"
  | "cancelled";

export interface AgentExecutionContract {
  runId: string;
  workspaceId: string;
  intent: UserExecutionIntent;
  mayReadFiles: boolean;
  mayWriteFiles: boolean;
  mayRunSafeCommands: boolean;
  mayInstallDependencies: boolean;
  mayUseNetwork: boolean;
  mayCommit: boolean;
  mayPush: boolean;
  requiresPlanApproval: boolean;
  requiresPatchApproval: boolean;
  requiresCommandApproval: boolean;
  status: AgentExecutionStatus;
}

export function buildAgentExecutionContract(input: {
  runId: string;
  workspaceId: string;
  intent: UserExecutionIntent;
  planApproved?: boolean;
  patchApproved?: boolean;
  dependencyApproved?: boolean;
}): AgentExecutionContract {
  const toolRequired = isToolRequiredExecutionIntent(input.intent);
  return {
    runId: input.runId,
    workspaceId: input.workspaceId,
    intent: input.intent,
    mayReadFiles: true,
    mayWriteFiles: Boolean(input.patchApproved || input.planApproved),
    mayRunSafeCommands: toolRequired,
    mayInstallDependencies: Boolean(input.dependencyApproved),
    mayUseNetwork: Boolean(input.dependencyApproved),
    mayCommit: false,
    mayPush: false,
    requiresPlanApproval: toolRequired && input.intent === "implement",
    requiresPatchApproval: toolRequired,
    requiresCommandApproval: true,
    status: toolRequired ? "planning" : "completed"
  };
}
