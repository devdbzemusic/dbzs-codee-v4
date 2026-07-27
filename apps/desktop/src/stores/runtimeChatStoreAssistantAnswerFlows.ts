import type {
  AssistantAnswer,
  AssistantQuestion,
  ClarificationWorkflow,
  ModelTargetAgent,
  ReviewRemediationSelectionScope,
  RuntimeTaskType
} from "@dbzs/shared";
import {
  appendContractFieldAnswer,
  pauseActiveTaskContract,
  readActiveTaskContract,
  upsertActiveTaskContract
} from "@/services/activeTaskContract";
import { recordProjectDecision } from "@/services/decisionMemoryService";
import { clearPendingQuestion } from "@/services/pendingQuestionPersistence";
import {
  clearPendingWorkflowScopeDecision,
  readPendingWorkflowScopeDecision
} from "@/services/pendingWorkflowScopeDecision";
import {
  applyReviewRemediationSelection,
  applySelectedReviewFindingIds,
  finishReviewRemediationSelection,
  readReviewRemediationSelection
} from "@/services/reviewRemediationSelection";
import { markResourceRiskAccepted } from "@/services/runtimeResourceRisk";
import { workflowScopeDecisionLabel, type WorkflowScopeOptionId } from "@/services/workflowContinuation";

export type AssistantAnswerPreflight = {
  originalMessage: string;
  targetAgent: ModelTargetAgent;
  workspaceRoot: string | null;
  workflow: string;
  taskType?: RuntimeTaskType;
};

export type RehydratedPendingQuestionState = {
  workspaceRoot: string;
  question: AssistantQuestion;
  goal: string;
  targetAgent: ModelTargetAgent;
  profile?: string | null;
};

type SendMessageFn = (
  message: string,
  targetAgent: ModelTargetAgent,
  options: {
    workspaceRoot: string | null;
    stickyTaskType?: RuntimeTaskType;
    preferPlannerFirst?: boolean;
    forceContinueActiveWorkflow?: boolean;
    forceNewTask?: boolean;
    forceUseResidentModel?: boolean;
    acceptResourceRisk?: boolean;
    runtimeProfileOverride?: "hybrid" | "cpu_safe";
    toolProfile?: string | null;
    agentMode?: "agent";
    useAgentTurnLoop?: boolean;
    hasImageInput?: boolean;
    requiresVision?: boolean;
  }
) => Promise<void>;

export function summarizeAssistantAnswer(answer: AssistantAnswer) {
  return answer.freeText ?? answer.optionIds?.join(", ") ?? (answer.skipped ? "(keine Antwort)" : "");
}

export async function clearSkippedPreflightAssistantAnswer(workspaceRoot: string | null) {
  if (!workspaceRoot) {
    return;
  }
  await clearPendingQuestion(workspaceRoot).catch(() => {});
  clearPendingWorkflowScopeDecision(workspaceRoot);
}

export async function handleRehydratedAssistantAnswerFlow(input: {
  rehydrated: RehydratedPendingQuestionState | null;
  question: AssistantQuestion | undefined;
  answer: AssistantAnswer;
  sendMessage: SendMessageFn;
}): Promise<boolean> {
  if (!input.rehydrated || input.rehydrated.question.id !== input.question?.id) {
    return false;
  }

  await clearPendingQuestion(input.rehydrated.workspaceRoot).catch(() => {});

  const answerSummary = summarizeAssistantAnswer(input.answer);
  if (!input.answer.skipped && input.question) {
    appendContractFieldAnswer(
      input.rehydrated.workspaceRoot,
      input.question.requiredField,
      input.question.id,
      input.question.prompt,
      answerSummary
    );
  }

  const continuationContent =
    `[Fortsetzung nach Neustart] Rückfrage "${input.rehydrated.question.prompt}" wurde beantwortet: ${answerSummary}\n\n` +
    `Ursprüngliches Ziel: ${input.rehydrated.goal}`;

  await input.sendMessage(continuationContent, input.rehydrated.targetAgent, {
    workspaceRoot: input.rehydrated.workspaceRoot,
    toolProfile: input.rehydrated.profile ?? null,
    agentMode: "agent",
    useAgentTurnLoop: true
  });
  return true;
}

