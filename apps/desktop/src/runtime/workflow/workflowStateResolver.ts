import { assertValidPhaseAgentPair } from "@/services/phaseAgentInvariant";
import { isExplicitNewTaskMessage } from "@/services/workflowContinuation";
import {
  type CanonicalWorkflowAssignment,
  type CanonicalWorkflowPhase,
  type WorkflowAgentRole,
  type WorkflowKind,
  type WorkflowPhasePolicy,
  type WorkflowResolutionInput
} from "@/runtime/workflow/workflowContracts";
import {
  WORKFLOW_POLICY_REGISTRY,
  WORKFLOW_POLICY_VERSION
} from "@/runtime/workflow/workflowPolicyRegistry";

const BACKUP_PATTERNS = [
  /\bsource[-\s]?backup\b/i,
  /\bonly\s+source\s+backup\b/i,
  /\bbackup\b/i,
  /\barchiv(?:iere|)\b/i,
  /\bprojekt\s+ordner\b/i
];

const MAINTENANCE_PATTERNS = [/\bexportier/i, /\breport/i, /\bwartung\b/i];
const CONCRETE_FIX_PATTERNS = [
  /\bsetze\s+den\s+bestätigten\s+fix\s+um\b/i,
  /\bsetze\s+den\s+bestaetigten\s+fix\s+um\b/i,
  /\bfixe?\s+diese?\s+datei\b/i,
  /\bkorrigiere?\s+die\s+typen\b/i,
  /\bbeheb(?:e|)\s+die\s+findings\b/i
];

function detectDeterministicWorkflow(userMessage: string): WorkflowKind | null {
  if (BACKUP_PATTERNS.some((pattern) => pattern.test(userMessage))) {
    return "workspace_backup";
  }
  if (MAINTENANCE_PATTERNS.some((pattern) => pattern.test(userMessage))) {
    return "workspace_maintenance";
  }
  return null;
}

function inferWorkflowKind(input: WorkflowResolutionInput): WorkflowKind {
  if (input.explicitWorkflowKind) {
    return input.explicitWorkflowKind;
  }

  const deterministic = detectDeterministicWorkflow(input.userMessage);
  if (deterministic) {
    return deterministic;
  }

  // An explicit review request always switches the workflow kind to "review",
  // even while a different (non-review) contract is still open. Mirrors
  // resolveWorkflowContinuation's "switch phase, keep contract" handling for
  // review requests. Without this, the activeContract fallback below would
  // silently keep the stale, non-review workflowKind: classifiedTaskType
  // would say "review" but the resolved workflow (and its default agent)
  // would not, so routing would never reach the reviewer agent.
  if (input.classifiedTaskType === "review") {
    return "review";
  }

  if (
    input.activeContract?.workflowKind &&
    !isExplicitNewTaskMessage(input.userMessage)
  ) {
    return input.activeContract.workflowKind;
  }

  if (input.classifiedIntent === "fix_review_findings") {
    return "review_remediation";
  }

  switch (input.classifiedTaskType) {
    case "planning":
    case "architecture":
      return "planning";
    case "debugging":
      return CONCRETE_FIX_PATTERNS.some((pattern) => pattern.test(input.userMessage))
        ? "code_change"
        : "debug_fix";
    case "refactoring":
      return "refactoring";
    case "test_analysis":
      return "test";
    case "small_code_change":
    case "large_code_change":
      return input.classifiedIntent === "build" ? "build" : "code_change";
    case "casual_chat":
    case "normal_chat":
    default:
      return "chat";
  }
}

function resolveRequestedPhase(
  input: WorkflowResolutionInput,
  workflowKind: WorkflowKind
): CanonicalWorkflowPhase | null {
  if (input.requestedPhase) {
    return input.requestedPhase;
  }
  if (
    input.activeContract?.workflowKind === workflowKind &&
    input.activeContract.currentPhase
  ) {
    return input.activeContract.currentPhase;
  }
  return null;
}

function resolveRequestedAgent(
  input: WorkflowResolutionInput,
  workflowKind: WorkflowKind
): WorkflowAgentRole | null {
  if (input.requestedAgent) {
    return input.requestedAgent;
  }
  if (
    input.activeContract?.workflowKind === workflowKind &&
    input.activeContract.requestedAgent
  ) {
    return input.activeContract.requestedAgent;
  }
  if (
    input.activeContract?.workflowKind === workflowKind &&
    input.activeContract.effectiveAgent
  ) {
    return input.activeContract.effectiveAgent;
  }
  return null;
}

function phasePolicyFor(
  workflowKind: WorkflowKind,
  phase: CanonicalWorkflowPhase | null | undefined
): WorkflowPhasePolicy | null {
  if (!phase) return null;
  const policy = WORKFLOW_POLICY_REGISTRY[workflowKind];
  return policy.phases[phase] ?? null;
}

export function resolveCanonicalWorkflowAssignment(
  input: WorkflowResolutionInput
): CanonicalWorkflowAssignment {
  const workflowKind = inferWorkflowKind(input);
  const policy = WORKFLOW_POLICY_REGISTRY[workflowKind];
  const requestedPhase = resolveRequestedPhase(input, workflowKind);
  const requestedAgent = resolveRequestedAgent(input, workflowKind);
  const normalizationReasons: string[] = [];

  let phasePolicy =
    phasePolicyFor(workflowKind, requestedPhase) ??
    policy.phases[policy.initialPhase] ??
    null;
  const phase = phasePolicy?.phase ?? policy.initialPhase;

  if (requestedPhase && !phasePolicyFor(workflowKind, requestedPhase)) {
    normalizationReasons.push("requested_phase_not_in_workflow");
  }

  phasePolicy = phasePolicyFor(workflowKind, phase);
  if (!phasePolicy) {
    throw new Error(`InternalWorkflowPolicyError: missing_phase_policy workflow=${workflowKind} phase=${phase}`);
  }

  let effectiveAgent = phasePolicy.defaultAgent;
  if (requestedAgent && phasePolicy.allowedAgents.includes(requestedAgent)) {
    effectiveAgent = requestedAgent;
  } else if (requestedAgent) {
    normalizationReasons.push("requested_agent_not_allowed_for_phase");
  }

  if (
    workflowKind === "debug_fix" &&
    phase !== "diagnosis" &&
    effectiveAgent === "debugger"
  ) {
    effectiveAgent = phasePolicy.defaultAgent;
    normalizationReasons.push("debugger_restricted_to_diagnosis");
  }

  const invariant = assertValidPhaseAgentPair(phase, effectiveAgent);
  if (!invariant.ok) {
    throw new Error(`InternalWorkflowPolicyError: ${invariant.reason}`);
  }

  let source: CanonicalWorkflowAssignment["source"] = "new_task";
  if (detectDeterministicWorkflow(input.userMessage)) {
    source = "deterministic_operation";
  } else if (input.activeContract?.workflowKind === workflowKind) {
    source = requestedPhase || requestedAgent ? "approved_transition" : "active_workflow";
  }

  return {
    workflowKind,
    phase,
    effectiveAgent,
    modelRole: phasePolicy.modelRole,
    toolProfile: phasePolicy.toolProfile,
    source,
    requestedAgent,
    requestedPhase,
    normalized: normalizationReasons.length > 0,
    normalizationReasons,
    policyVersion: WORKFLOW_POLICY_VERSION
  };
}
