import type {
  ContextManifest,
  ReasoningTraceEvent,
  RetrievalManifest,
  RuntimeChatMessage,
  RuntimeChatResponse,
  RuntimeChatTurn,
  RuntimeRunOutcome,
  RuntimeSlotId,
  SafeReasoningSummary,
  SourceReference
} from "@dbzs/shared";
import type { UserExecutionIntent } from "@/services/executionIntent";
import type { RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";
import { gateExecutionFinalAnswer } from "@/services/executionAnswerValidation";
import {
  finalizeRuntimeRun,
  isGenericRuntimeErrorSentinel,
  type FinalizeRuntimeRunResult
} from "@/services/runtimeRunFinalization";
import { hasPendingPlanApproval } from "@/stores/runtimeChatStoreMessageHelpers";

export async function finalizeStreamingResponseArtifacts(input: {
  initialRunId: string;
  response: RuntimeChatResponse;
  resultMessages: RuntimeChatMessage[];
  finalizedAssistantMessage: RuntimeChatMessage | null;
  assistantContent: string;
  streamToolNames: string[];
  completedToolCalls: number;
  routing: RuntimeChatRoutingInfo;
  contextSlotId: RuntimeSlotId | null | undefined;
  executionIntentForTurn: UserExecutionIntent;
  trimmedContent: string;
  toolsEnabled: boolean;
  workspaceRoot?: string | null;
  priorOutcome?: RuntimeRunOutcome | null;
  firstTokenAt?: string | null;
  tokenBudget?: {
    runtimeContextLimit?: number | null;
    totalRequiredTokens?: number | null;
  } | null;
  safeTraceEvents: ReasoningTraceEvent[];
  ragManifest?: RetrievalManifest;
  ragSourceReferences?: SourceReference[];
  spoolerManifest?: ContextManifest | null;
  reasoningTraceEnabled: boolean;
  persistTraceEvents: (events: ReasoningTraceEvent[]) => Promise<{
    events?: ReasoningTraceEvent[];
    summary?: SafeReasoningSummary;
  } | null>;
  startedAt?: string;
}): Promise<{
  resultMessages: RuntimeChatMessage[];
  assistantIndex: number;
  finalization: FinalizeRuntimeRunResult;
  persistedStreamTurn: RuntimeChatTurn;
  success: boolean;
}> {
  const resultMessages = [...input.resultMessages];
  input.safeTraceEvents.push({
    id: `trace-${input.initialRunId}-stream-finalized`,
    runId: input.initialRunId,
    kind: "run_completed",
    title: "Antwort ausgewertet",
    summary: `${input.completedToolCalls} Tool-Ergebnisse`,
    status: "completed",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  });

  let assistantIndex = -1;
  for (let index = resultMessages.length - 1; index >= 0; index -= 1) {
    if (resultMessages[index]?.role === "assistant") {
      assistantIndex = index;
      break;
    }
  }

  if (assistantIndex >= 0) {
    try {
      const persistedTrace = input.reasoningTraceEnabled
        ? await input.persistTraceEvents(input.safeTraceEvents)
        : null;
      resultMessages[assistantIndex] = {
        ...resultMessages[assistantIndex],
        content: input.assistantContent,
        traceEvents: persistedTrace?.events ?? input.safeTraceEvents,
        safeReasoningSummary: persistedTrace?.summary,
        retrievalManifest: input.ragManifest,
        contextManifest: input.spoolerManifest ?? undefined,
        sourceReferences: input.ragSourceReferences
      };
    } catch (error) {
      console.warn("Execution trace persistence failed:", error);
      resultMessages[assistantIndex] = {
        ...resultMessages[assistantIndex],
        content: input.assistantContent,
        traceEvents: input.safeTraceEvents,
        retrievalManifest: input.ragManifest,
        contextManifest: input.spoolerManifest ?? undefined,
        sourceReferences: input.ragSourceReferences
      };
    }
  }

  const waitingForPlanApproval = input.finalizedAssistantMessage
    ? hasPendingPlanApproval(input.finalizedAssistantMessage)
    : false;
  const responseProviderError = Boolean(input.response.provider_error);
  const responseSafeFallback =
    input.response.safe_fallback === true ||
    responseProviderError ||
    isGenericRuntimeErrorSentinel(input.assistantContent);
  const streamExecutionGate = gateExecutionFinalAnswer({
    userMessage: input.trimmedContent,
    executionIntent: input.executionIntentForTurn,
    finalAnswer: input.assistantContent,
    toolCallsExecuted: input.completedToolCalls,
    toolNames: input.streamToolNames,
    toolsEnabled: input.toolsEnabled,
    workspaceRoot: input.workspaceRoot ?? null
  });
  const streamExecutionRejected =
    input.priorOutcome !== "answer_relevance_failed" &&
    !waitingForPlanApproval &&
    !responseSafeFallback &&
    streamExecutionGate.rejectAsInvalid;
  const streamGatedAnswer = streamExecutionRejected
    ? (streamExecutionGate.userMessage ?? input.assistantContent)
    : input.assistantContent;

  if (streamExecutionRejected && assistantIndex >= 0) {
    resultMessages[assistantIndex] = {
      ...resultMessages[assistantIndex],
      content: streamGatedAnswer,
      visibleContent: streamGatedAnswer,
      rawContent: input.assistantContent
    };
  }

  const finalization = finalizeRuntimeRun({
    runId: input.initialRunId,
    outcome:
      input.priorOutcome === "answer_relevance_failed"
        ? "answer_relevance_failed"
        : waitingForPlanApproval
          ? "needs_user_input"
          : responseSafeFallback
            ? "generation_failed"
            : streamExecutionRejected
              ? "agent_output_invalid"
              : "success",
    finalAnswer: streamGatedAnswer,
    safeFallback: responseSafeFallback,
    providerError: responseSafeFallback,
    parserSkippedReason: responseSafeFallback ? "provider_error" : undefined,
    agentTurnCount: 1,
    pendingToolCalls: 0,
    completedToolCalls: input.completedToolCalls,
    modelId: input.routing.modelId ?? input.response.model_id,
    modelName: input.routing.modelName ?? input.response.model_name,
    slotId: input.contextSlotId,
    finishReason: input.response.finish_reason ?? null,
    rawContent: input.assistantContent,
    pipeline: {
      runtimeReady: true,
      inferenceReady: input.routing.warmupStatus === "ready" || input.routing.warmupStatus == null,
      firstTokenReceived: Boolean(input.firstTokenAt),
      modelOutputReceived: Boolean((streamGatedAnswer ?? "").trim() || responseSafeFallback),
      outputParsed:
        !responseSafeFallback &&
        input.priorOutcome !== "answer_relevance_failed" &&
        !streamExecutionRejected,
      agentLoopCompleted: true,
      finalAnswerDelivered: false
    },
    contextWindowTokens: input.tokenBudget?.runtimeContextLimit ?? null,
    totalRequiredTokens: input.tokenBudget?.totalRequiredTokens ?? null
  });

  const turnStartedAt = input.startedAt ?? new Date().toISOString();
  const turnFinishedAt = new Date().toISOString();
  const persistedStreamTurn: RuntimeChatTurn = {
    id: `turn-${input.initialRunId}-1`,
    turnNumber: 1,
    prompt: input.trimmedContent,
    response: input.response.message.content ?? input.assistantContent,
    startedAt: turnStartedAt,
    finishedAt: turnFinishedAt,
    durationMs: Date.now() - new Date(turnStartedAt).getTime()
  };

  if (finalization.suppressAssistantSuccess) {
    if (assistantIndex >= 0) {
      resultMessages[assistantIndex] = {
        ...resultMessages[assistantIndex],
        content: "",
        visibleContent: "",
        rawContent: input.assistantContent
      };
    }
    resultMessages.push({
      id: `msg-${Date.now().toString(36)}-run-error`,
      role: "system",
      content: [
        `✗ ${finalization.error?.userMessage ?? finalization.userMessage}`,
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
    assistantIndex,
    finalization,
    persistedStreamTurn,
    success:
      finalization.outcome === "success" || finalization.outcome === "needs_user_input"
  };
}
