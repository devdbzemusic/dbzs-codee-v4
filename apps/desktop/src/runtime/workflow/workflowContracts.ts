import type { RuntimeTaskType } from "@dbzs/shared";
import type { UserExecutionIntent } from "@/services/executionIntent";
import type { ActiveTaskContract, ActiveTaskPhase } from "@/services/activeTaskContract";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";

export type WorkflowKind =
  | "chat"
  | "planning"
  | "code_change"
  | "refactoring"
  | "debug_fix"
  | "review"
  | "review_remediation"
  | "test"
  | "build"
  | "workspace_backup"
  | "workspace_maintenance";

export type CanonicalWorkflowPhase =
  | "clarification"
  | "diagnosis"
  | "planning"
  | "awaiting_plan_approval"
  | "awaiting_dependency_approval"
  | "implementation"
  | "executing"
  | "awaiting_patch_approval"
  | "testing"
  | "verification"
  | "review"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowAgentRole =
  | "runtime_chat"
  | "planner"
  | "debugger"
  | "coder"
  | "tester"
  | "reviewer";

export type WorkflowModelRole = "chat" | "planner" | "debug" | "coder" | "review";

export type WorkflowTransitionEvent =
  | "information_complete"
  | "plan_created"
  | "plan_approved"
  | "dependency_approved"
  | "patch_proposed"
  | "patch_approved"
  | "implementation_completed"
  | "checks_passed"
  | "checks_failed"
  | "review_passed"
  | "cancelled"
  | "failed";

export interface WorkflowTransitionPolicy {
  from: CanonicalWorkflowPhase;
  event: WorkflowTransitionEvent;
  to: CanonicalWorkflowPhase;
}

export interface WorkflowPhasePolicy {
  phase: CanonicalWorkflowPhase;
  allowedAgents: WorkflowAgentRole[];
  defaultAgent: WorkflowAgentRole;
  modelRole: WorkflowModelRole;
  toolProfile: AgentToolProfile;
  terminal: boolean;
}

export interface WorkflowPolicy {
  kind: WorkflowKind;
  initialPhase: CanonicalWorkflowPhase;
  phases: Partial<Record<CanonicalWorkflowPhase, WorkflowPhasePolicy>>;
  transitions: WorkflowTransitionPolicy[];
}

export type WorkflowAssignmentSource =
  | "new_task"
  | "active_workflow"
  | "approved_transition"
  | "deterministic_operation";

export interface WorkflowResolutionInput {
  userMessage: string;
  classifiedIntent: UserExecutionIntent;
  classifiedTaskType: RuntimeTaskType;
  activeContract?: ActiveTaskContract | null;
  explicitWorkflowKind?: WorkflowKind | null;
  requestedAgent?: WorkflowAgentRole | null;
  requestedPhase?: CanonicalWorkflowPhase | null;
}

export interface CanonicalWorkflowAssignment {
  workflowKind: WorkflowKind;
  phase: CanonicalWorkflowPhase;
  effectiveAgent: WorkflowAgentRole;
  modelRole: WorkflowModelRole;
  toolProfile: AgentToolProfile;
  source: WorkflowAssignmentSource;
  requestedAgent?: WorkflowAgentRole | null;
  requestedPhase?: CanonicalWorkflowPhase | null;
  normalized: boolean;
  normalizationReasons: string[];
  policyVersion: number;
}

export function canonicalPhaseToActiveTaskPhase(
  phase: CanonicalWorkflowPhase
): ActiveTaskPhase {
  return phase;
}
