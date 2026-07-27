import type { ActiveTaskContract } from "@/services/activeTaskContract";
import { resolveCanonicalWorkflowAssignment } from "@/runtime/workflow/workflowStateResolver";

export function migrateActiveTaskContractWorkflow(
  contract: ActiveTaskContract
): ActiveTaskContract {
  const assignment = resolveCanonicalWorkflowAssignment({
    userMessage: contract.confirmedGoal || contract.originalRequest,
    classifiedIntent: "inspect",
    classifiedTaskType: contract.taskType,
    activeContract: {
      ...contract,
      workflowKind: contract.workflowKind ?? "chat"
    },
    explicitWorkflowKind: contract.workflowKind ?? null,
    requestedAgent:
      contract.requestedAgent ?? contract.assignedAgent ?? contract.effectiveAgent ?? null,
    requestedPhase: contract.currentPhase
  });

  return {
    ...contract,
    workflowKind: assignment.workflowKind,
    currentPhase: assignment.phase,
    assignedAgent: assignment.effectiveAgent,
    effectiveAgent: assignment.effectiveAgent,
    requestedAgent:
      contract.requestedAgent ?? contract.assignedAgent ?? assignment.requestedAgent ?? undefined,
    policyVersion: assignment.policyVersion,
    modelRole: assignment.modelRole,
    toolProfile: assignment.toolProfile,
    transitionVersion: contract.transitionVersion ?? 1
  };
}
