import type { CanonicalWorkflowAssignment } from "@/runtime/workflow/workflowContracts";

export interface WorkflowAssignmentDiagnostics {
  workflowKind: CanonicalWorkflowAssignment["workflowKind"];
  phase: CanonicalWorkflowAssignment["phase"];
  requestedAgent?: CanonicalWorkflowAssignment["requestedAgent"];
  effectiveAgent: CanonicalWorkflowAssignment["effectiveAgent"];
  requestedPhase?: CanonicalWorkflowAssignment["requestedPhase"];
  effectivePhase: CanonicalWorkflowAssignment["phase"];
  modelRole: CanonicalWorkflowAssignment["modelRole"];
  toolProfile: CanonicalWorkflowAssignment["toolProfile"];
  normalized: boolean;
  normalizationReasons: string[];
  policyVersion: number;
}

export function buildWorkflowAssignmentDiagnostics(
  assignment: CanonicalWorkflowAssignment
): WorkflowAssignmentDiagnostics {
  return {
    workflowKind: assignment.workflowKind,
    phase: assignment.phase,
    requestedAgent: assignment.requestedAgent ?? undefined,
    effectiveAgent: assignment.effectiveAgent,
    requestedPhase: assignment.requestedPhase ?? undefined,
    effectivePhase: assignment.phase,
    modelRole: assignment.modelRole,
    toolProfile: assignment.toolProfile,
    normalized: assignment.normalized,
    normalizationReasons: [...assignment.normalizationReasons],
    policyVersion: assignment.policyVersion
  };
}
