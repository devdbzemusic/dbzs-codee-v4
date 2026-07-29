import { workspaceScopeId } from "@dbzs/shared";
import type { ModelTargetAgent, RuntimeTaskType } from "@dbzs/shared";
import type { RuntimeChatSendOptions, RuntimeChatState } from "@/stores/runtimeChatStore";
import type { IntentClassification } from "@/services/modelSelectionBroker";
import type { ActiveTaskContract } from "@/services/activeTaskContract";
import type { CanonicalWorkflowAssignment } from "@/runtime/workflow/workflowContracts";
import { resolveWorkflowContinuationForSend } from "@/services/runtimeChat/workflowContinuationPhase";
import { runReviewRemediationPhase } from "@/services/runtimeChat/reviewRemediationPhase";
import { normalizeImplementationContinuationRouting } from "@/stores/runtimeChatStoreRuntimeHelpers";
import { answeredFieldIds, readActiveTaskContract, upsertActiveTaskContract } from "@/services/activeTaskContract";
import { workflowForTaskType, checkMissingInformation } from "@/services/missingInformationPolicy";
import { isClarificationFieldBlockedInMessages } from "@/services/runtimeChat/clarificationGuards";
import { lookupProjectDecision } from "@/services/decisionMemoryService";
import { decideClarification } from "@/services/clarificationPolicy";
import { writePendingWorkflowScopeDecision } from "@/services/pendingWorkflowScopeDecision";

type Setter = (
  partial:
    | RuntimeChatState
    | Partial<RuntimeChatState>
    | ((state: RuntimeChatState) => RuntimeChatState | Partial<RuntimeChatState>)
) => void;

type Getter = () => RuntimeChatState;

export interface WorkflowPreludeResult {
  handled: boolean;
  result: boolean;
  effectiveAgent: ModelTargetAgent;
  taskType: RuntimeTaskType;
  intentClassification: IntentClassification;
  activeTaskContract: ActiveTaskContract | null;
  executionIntent: string;
  workflowAssignment: CanonicalWorkflowAssignment;
  workspaceRootForWorkflow: string | null;
  continuation: {
    useActiveContract: boolean;
    reason: string;
  };
  preferPlannerFirst: boolean;
}

