import type { RuntimeChatError, RuntimeChatRun, RuntimeRunOutcome } from "@dbzs/shared";
import type { RuntimeChatActivityRun } from "@/types/runtimeChatActivity";
import type { RuntimeChatState } from "@/stores/runtimeChatStore";
import { appendRunEvent, updateRunStatus } from "@/services/runtimeChatRunHelpers";
import { finalizeRuntimeRun } from "@/services/runtimeRunFinalization";
import { formatChatError, patchActivityRun } from "@/stores/runtimeChatStoreRuntimeHelpers";

type Setter = (
  partial:
    | RuntimeChatState
    | Partial<RuntimeChatState>
    | ((state: RuntimeChatState) => RuntimeChatState | Partial<RuntimeChatState>)
) => void;

type Getter = () => RuntimeChatState;

export function finalizeSendState(input: {
  set: Setter;
  get: Getter;
  activity: RuntimeChatActivityRun;
  errorMessage: string | null;
  keepMessages?: boolean;
  messagesOverride?: RuntimeChatState["messages"];
  statePatch?: (state: RuntimeChatState) => Partial<RuntimeChatState>;
}) {
  const finishedRun = input.get().activeRun;
  input.set((state) => ({
    ...(input.statePatch ? input.statePatch(state) : {}),
    ...(input.messagesOverride ? { messages: input.messagesOverride } : {}),
    error: input.errorMessage,
    isSending: false,
    isStreaming: false,
    lastActivity: input.activity,
    currentActivity: null,
    activeRun: null,
    historicalRuns: finishedRun
      ? { ...state.historicalRuns, [finishedRun.id]: finishedRun }
      : state.historicalRuns
  }));
}

export function shouldClearSendError(outcome: RuntimeRunOutcome) {
  return outcome === "success" || outcome === "needs_user_input";
}

export function buildSendCompletionSummary(input: {
  startedAt: number;
  outcome: RuntimeRunOutcome;
  userMessage: string;
}) {
  return shouldClearSendError(input.outcome)
    ? `Fertig in ${((Date.now() - input.startedAt) / 1000).toFixed(1)}s`
    : input.userMessage;
}

export function buildTrimmedFailureMessages(messages: RuntimeChatState["messages"]) {
  const last = messages.at(-1);
  if (last?.role === "assistant" && last.content.trim().length === 0) {
    return messages.slice(0, -1);
  }
  return messages;
}

export function appendTimeoutFailure(input: {
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
  outcome: RuntimeRunOutcome;
  userMessage: string;
}) {
  input.updateActiveRun((run) =>
    appendRunEvent(
      {
        ...updateRunStatus(run, "timeout"),
        outcome: input.outcome,
        error: {
          code: input.outcome,
          message: input.userMessage,
          phase: "llm-request"
        }
      },
      "chat.timeout",
      input.userMessage
    )
  );
}

export function appendGenericRunFailure(input: {
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
  outcome: RuntimeRunOutcome;
  summary: string;
  error: RuntimeChatError;
}) {
  input.updateActiveRun((run) =>
    appendRunEvent(
      {
        ...updateRunStatus({ ...run, error: input.error }, "failed"),
        outcome: input.outcome
      },
      "chat.failed",
      input.summary
    )
  );
}

export function markActivityFailure(activity: RuntimeChatActivityRun, summary: string) {
  return patchActivityRun(activity, {
    finishedAt: new Date().toISOString(),
    summary
  });
}

export function finalizePhaseTimeoutRun(input: {
  runId: string;
  outcome: RuntimeRunOutcome;
  modelId?: string | null;
  modelName?: string | null;
  slotId?: string | null;
  firstTokenReceived: boolean;
}) {
  return finalizeRuntimeRun({
    runId: input.runId,
    outcome: input.outcome,
    finalAnswer: null,
    modelId: input.modelId,
    modelName: input.modelName,
    slotId: input.slotId,
    pipeline: {
      runtimeReady: true,
      inferenceReady: true,
      firstTokenReceived: input.firstTokenReceived,
      modelOutputReceived: false,
      outputParsed: false,
      agentLoopCompleted: false,
      finalAnswerDelivered: false
    }
  });
}

export function genericSendErrorMessage(error: unknown): string {
  return formatChatError(error);
}
