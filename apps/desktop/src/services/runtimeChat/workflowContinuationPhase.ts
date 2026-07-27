import type { ChatActionRequest, ModelTargetAgent, RuntimeChatMessage, RuntimeTaskType } from "@dbzs/shared";
import type { IntentClassification, ModelSelectionDecision } from "@/services/modelSelectionBroker";
import type { RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";
import type { RuntimeChatSendOptions } from "@/stores/runtimeChatStore";
import {
  clearActiveTaskContract,
  pauseActiveTaskContract,
  readActiveTaskContract,
  type ActiveTaskContract
} from "@/services/activeTaskContract";
import { classifyUserExecutionIntent } from "@/services/executionIntent";
import { REVIEW_REMEDIATION_WORKFLOW_ID, resolveReviewRemediationAgent } from "@/services/reviewRemediation";
import {
  buildWorkflowAmbiguityQuestion,
  isExplicitNewTaskMessage,
  resolveWorkflowContinuation
} from "@/services/workflowContinuation";
import { resolveCanonicalWorkflowAssignment } from "@/runtime/workflow/workflowStateResolver";
import { detectConversationMetaIntent, buildDeterministicActiveTaskSummary } from "@/services/conversationMetaIntent";
import { readPendingWorkflowScopeDecision, writePendingWorkflowScopeDecision } from "@/services/pendingWorkflowScopeDecision";
import { workspaceScopeId } from "@dbzs/shared";
import { mapWorkflowAgentToShared } from "@/services/runtimeChat/agentMapping";
import { isClarificationFieldBlockedInMessages } from "@/services/runtimeChat/clarificationGuards";

export interface WorkflowContinuationInput {
  trimmedContent: string;
  sendOptions?: RuntimeChatSendOptions;
  isAutoTrivial: boolean;
  taskType: RuntimeTaskType;
  effectiveAgent: ModelTargetAgent;
  intentClassification: IntentClassification;
  messages: RuntimeChatMessage[];
  lastRouting: RuntimeChatRoutingInfo | null;
  lastBrokerDecision: ModelSelectionDecision | null;
  lastActivitySummary: string | null;
  activeRunStatus: string | null;
}

export type WorkflowContinuationOutcome =
  | {
      kind: "summarize_active_task";
      userMessage: RuntimeChatMessage;
      assistantMessage: RuntimeChatMessage;
    }
  | { kind: "ambiguity_silent" }
  | {
      kind: "ambiguity_ask";
      userMessage: RuntimeChatMessage;
      systemMessage: RuntimeChatMessage;
      pendingDecision: Parameters<typeof writePendingWorkflowScopeDecision>[0];
    }
  | {
      kind: "continue";
      taskType: RuntimeTaskType;
      effectiveAgent: ModelTargetAgent;
      intentClassification: IntentClassification;
      activeTaskContract: ActiveTaskContract | null;
      continuationUseActiveContract: boolean;
      continuationReason: ReturnType<typeof resolveWorkflowContinuation>["reason"];
      executionIntent: ReturnType<typeof classifyUserExecutionIntent>;
      workflowAssignment: ReturnType<typeof resolveCanonicalWorkflowAssignment>;
      workspaceRootForWorkflow: string | null;
      activeContract: ActiveTaskContract | null;
    };

/**
 * Resolves whether this turn continues the active task contract, starts a
 * new one, needs an ambiguity ask, or is answerable directly (meta-intent
 * summary). Pure — performs no store `set()`/return; the caller acts on the
 * returned outcome. `clearActiveTaskContract`/`pauseActiveTaskContract` are
 * persistence writes (not React state), matching how `directIntentClassifier`
 * already reads/writes workspace state outside of `set()`.
 */
export function resolveWorkflowContinuationForSend(
  input: WorkflowContinuationInput
): WorkflowContinuationOutcome {
  const {
    trimmedContent,
    sendOptions,
    isAutoTrivial,
    messages
  } = input;
  let taskType = input.taskType;
  let effectiveAgent = input.effectiveAgent;
  let intentClassification = input.intentClassification;

  const workspaceRootForWorkflow = sendOptions?.workspaceRoot ?? null;
  if (workspaceRootForWorkflow && (isExplicitNewTaskMessage(trimmedContent) || sendOptions?.forceNewTask)) {
    if (sendOptions?.forceNewTask) {
      // Already paused by submitAssistantAnswer; ensure active slot is clear.
      if (readActiveTaskContract(workspaceRootForWorkflow)) {
        pauseActiveTaskContract(workspaceRootForWorkflow);
      }
    } else {
      clearActiveTaskContract(workspaceRootForWorkflow);
    }
  }
  const activeContract = readActiveTaskContract(workspaceRootForWorkflow);
  let continuation = isAutoTrivial
    ? {
        useActiveContract: false,
        taskType: "casual_chat" as RuntimeTaskType,
        reason: "single_message_intent" as const,
        contract: null,
        needsAmbiguityAsk: false
      }
    : resolveWorkflowContinuation({
        message: trimmedContent,
        contract: activeContract,
        classifiedTaskType: taskType
      });
  if (sendOptions?.forceContinueActiveWorkflow && activeContract) {
    continuation = {
      useActiveContract: true,
      taskType: sendOptions.stickyTaskType ?? activeContract.taskType,
      reason: "active_workflow_continue",
      contract: activeContract,
      needsAmbiguityAsk: false
    };
  } else if (sendOptions?.forceNewTask) {
    continuation = {
      useActiveContract: false,
      taskType,
      reason: "explicit_new_task",
      contract: null,
      needsAmbiguityAsk: false
    };
  }
  let activeTaskContract = continuation.contract;
  if (continuation.useActiveContract) {
    taskType = continuation.taskType;
    intentClassification = { ...intentClassification, taskType: continuation.taskType };
  }
  if (isAutoTrivial) {
    activeTaskContract = null;
    taskType = "casual_chat";
    intentClassification = { ...intentClassification, taskType: "casual_chat" };
    effectiveAgent = "runtime_chat";
  }
  const executionIntent = classifyUserExecutionIntent(trimmedContent);
  if (
    activeTaskContract?.workflowId === REVIEW_REMEDIATION_WORKFLOW_ID &&
    activeTaskContract.reviewRemediation
  ) {
    effectiveAgent = resolveReviewRemediationAgent(
      activeTaskContract.currentPhase,
      activeTaskContract.currentPhase === "failed" &&
        /\b(failed|fehlgeschlagen|error|fehler|check)\b/i.test(trimmedContent)
    );
  }

  const workflowAssignment = resolveCanonicalWorkflowAssignment({
    userMessage: trimmedContent,
    classifiedIntent: executionIntent,
    classifiedTaskType: taskType,
    activeContract: isAutoTrivial ? null : continuation.useActiveContract ? activeTaskContract : null,
    explicitWorkflowKind:
      activeTaskContract?.workflowId === REVIEW_REMEDIATION_WORKFLOW_ID
        ? "review_remediation"
        : null,
    requestedAgent:
      !isAutoTrivial && continuation.useActiveContract && activeTaskContract
        ? (activeTaskContract.requestedAgent ?? activeTaskContract.assignedAgent)
        : null,
    requestedPhase: !isAutoTrivial && continuation.useActiveContract ? activeTaskContract?.currentPhase ?? null : null
  });
  effectiveAgent = mapWorkflowAgentToShared(workflowAssignment.effectiveAgent);

  const metaIntent = detectConversationMetaIntent(trimmedContent);
  if (metaIntent === "summarize_active_task") {
    const summaryText = buildDeterministicActiveTaskSummary({
      contract: activeTaskContract,
      lastRouting: input.lastRouting,
      lastBrokerDecision: input.lastBrokerDecision,
      lastRunOutcome: input.lastActivitySummary ?? input.activeRunStatus ?? null,
      warmupDetail:
        input.lastRouting?.warmupStatus === "failed"
          ? "warmup_failed"
          : input.lastRouting?.warmupStatus ?? null
    });
    return {
      kind: "summarize_active_task",
      userMessage: { id: `msg-${Date.now().toString(36)}-user-summary`, role: "user", content: trimmedContent },
      assistantMessage: {
        id: `msg-${Date.now().toString(36)}-assistant-summary`,
        role: "assistant",
        content: summaryText
      }
    };
  }

  if (continuation.needsAmbiguityAsk && activeContract && workspaceRootForWorkflow) {
    const workspaceId = workspaceScopeId(workspaceRootForWorkflow);
    if (
      isClarificationFieldBlockedInMessages(messages, workspaceId, "workflow_scope_decision") ||
      readPendingWorkflowScopeDecision(workspaceRootForWorkflow)
    ) {
      return { kind: "ambiguity_silent" };
    }

    const ambiguity = buildWorkflowAmbiguityQuestion(activeContract);
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const messageId = `msg-${Date.now().toString(36)}-workflow-ambiguity`;
    const userMessageId = `msg-${Date.now().toString(36)}-user-ambiguity`;
    const actionId = `act-${Math.random().toString(36).substring(2, 10)}`;
    const action: ChatActionRequest = {
      id: actionId,
      runId,
      messageId,
      workspaceRoot: workspaceRootForWorkflow,
      workspaceId,
      kind: "answer_question",
      title: "Workflow-Fortsetzung",
      description: ambiguity.context,
      riskLevel: "low",
      payload: {
        question: ambiguity.question,
        preflight: {
          originalMessage: trimmedContent,
          targetAgent: effectiveAgent,
          workspaceRoot: workspaceRootForWorkflow,
          workflow: "workflow_ambiguity",
          taskType: activeContract.taskType
        }
      },
      state: "pending",
      createdAt: new Date().toISOString()
    };
    return {
      kind: "ambiguity_ask",
      userMessage: { id: userMessageId, role: "user", content: trimmedContent },
      systemMessage: { id: messageId, role: "system", content: ambiguity.prompt, actions: [action] },
      pendingDecision: {
        workspaceId,
        workspaceRoot: workspaceRootForWorkflow,
        activeWorkflowId: activeContract.workflowId,
        triggeringMessageId: userMessageId,
        triggeringMessage: trimmedContent,
        questionId: ambiguity.question.id,
        actionId,
        messageId,
        createdAt: new Date().toISOString()
      }
    };
  }

  return {
    kind: "continue",
    taskType,
    effectiveAgent,
    intentClassification,
    activeTaskContract,
    continuationUseActiveContract: continuation.useActiveContract,
    continuationReason: continuation.reason,
    executionIntent,
    workflowAssignment,
    workspaceRootForWorkflow,
    activeContract
  };
}
