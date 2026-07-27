import type {
  ContextManifest,
  ReasoningTraceEvent,
  RetrievalManifest,
  RuntimeChatMessage,
  RuntimeChatTurn,
  RuntimeRunOutcome,
  RuntimeSlotId,
  SafeReasoningSummary,
  SourceReference
} from "@dbzs/shared";
import type { RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";
import type { AgentChatRunnerResult } from "@/services/runtimeChatAgentRunner";
import type { UserExecutionIntent } from "@/services/executionIntent";
import {
  finalizeRuntimeRun,
  type FinalizeRuntimeRunResult
} from "@/services/runtimeRunFinalization";
import { gateExecutionFinalAnswer } from "@/services/executionAnswerValidation";
import { createTraceEvent } from "@/services/ragClient";
import {
  hasPendingPlanApproval,
  mergeAssistantMessageState
} from "@/stores/runtimeChatStoreMessageHelpers";
export async function finalizeAgentTurnResult(input: {
  agentResult: AgentChatRunnerResult;
  currentMessages: RuntimeChatMessage[];
  trimmedContent: string;
  executionIntentForTurn: UserExecutionIntent;
  toolsEnabled: boolean;
  workspaceRoot?: string | null;
  initialRunId: string;
  routing: RuntimeChatRoutingInfo;
  contextSlotId: RuntimeSlotId | null | undefined;
  safeTraceEvents: ReasoningTraceEvent[];
  ragManifest?: RetrievalManifest;
  ragSourceReferences?: SourceReference[];
  spoolerManifest?: ContextManifest | null;
  tokenBudget: {
    runtimeContextLimit?: number | null;
    totalRequiredTokens?: number | null;
  } | null | undefined;
  firstTokenAt?: string | null;
  taskType: string;
  activeTaskPhase?: string | null;
  reasoningTraceEnabled: boolean;
  applyPlanningRelevanceGate: (answer: string) => Promise<{
    content: string;
    outcome?: RuntimeRunOutcome;
  }>;
  persistTraceEvents: (events: ReasoningTraceEvent[]) => Promise<{
    events?: ReasoningTraceEvent[];
    summary?: SafeReasoningSummary;
  } | null>;
  startedAt?: string;
}): Promise<{
  resultMessages: RuntimeChatMessage[];
  finalizedAssistantMessage: RuntimeChatMessage;
  finalization: FinalizeRuntimeRunResult;
  persistedAgentTurn: RuntimeChatTurn;
  success: boolean;
}> {
  let agentAssistantContent = input.agentResult.assistantMessage.content;
  const agentPlanningLike =
    input.taskType === "planning" ||
    input.taskType === "architecture" ||
    input.activeTaskPhase === "planning";
  let agentRelevanceFailed = false;
  if (agentPlanningLike && typeof agentAssistantContent === "string") {
    const gated = await input.applyPlanningRelevanceGate(agentAssistantContent);
    agentAssistantContent = gated.content;
    agentRelevanceFailed = gated.outcome === "answer_relevance_failed";
  }

  const resultMessages: RuntimeChatMessage[] = [...input.currentMessages];
  const lastIndex = resultMessages.length - 1;
  let finalizedAssistantMessage: RuntimeChatMessage;
  const gatedAssistantMessage = {
    ...input.agentResult.assistantMessage,
    content: agentAssistantContent,
    rawContent: input.agentResult.assistantMessage.rawContent ?? agentAssistantContent,
    visibleContent: agentAssistantContent
  };
  if (lastIndex >= 0 && resultMessages[lastIndex]?.role === "assistant") {
    finalizedAssistantMessage = mergeAssistantMessageState(
      resultMessages[lastIndex],
      gatedAssistantMessage,
      { workspaceRoot: input.workspaceRoot ?? undefined }
    );
    input.safeTraceEvents.push(
      createTraceEvent(
        input.initialRunId,
        "run_completed",
        "Antwort abgeschlossen",
        `${input.agentResult.turnsExecuted ?? 0} Agent-Turns ausgeführt`
      )
    );
    try {
      const persistedTrace = input.reasoningTraceEnabled
        ? await input.persistTraceEvents(input.safeTraceEvents)
        : null;
      resultMessages[lastIndex] = {
        ...finalizedAssistantMessage,
        traceEvents: persistedTrace?.events ?? input.safeTraceEvents,
        safeReasoningSummary: persistedTrace?.summary,
        retrievalManifest: input.ragManifest,
        contextManifest: input.spoolerManifest ?? undefined,
        sourceReferences: input.ragSourceReferences
      };
    } catch (error) {
      console.warn("Execution trace persistence failed:", error);
      resultMessages[lastIndex] = {
        ...finalizedAssistantMessage,
        traceEvents: input.safeTraceEvents,
        retrievalManifest: input.ragManifest,
        contextManifest: input.spoolerManifest ?? undefined,
        sourceReferences: input.ragSourceReferences
      };
    }
  } else {
    finalizedAssistantMessage = mergeAssistantMessageState(
      {
        id: input.agentResult.assistantMessage.id,
        role: input.agentResult.assistantMessage.role,
        content: "",
        rawContent: "",
        visibleContent: ""
      },
      gatedAssistantMessage,
      { workspaceRoot: input.workspaceRoot ?? undefined }
    );
    resultMessages.push(finalizedAssistantMessage);
  }
  for (const sys of input.agentResult.systemMessages) {
    resultMessages.push(sys);
  }

  const waitingForPlanApproval = hasPendingPlanApproval(finalizedAssistantMessage);
  const lastResponse = input.agentResult.lastResponse as
    | {
        safe_fallback?: boolean;
        finish_reason?: string | null;
        provider_error?: unknown;
      }
    | null
    | undefined;
  const completedToolCalls =
    input.agentResult.toolCallsExecuted ??
    input.agentResult.assistantMessage.toolCalls?.length ??
    0;
  const providerErrorPresent =
    Boolean(lastResponse?.provider_error) || lastResponse?.safe_fallback === true;
  const executionGate = gateExecutionFinalAnswer({
    userMessage: input.trimmedContent,
    executionIntent: input.executionIntentForTurn,
    finalAnswer: agentAssistantContent,
    toolCallsExecuted: completedToolCalls,
    toolNames: (input.agentResult.assistantMessage.toolCalls ?? []).map((call) => call.name),
    toolsEnabled: input.toolsEnabled,
    workspaceRoot: input.workspaceRoot ?? null
  });
  const terminalReason = input.agentResult.terminalReason;
  const terminalOutcome: RuntimeRunOutcome | null =
    terminalReason === "execution_no_action"
      ? "execution_no_action"
      : terminalReason === "invalid_protocol"
        ? "invalid_protocol"
        : terminalReason === "skill_tool_policy_violation"
          ? "skill_tool_policy_violation"
          : null;
  const executionRejected =
    !waitingForPlanApproval &&
    !agentRelevanceFailed &&
    !providerErrorPresent &&
    (Boolean(terminalOutcome) || executionGate.rejectAsInvalid);
  const gatedFinalAnswer = executionRejected
    ? terminalOutcome
      ? terminalReason === "execution_no_action"
        ? "Im Ausführungsmodus wurden keine Tools, Patches oder Commands ausgeführt."
        : terminalReason === "skill_tool_policy_violation"
          ? "Der aktive Skill hat einen nicht erlaubten Tool-Aufruf blockiert."
          : "Die strukturierte Agent-Ausgabe war ungültig (Protocol Failure)."
      : (executionGate.userMessage ?? agentAssistantContent)
    : agentAssistantContent;

  if (executionRejected && lastIndex >= 0 && resultMessages[lastIndex]?.role === "assistant") {
    resultMessages[lastIndex] = {
      ...resultMessages[lastIndex],
      content: gatedFinalAnswer,
      visibleContent: gatedFinalAnswer,
      rawContent: agentAssistantContent
    };
  }

  const finalization = finalizeRuntimeRun({
    runId: input.initialRunId,
    outcome: agentRelevanceFailed
      ? "answer_relevance_failed"
      : waitingForPlanApproval
        ? "needs_user_input"
        : providerErrorPresent
          ? "generation_failed"
          : terminalOutcome
            ? terminalOutcome
            : executionRejected
              ? "agent_output_invalid"
              : "success",
    finalAnswer: gatedFinalAnswer,
    safeFallback: lastResponse?.safe_fallback === true,
    providerError: providerErrorPresent,
    parserSkippedReason: providerErrorPresent ? "provider_error" : undefined,
    agentTurnCount: input.agentResult.turnsExecuted ?? 0,
    pendingToolCalls: 0,
    completedToolCalls,
    trajectoryStatus: input.agentResult.trajectory?.status ?? null,
    modelId: input.routing.modelId,
    modelName: input.routing.modelName,
    slotId: input.contextSlotId,
    finishReason: lastResponse?.finish_reason ?? null,
    rawContent: input.agentResult.assistantMessage.rawContent ?? agentAssistantContent,
    pipeline: {
      runtimeReady: true,
      inferenceReady: input.routing.warmupStatus === "ready" || input.routing.warmupStatus == null,
      firstTokenReceived: Boolean(input.firstTokenAt),
      modelOutputReceived: Boolean((gatedFinalAnswer ?? "").trim() || lastResponse?.safe_fallback),
      outputParsed: providerErrorPresent ? false : !agentRelevanceFailed && !executionRejected,
      agentLoopCompleted: true,
      finalAnswerDelivered: false
    },
    contextWindowTokens: input.tokenBudget?.runtimeContextLimit ?? null,
    totalRequiredTokens: input.tokenBudget?.totalRequiredTokens ?? null
  });

  const turnStartedAt = input.startedAt ?? new Date().toISOString();
  const turnFinishedAt = new Date().toISOString();
  const persistedAgentTurn: RuntimeChatTurn = {
    id: `turn-${input.initialRunId}-${input.agentResult.turnsExecuted ?? 1}`,
    turnNumber: Math.max(1, input.agentResult.turnsExecuted ?? 1),
    prompt: input.trimmedContent,
    response: input.agentResult.assistantMessage.rawContent ?? agentAssistantContent,
    startedAt: turnStartedAt,
    finishedAt: turnFinishedAt,
    durationMs: Date.now() - new Date(turnStartedAt).getTime()
  };

  if (finalization.suppressAssistantSuccess) {
    const errorBubble = finalization.error?.userMessage ?? finalization.userMessage;
    if (lastIndex >= 0 && resultMessages[lastIndex]?.role === "assistant") {
      resultMessages[lastIndex] = {
        ...resultMessages[lastIndex],
        content: "",
        visibleContent: "",
        rawContent: agentAssistantContent
      };
    }
    resultMessages.push({
      id: `msg-${Date.now().toString(36)}-run-error`,
      role: "system",
      content: [
        `✗ ${errorBubble}`,
        finalization.error?.stage ? `Stufe: ${finalization.error.stage}` : null,
        `Diagnose-ID: ${input.initialRunId}`,
        finalization.outcome === "context_overflow"
          ? "Hinweis: Anfrage kürzer erneut senden oder Context-Profil erhöhen."
          : null
      ]
        .filter(Boolean)
        .join("\n")
    });
  }

  return {
    resultMessages,
    finalizedAssistantMessage,
    finalization,
    persistedAgentTurn,
    success:
      finalization.outcome === "success" || finalization.outcome === "needs_user_input"
  };
}