export async function handleReviewRemediationAssistantAnswerFlow(input: {
  preflight: AssistantAnswerPreflight | undefined;
  question: AssistantQuestion | undefined;
  answer: AssistantAnswer;
  sendMessage: SendMessageFn;
}): Promise<boolean> {
  if (!input.preflight?.workspaceRoot || !input.question) {
    return false;
  }

  if (input.question.requiredField === "review_remediation_selection") {
    if (input.answer.skipped) {
      await finishReviewRemediationSelection(input.preflight.workspaceRoot, "cancelled");
      return true;
    }
    const reviewId = input.answer.optionIds?.[0];
    const scope = input.answer.optionIds?.[1] as ReviewRemediationSelectionScope | undefined;
    if (!reviewId || !scope || !["all", "p0_p1", "p0_p2", "selected"].includes(scope)) {
      return true;
    }
    const applied = await applyReviewRemediationSelection(input.preflight.workspaceRoot, {
      questionId: input.answer.questionId,
      reviewId,
      scope
    });
    if (!applied) {
      return true;
    }
    await input.sendMessage(input.preflight.originalMessage, "planner", {
      workspaceRoot: input.preflight.workspaceRoot,
      stickyTaskType: "planning",
      preferPlannerFirst: true,
      forceContinueActiveWorkflow: true
    });
    return true;
  }

  if (input.question.requiredField === "remediation_scope") {
    const selection = await readReviewRemediationSelection(input.preflight.workspaceRoot);
    if (selection?.scope !== "selected") {
      return false;
    }
    if (input.answer.skipped) {
      await finishReviewRemediationSelection(input.preflight.workspaceRoot, "cancelled");
      return true;
    }
    const applied = await applySelectedReviewFindingIds(
      input.preflight.workspaceRoot,
      input.answer.questionId,
      input.answer.optionIds ?? []
    );
    if (!applied) {
      return true;
    }
    await input.sendMessage(input.preflight.originalMessage, "planner", {
      workspaceRoot: input.preflight.workspaceRoot,
      stickyTaskType: "planning",
      forceContinueActiveWorkflow: true
    });
    return true;
  }

  return false;
}

export async function handleWorkflowScopeAssistantAnswerFlow(input: {
  preflight: AssistantAnswerPreflight;
  selectedOptionId: WorkflowScopeOptionId | null;
  sendMessage: SendMessageFn;
}): Promise<boolean> {
  const optionId = input.selectedOptionId;
  if (optionId !== "continue_active_task" && optionId !== "start_new_task") {
    return true;
  }

  const pendingDecision = input.preflight.workspaceRoot
    ? readPendingWorkflowScopeDecision(input.preflight.workspaceRoot)
    : null;
  const originalMessage =
    pendingDecision?.triggeringMessage?.trim() || input.preflight.originalMessage.trim();

  if (input.preflight.workspaceRoot) {
    clearPendingWorkflowScopeDecision(input.preflight.workspaceRoot);
    await clearPendingQuestion(input.preflight.workspaceRoot).catch(() => {});
  }

  if (optionId === "start_new_task" && input.preflight.workspaceRoot) {
    pauseActiveTaskContract(input.preflight.workspaceRoot);
  }

  await input.sendMessage(originalMessage, input.preflight.targetAgent, {
    workspaceRoot: input.preflight.workspaceRoot,
    stickyTaskType: optionId === "continue_active_task" ? input.preflight.taskType : undefined,
    preferPlannerFirst: true,
    hasImageInput: false,
    requiresVision: false,
    forceContinueActiveWorkflow: optionId === "continue_active_task",
    forceNewTask: optionId === "start_new_task"
  });
  return true;
}

