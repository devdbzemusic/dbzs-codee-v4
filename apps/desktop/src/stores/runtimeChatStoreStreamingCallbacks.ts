import type { RuntimeChatRun, RuntimeChatTurn } from "@dbzs/shared";
import type { RuntimeChatActivityRun } from "@/types/runtimeChatActivity";
import type { RuntimeChatState } from "@/stores/runtimeChatStore";
import { appendRunEvent } from "@/services/runtimeChatRunHelpers";
import { isModelContentDelta } from "@/services/providerRuntimeEvents";
import { upsertActivityStep } from "@/services/runtimeChatActivityHelpers";
import { patchActivitySteps } from "@/stores/runtimeChatStoreRuntimeHelpers";
import {
  extractReasoningSummary,
  mergeStreamingAssistantMessage
} from "@/stores/runtimeChatStoreMessageHelpers";

type Setter = (
  partial:
    | RuntimeChatState
    | Partial<RuntimeChatState>
    | ((state: RuntimeChatState) => RuntimeChatState | Partial<RuntimeChatState>)
) => void;

export function createStreamingResponseCallbacks(input: {
  set: Setter;
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
  updateActivity: (activity: RuntimeChatActivityRun) => void;
  activity: RuntimeChatActivityRun;
  conversationControlV2Enabled: boolean;
  streamingUiThrottleMs: number;
  onStreamTokenActivity: () => void;
}) {
  let streamedContent = "";
  let lastStreamProgressChars = 0;
  let lastStreamUiUpdateAt = 0;

  return {
    onDelta: (delta: string, totalLength: number) => {
      const shouldCountFirstToken = !input.conversationControlV2Enabled
        ? false // v1 handled differently or not needed
        : isModelContentDelta(delta);

      if (shouldCountFirstToken) {
        input.updateActiveRun((run) => {
          if (run.firstTokenAt) return run;
          return {
            ...run,
            firstTokenAt: new Date().toISOString(),
            events: appendRunEvent(run, "model.first_token", "Erstes Token empfangen").events
          };
        });
        input.onStreamTokenActivity();
      }

      streamedContent += delta;
      const now = Date.now();
      if (now - lastStreamUiUpdateAt >= input.streamingUiThrottleMs) {
        lastStreamUiUpdateAt = now;
        if (input.conversationControlV2Enabled) {
          input.set((state) => ({
            messages: state.messages.map((message, index) =>
              index === state.messages.length - 1 && message.role === "assistant"
                ? mergeStreamingAssistantMessage({
                    message,
                    content: streamedContent,
                    rawContent: streamedContent
                  })
                : message
            )
          }));
        } else {
          const { reasoningSummary, planProposal, cleanContent } = extractReasoningSummary(streamedContent);
          input.set((state) => ({
            messages: state.messages.map((message, index) =>
              index === state.messages.length - 1 && message.role === "assistant"
                ? mergeStreamingAssistantMessage({
                    message,
                    content: cleanContent,
                    reasoningSummary,
                    planProposal
                  })
                : message
            ),
            planProposalsById:
              planProposal && !state.planProposalsById[planProposal.id]
                ? { ...state.planProposalsById, [planProposal.id]: planProposal }
                : state.planProposalsById
          }));

          if (planProposal) {
            input.set((state) => ({
              lastActivity: state.lastActivity
                ? {
                    ...state.lastActivity,
                    summary: `Plan erkannt: ${planProposal.title}`
                  }
                : state.lastActivity,
              activeRun: state.activeRun
                ? {
                    ...appendRunEvent(state.activeRun, "chat.accepted", "Planfreigabe erwartet"),
                    status: "waiting_for_plan_approval"
                  }
                : state.activeRun
            }));
          }
        }
      }

      if (totalLength - lastStreamProgressChars >= 200) {
        lastStreamProgressChars = totalLength;
        input.updateActivity(
          patchActivitySteps(
            input.activity,
            upsertActivityStep(
              input.activity.steps,
              "llm-request",
              "Modell-Anfrage senden",
              "running",
              `Streaming … ${totalLength} Zeichen empfangen`
            )
          )
        );
      }
    },
    getStreamedContent: () => streamedContent
  };
}
