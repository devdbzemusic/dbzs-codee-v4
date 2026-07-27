import type { RuntimeSlotId } from "@dbzs/shared";
import type { ToolProtocolMode } from "@/runtime/agent/toolProtocolAdapter";
import type { ModelSelectionDecision } from "@/services/modelSelectionBroker";
import type { PreparedRuntimeRequest, ProviderRequestDiagnostics } from "@/services/preparedRuntimeRequest";
import type { CanonicalWorkflowAssignment } from "@/runtime/workflow/workflowContracts";

export interface RuntimeBindingDecision {
  decisionId: string;
  createdAt: string;
  workspaceId: string;
  workspaceRoot: string;
  workflowKind: string;
  workflowId?: string;
  phase: string;
  targetAgent: string;
  modelRole: string;
  toolProfile: string;
  configuredModelId: string;
  resolvedModelId: string;
  resolvedModelName: string;
  slotId: RuntimeSlotId;
  providerId: string;
  protocolMode: ToolProtocolMode | "none";
  settingsRevision: number;
  policyVersion: number;
  source: "role_setting" | "manual_selection" | "explicit_fallback";
  activeContractId?: string;
  activeContractInherited: boolean;
  activeContractReason?: string;
  orchestratorModelId?: string;
  orchestratorSlotId?: RuntimeSlotId;
  autoRepairEligible: boolean;
}

export interface RuntimeBindingDiagnostics {
  decisionId: string;
  workflowKind: string;
  phase: string;
  targetAgent: string;
  configuredModelId: string;
  resolvedModelId: string;
  slotId: string;
  preparedRequestModelId: string;
  slotModelId: string;
  providerModelId: string;
  consistent: boolean;
  mismatches: string[];
}

export function createRuntimeBindingDecision(input: {
  workspaceId: string;
  workspaceRoot: string;
  workflowId?: string;
  workflowAssignment: Pick<
    CanonicalWorkflowAssignment,
    "workflowKind" | "phase" | "effectiveAgent" | "modelRole" | "toolProfile"
  >;
  brokerDecision: ModelSelectionDecision;
  protocolMode: ToolProtocolMode | "none";
  policyVersion: number;
  activeContractId?: string;
  activeContractInherited: boolean;
  activeContractReason?: string;
  orchestratorModelId?: string;
  orchestratorSlotId?: RuntimeSlotId;
}): RuntimeBindingDecision {
  return Object.freeze({
    decisionId: input.brokerDecision.decisionId,
    createdAt: input.brokerDecision.decidedAt.toISOString(),
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
    workflowKind: input.workflowAssignment.workflowKind,
    workflowId: input.workflowId,
    phase: input.workflowAssignment.phase,
    targetAgent: input.workflowAssignment.effectiveAgent,
    modelRole: input.workflowAssignment.modelRole,
    toolProfile: input.workflowAssignment.toolProfile,
    configuredModelId: input.brokerDecision.configuredModelId,
    resolvedModelId: input.brokerDecision.resolvedModelId,
    resolvedModelName: input.brokerDecision.resolvedModelName,
    slotId: input.brokerDecision.slotId,
    providerId: input.brokerDecision.providerId,
    protocolMode: input.protocolMode,
    settingsRevision: input.brokerDecision.decisionSettingsRevision,
    policyVersion: input.policyVersion,
    source: input.brokerDecision.selectionSource,
    activeContractId: input.activeContractId,
    activeContractInherited: input.activeContractInherited,
    activeContractReason: input.activeContractReason,
    orchestratorModelId: input.orchestratorModelId,
    orchestratorSlotId: input.orchestratorSlotId,
    autoRepairEligible: Boolean(input.orchestratorModelId)
  });
}

export function assertRuntimeBindingConsistency(input: {
  bindingDecision: RuntimeBindingDecision;
  preparedRequest: Pick<
    PreparedRuntimeRequest,
    "bindingDecisionId" | "workflowKind" | "phase" | "targetAgent" | "modelRole" | "toolProfile" | "modelId" | "slotId" | "providerId" | "protocolMode"
  >;
  slotExecutionState?: {
    slotId?: string;
    modelId?: string;
  } | null;
  providerRequest: Pick<
    ProviderRequestDiagnostics,
    "modelId" | "slotId" | "provider" | "protocolMode"
  >;
}): { ok: true; diagnostics: RuntimeBindingDiagnostics } | { ok: false; diagnostics: RuntimeBindingDiagnostics } {
  const mismatches: string[] = [];
  const { bindingDecision, preparedRequest, slotExecutionState, providerRequest } = input;

  if (preparedRequest.bindingDecisionId !== bindingDecision.decisionId) {
    mismatches.push("bindingDecisionId");
  }
  if (preparedRequest.workflowKind !== bindingDecision.workflowKind) mismatches.push("workflowKind");
  if (preparedRequest.phase !== bindingDecision.phase) mismatches.push("phase");
  if (preparedRequest.targetAgent !== bindingDecision.targetAgent) mismatches.push("targetAgent");
  if (preparedRequest.modelRole !== bindingDecision.modelRole) mismatches.push("modelRole");
  if (preparedRequest.toolProfile !== bindingDecision.toolProfile) mismatches.push("toolProfile");
  if (preparedRequest.modelId !== bindingDecision.resolvedModelId) mismatches.push("prepared.modelId");
  if (preparedRequest.slotId !== bindingDecision.slotId) mismatches.push("prepared.slotId");
  if (preparedRequest.providerId !== bindingDecision.providerId) mismatches.push("prepared.providerId");
  if (preparedRequest.protocolMode !== bindingDecision.protocolMode) mismatches.push("prepared.protocolMode");
  if (providerRequest.modelId !== bindingDecision.resolvedModelId) mismatches.push("provider.modelId");
  if (providerRequest.slotId !== bindingDecision.slotId) mismatches.push("provider.slotId");
  if (providerRequest.provider !== bindingDecision.providerId) mismatches.push("provider.providerId");
  if ((providerRequest.protocolMode ?? "none") !== bindingDecision.protocolMode) {
    mismatches.push("provider.protocolMode");
  }
  if (slotExecutionState?.modelId && slotExecutionState.modelId !== bindingDecision.resolvedModelId) {
    mismatches.push("slot.modelId");
  }
  if (slotExecutionState?.slotId && slotExecutionState.slotId !== bindingDecision.slotId) {
    mismatches.push("slot.slotId");
  }

  const diagnostics: RuntimeBindingDiagnostics = {
    decisionId: bindingDecision.decisionId,
    workflowKind: bindingDecision.workflowKind,
    phase: bindingDecision.phase,
    targetAgent: bindingDecision.targetAgent,
    configuredModelId: bindingDecision.configuredModelId,
    resolvedModelId: bindingDecision.resolvedModelId,
    slotId: bindingDecision.slotId,
    preparedRequestModelId: preparedRequest.modelId,
    slotModelId: slotExecutionState?.modelId ?? "",
    providerModelId: providerRequest.modelId,
    consistent: mismatches.length === 0,
    mismatches
  };

  if (mismatches.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, diagnostics };
}