export async function handleResourceRiskAssistantAnswerFlow(input: {
  preflight: AssistantAnswerPreflight;
  rawOptionId: string | null;
  lastRoutingSlotId?: string | null;
  lastResolvedModelId?: string | null;
  sendMessage: SendMessageFn;
  appendSystemMessage: (content: string) => void;
}): Promise<boolean> {
  const optionId = input.rawOptionId;
  if (!optionId) {
    return true;
  }

  if (optionId === "abort_start") {
    return true;
  }

  if (optionId === "choose_other_model") {
    input.appendSystemMessage(
      "Bitte wähle im Settings-/Runtime-Panel ein anderes Rollenmodell und sende die Anfrage erneut. Es erfolgt kein stiller Modellwechsel."
    );
    return true;
  }

  if (optionId === "continue_with_resident") {
    await input.sendMessage(input.preflight.originalMessage, input.preflight.targetAgent, {
      workspaceRoot: input.preflight.workspaceRoot,
      stickyTaskType: input.preflight.taskType,
      preferPlannerFirst: true,
      forceUseResidentModel: true,
      acceptResourceRisk: true
    });
    return true;
  }

  if (optionId === "smaller_profile" || optionId === "cpu_safe_profile") {
    const slotHint = input.lastRoutingSlotId ?? "fast_gpu";
    if (input.lastResolvedModelId) {
      markResourceRiskAccepted(String(slotHint), input.lastResolvedModelId);
    }
    await input.sendMessage(input.preflight.originalMessage, input.preflight.targetAgent, {
      workspaceRoot: input.preflight.workspaceRoot,
      stickyTaskType: input.preflight.taskType,
      preferPlannerFirst: true,
      acceptResourceRisk: true,
      runtimeProfileOverride: optionId === "smaller_profile" ? "hybrid" : "cpu_safe"
    });
    return true;
  }

  return true;
}

export async function handleClarificationAssistantAnswerFlow(input: {
  preflight: AssistantAnswerPreflight;
  question: AssistantQuestion | undefined;
  answer: AssistantAnswer;
  sendMessage: SendMessageFn;
}): Promise<boolean> {
  if (!input.question) {
    return false;
  }

  if (input.answer.skipped) {
    if (input.preflight.workspaceRoot) {
      await clearPendingQuestion(input.preflight.workspaceRoot).catch(() => {});
      clearPendingWorkflowScopeDecision(input.preflight.workspaceRoot);
    }
    return true;
  }

  if (input.preflight.workspaceRoot) {
    await recordProjectDecision(
      input.preflight.workspaceRoot,
      input.preflight.workflow as ClarificationWorkflow,
      input.question.prompt,
      input.answer
    ).catch(() => {});

    const answerSummary = summarizeAssistantAnswer(input.answer);
    appendContractFieldAnswer(
      input.preflight.workspaceRoot,
      input.question.requiredField,
      input.question.id,
      input.question.prompt,
      answerSummary
    );
    await clearPendingQuestion(input.preflight.workspaceRoot).catch(() => {});

    const existing = readActiveTaskContract(input.preflight.workspaceRoot);
    if (existing) {
      const promptLower = input.question.prompt.toLowerCase();
      const goalLooksLikeFeature =
        input.question.requiredField === "target" ||
        promptLower.includes("funktion") ||
        promptLower.includes("feature");
      upsertActiveTaskContract(input.preflight.workspaceRoot, {
        originalRequest: existing.originalRequest,
        confirmedGoal: goalLooksLikeFeature && answerSummary ? answerSummary : existing.confirmedGoal,
        taskType: input.preflight.taskType ?? existing.taskType,
        assignedAgent: existing.assignedAgent,
        currentPhase: "planning"
      });
    }
  }

  const answerSummary = summarizeAssistantAnswer(input.answer);
  const continuationContent = `${input.preflight.originalMessage}\n\n${answerSummary}`.trim();
  await input.sendMessage(continuationContent, input.preflight.targetAgent, {
    workspaceRoot: input.preflight.workspaceRoot,
    stickyTaskType: input.preflight.taskType,
    preferPlannerFirst: true,
    hasImageInput: false,
    requiresVision: false
  });
  return true;
}

export { workflowScopeDecisionLabel };
export type { WorkflowScopeOptionId };