export async function resolveWorkflowPreludeAction(input: {
  set: Setter;
  get: Getter;
  trimmedContent: string;
  targetAgent: ModelTargetAgent;
  sendOptions: RuntimeChatSendOptions | undefined;
  isAutoTrivial: boolean;
  taskType: RuntimeTaskType;
  effectiveAgent: ModelTargetAgent;
  intentClassification: IntentClassification;
  activeFileHasContent: boolean;
  workspaceRootEarly: string | null;
}): Promise<WorkflowPreludeResult> {
  const {
    set,
    get,
    trimmedContent,
    sendOptions,
    isAutoTrivial,
    workspaceRootEarly,
    activeFileHasContent
  } = input;
  let { taskType, effectiveAgent, intentClassification } = input;

  const workflowOutcome = resolveWorkflowContinuationForSend({
    trimmedContent,
    sendOptions,
    isAutoTrivial,
    taskType,
    effectiveAgent,
    intentClassification,
    messages: get().messages,
    lastRouting: get().lastRouting,
    lastBrokerDecision: get().lastBrokerDecision,
    lastActivitySummary: get().lastActivity?.summary ?? null,
    activeRunStatus: get().activeRun?.status ?? null
  });

  if (workflowOutcome.kind === "summarize_active_task") {
    set((state) => ({
      messages: [...state.messages, workflowOutcome.userMessage, workflowOutcome.assistantMessage],
      error: null,
      isSending: false,
      isStreaming: false
    }));
    return {
      handled: true,
      result: true,
      effectiveAgent,
      taskType,
      intentClassification,
      activeTaskContract: null,
      executionIntent: "none",
      workflowAssignment: {
        workflowKind: "chat",
        effectiveAgent,
        phase: "clarification",
        source: "new_task",
        requestedAgent: null,
        requestedPhase: null,
        normalized: false,
        normalizationReasons: [],
        policyVersion: 0,
        modelRole: "chat",
        toolProfile: "agent"
      },
      workspaceRootForWorkflow: sendOptions?.workspaceRoot ?? null,
      continuation: { useActiveContract: false, reason: "summary" },
      preferPlannerFirst: true
    };
  }

  if (workflowOutcome.kind === "ambiguity_silent") {
    return {
      handled: true,
      result: false,
      effectiveAgent,
      taskType,
      intentClassification,
      activeTaskContract: null,
      executionIntent: "none",
      workflowAssignment: {
        workflowKind: "chat",
        effectiveAgent,
        phase: "clarification",
        source: "new_task",
        requestedAgent: null,
        requestedPhase: null,
        normalized: false,
        normalizationReasons: [],
        policyVersion: 0,
        modelRole: "chat",
        toolProfile: "agent"
      },
      workspaceRootForWorkflow: sendOptions?.workspaceRoot ?? null,
      continuation: { useActiveContract: false, reason: "ambiguity_silent" },
      preferPlannerFirst: true
    };
  }

  if (workflowOutcome.kind === "ambiguity_ask") {
    writePendingWorkflowScopeDecision(workflowOutcome.pendingDecision);
    set((state) => ({
      messages: [...state.messages, workflowOutcome.userMessage, workflowOutcome.systemMessage]
    }));
    return {
      handled: true,
      result: false,
      effectiveAgent,
      taskType,
      intentClassification,
      activeTaskContract: null,
      executionIntent: "none",
      workflowAssignment: {
        workflowKind: "chat",
        effectiveAgent,
        phase: "clarification",
        source: "new_task",
        requestedAgent: null,
        requestedPhase: null,
        normalized: false,
        normalizationReasons: [],
        policyVersion: 0,
        modelRole: "chat",
        toolProfile: "agent"
      },
      workspaceRootForWorkflow: sendOptions?.workspaceRoot ?? null,
      continuation: { useActiveContract: false, reason: "ambiguity_ask" },
      preferPlannerFirst: true
    };
  }

  let activeTaskContract = workflowOutcome.activeTaskContract;
  const executionIntent = workflowOutcome.executionIntent;
  let workflowAssignment = workflowOutcome.workflowAssignment;
  const workspaceRootForWorkflow = workflowOutcome.workspaceRootForWorkflow;
  const continuation = {
    useActiveContract: workflowOutcome.continuationUseActiveContract,
    reason: workflowOutcome.continuationReason
  };

  const reviewRemediationOutcome = await runReviewRemediationPhase({
    trimmedContent,
    workspaceRootForWorkflow,
    workspaceRootEarly,
    executionIntent,
    activeTaskContract,
    intentClassification,
    appendMessages: (newMessages) => {
      set((state) => ({ messages: [...state.messages, ...newMessages] }));
    },
    markActionRemediationReviews: (questionId, reviews) => {
      set((state) => ({
        messages: state.messages.map((message) => ({
          ...message,
          actions: message.actions?.map((action) =>
            (action.payload?.question as { id?: string } | undefined)?.id === questionId
              ? { ...action, payload: { ...action.payload, remediationReviews: reviews } }
              : action
          )
        }))
      }));
    }
  });
  if (reviewRemediationOutcome.kind === "handled") {
    return {
      handled: true,
      result: false,
      effectiveAgent,
      taskType,
      intentClassification,
      activeTaskContract,
      executionIntent,
      workflowAssignment,
      workspaceRootForWorkflow,
      continuation,
      preferPlannerFirst: true
    };
  }
  if (reviewRemediationOutcome.kind === "continue") {
    activeTaskContract = reviewRemediationOutcome.activeTaskContract;
    effectiveAgent = reviewRemediationOutcome.effectiveAgent;
    taskType = reviewRemediationOutcome.taskType;
    intentClassification = reviewRemediationOutcome.intentClassification;
  }

  let preferPlannerFirst = true;
  if (sendOptions?.preferPlannerFirst === false) {
    preferPlannerFirst = false;
  } else if (
    activeTaskContract?.currentPhase === "executing" ||
    activeTaskContract?.currentPhase === "implementation" ||
    activeTaskContract?.currentPhase === "awaiting_patch_approval" ||
    activeTaskContract?.assignedAgent === "coder"
  ) {
    preferPlannerFirst = false;
  }
  const implementationRouting = normalizeImplementationContinuationRouting({
    phase: activeTaskContract?.currentPhase,
    taskType,
    contractTaskType: activeTaskContract?.taskType,
    targetAgent: effectiveAgent,
    preferPlannerFirst
  });
  if (implementationRouting.normalized) {
    taskType = implementationRouting.taskType;
    effectiveAgent = implementationRouting.targetAgent;
    preferPlannerFirst = implementationRouting.preferPlannerFirst;
    intentClassification = { ...intentClassification, taskType };
  }

  const clarificationWorkflow = workflowForTaskType(taskType);
  if (clarificationWorkflow && !isAutoTrivial) {
    const workspaceRootForClarification = sendOptions?.workspaceRoot ?? null;
    const contractForClarification =
      activeTaskContract ?? readActiveTaskContract(workspaceRootForClarification);
    const answeredFields = answeredFieldIds(contractForClarification);
    const missingFields = checkMissingInformation(
      clarificationWorkflow,
      taskType,
      trimmedContent,
      activeFileHasContent,
      {
        answeredFields,
        confirmedGoal: contractForClarification?.confirmedGoal,
        acceptanceCriteria: contractForClarification?.acceptanceCriteria
      }
    );

    const workspaceIdForClarification = workspaceRootForClarification
      ? workspaceScopeId(workspaceRootForClarification)
      : "";

    const unresolvedFields: typeof missingFields = [];
    for (const field of missingFields) {
      if (field.present) continue;
      if (answeredFields.has(field.field)) continue;
      if (
        workspaceIdForClarification &&
        isClarificationFieldBlockedInMessages(get().messages, workspaceIdForClarification, field.field)
      ) {
        continue;
      }
      const remembered = workspaceRootForClarification
        ? await lookupProjectDecision(workspaceRootForClarification, clarificationWorkflow, field.askIfMissing.prompt)
        : null;
      if (!remembered) {
        unresolvedFields.push(field);
      }
    }

    const riskLevel: "low" | "medium" | "high" =
      clarificationWorkflow === "coding" &&
      (taskType === "large_code_change" || taskType === "refactoring")
        ? "high"
        : clarificationWorkflow === "coding" && taskType === "small_code_change"
          ? "medium"
          : "low";

    const questionsAskedThisRun = get().messages.filter((m) =>
      m.actions?.some(
        (a) =>
          a.kind === "answer_question" &&
          (a.payload as { question?: { toolCallId?: string } } | undefined)?.question?.toolCallId ===
            "missing-information-policy"
      )
    ).length;

    const clarification = decideClarification({
      intent: intentClassification,
      missingFields: unresolvedFields,
      riskLevel,
      questionsAskedThisTurn: 0,
      questionsAskedThisRun
    });

    if (clarification.shouldAsk && clarification.question) {
      const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const messageId = `msg-${Date.now().toString(36)}-preflight-ask`;
      const question = clarification.question;
      const actionWorkspaceRoot = workspaceRootForClarification ?? "";
      if (workspaceRootForClarification) {
        const existingContract = readActiveTaskContract(workspaceRootForClarification);
        activeTaskContract = upsertActiveTaskContract(workspaceRootForClarification, {
          originalRequest: existingContract?.originalRequest ?? trimmedContent,
          confirmedGoal: existingContract?.confirmedGoal || trimmedContent,
          taskType: existingContract?.taskType ?? taskType,
          assignedAgent: existingContract?.assignedAgent ?? effectiveAgent,
          currentPhase: "clarification",
          workflowKind: workflowAssignment.workflowKind,
          effectiveAgent: workflowAssignment.effectiveAgent,
          requestedAgent: workflowAssignment.requestedAgent ?? undefined,
          policyVersion: workflowAssignment.policyVersion,
          modelRole: workflowAssignment.modelRole,
          toolProfile: workflowAssignment.toolProfile,
          runId
        });
      }
      const action: import("@dbzs/shared").ChatActionRequest = {
        id: `act-${Math.random().toString(36).substring(2, 10)}`,
        runId,
        messageId,
        workspaceRoot: actionWorkspaceRoot,
        workspaceId: workspaceScopeId(actionWorkspaceRoot),
        kind: "answer_question",
        title: question.prompt,
        description: question.context,
        riskLevel: question.riskLevel,
        payload: {
          question,
          preflight: {
            originalMessage: trimmedContent,
            targetAgent: workflowAssignment.effectiveAgent,
            workspaceRoot: workspaceRootForClarification,
            workflow: clarificationWorkflow,
            taskType,
            hasImageInput: sendOptions?.hasImageInput === true,
            requiresVision: sendOptions?.requiresVision === true
          }
        },
        state: "pending",
        createdAt: new Date().toISOString()
      };
      set((state) => ({
        messages: [
          ...state.messages,
          { id: `msg-${Date.now().toString(36)}-user-preflight`, role: "user", content: trimmedContent },
          { id: messageId, role: "system", content: question.prompt, actions: [action] }
        ]
      }));
      return {
        handled: true,
        result: false,
        effectiveAgent,
        taskType,
        intentClassification,
        activeTaskContract,
        executionIntent,
        workflowAssignment,
        workspaceRootForWorkflow,
        continuation,
        preferPlannerFirst
      };
    }
  }

  return {
    handled: false,
    result: false,
    effectiveAgent,
    taskType,
    intentClassification,
    activeTaskContract,
    executionIntent,
    workflowAssignment,
    workspaceRootForWorkflow,
    continuation,
    preferPlannerFirst
  };
}
