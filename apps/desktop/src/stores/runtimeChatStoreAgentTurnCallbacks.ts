import type {
  AgentPatchProposal,
  ReasoningTraceEvent,
  RuntimeChatRun,
  RuntimeChatToolCall,
  RuntimeChatToolCallRecord
} from "@dbzs/shared";
import type { RuntimeChatActivityRun } from "@/types/runtimeChatActivity";
import type { RuntimeChatState } from "@/stores/runtimeChatStore";
import { appendRunEvent } from "@/services/runtimeChatRunHelpers";
import { createTraceEvent } from "@/services/ragClient";
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

type Getter = () => RuntimeChatState;

function mapToolCalls(
  toolCalls: RuntimeChatToolCallRecord[],
  startedAt: string
): RuntimeChatToolCall[] {
  return toolCalls.map((tool) => ({
    id: tool.id,
    name: tool.name,
    toolCallId: tool.id,
    status:
      tool.status === "running"
        ? "running"
        : tool.status === "error"
          ? "failed"
          : "completed",
    arguments: tool.input ? JSON.stringify(tool.input) : "{}",
    filePath: tool.filePath,
    startedAt
  }));
}

export function createAgentTurnLoopCallbacks(input: {
  set: Setter;
  get: Getter;
  initialRunId: string;
  brokerDecisionId?: string;
  workspaceRoot?: string;
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
  updateActivity: (activity: RuntimeChatActivityRun) => void;
  activity: RuntimeChatActivityRun;
  safeTraceEvents: ReasoningTraceEvent[];
  conversationControlV2Enabled: boolean;
  streamingUiThrottleMs: number;
  onStreamTokenActivity: () => void;
  appendStepDetail: (id: string, line: string) => void;
}) {
  let lastAgentStreamUiUpdateAt = 0;

  return {
    onPatchProposal: async (proposal: AgentPatchProposal) => {
      input.safeTraceEvents.push(
        createTraceEvent(
          input.initialRunId,
          "patch_proposed",
          "Patch vorgeschlagen",
          `${proposal.changes.length} Dateiänderungen vorbereitet`
        )
      );
      await input.get().receivePatchProposal({
        ...proposal,
        runId: input.initialRunId,
        decisionId: input.brokerDecisionId ?? proposal.decisionId ?? undefined,
        workspaceRoot: input.workspaceRoot ?? undefined,
        changes: proposal.changes.map((change) => ({
          ...change,
          runId: input.initialRunId,
          decisionId: input.brokerDecisionId ?? change.decisionId ?? undefined
        }))
      });
      input.updateActiveRun((run) =>
        appendRunEvent(run, "file.change.proposed", `Patch Proposal ${proposal.id} vorbereitet`)
      );
    },
    onStreamUpdate: (
      content: string,
      turn: number,
      toolCalls: RuntimeChatToolCallRecord[]
    ) => {
      for (const tool of toolCalls ?? []) {
        const eventId = `trace-tool-${tool.id}`;
        const existingIndex = input.safeTraceEvents.findIndex((event) => event.id === eventId);
        const at = new Date().toISOString();
        const event: ReasoningTraceEvent = {
          id: eventId,
          runId: input.initialRunId,
          kind: tool.status === "running" ? "tool_started" : "tool_completed",
          title: `Tool: ${tool.name}`,
          summary:
            tool.status === "error"
              ? (tool.outputSummary ?? "Tool fehlgeschlagen")
              : tool.status === "running"
                ? "Ausführung läuft"
                : "Ausführung abgeschlossen",
          status:
            tool.status === "error"
              ? "failed"
              : tool.status === "running"
                ? "running"
                : "completed",
          startedAt: at,
          completedAt: tool.status === "running" ? undefined : at,
          metadata: { toolName: tool.name }
        };
        if (existingIndex >= 0) {
          input.safeTraceEvents[existingIndex] = event;
        } else {
          input.safeTraceEvents.push(event);
        }
      }

      input.updateActiveRun((run) => {
        const shouldCountFirstToken = !run.firstTokenAt && isModelContentDelta(content);
        const withToken = shouldCountFirstToken
          ? { ...run, firstTokenAt: new Date().toISOString(), status: "streaming" as const }
          : run.firstTokenAt
            ? run
            : { ...run, status: "streaming" as const };
        const updatedEvents = shouldCountFirstToken
          ? appendRunEvent(run, "model.first_token", "Erstes Token empfangen").events
          : run.events;

        if (shouldCountFirstToken) {
          input.onStreamTokenActivity();
        }

        return {
          ...withToken,
          events: updatedEvents,
          toolCalls: mapToolCalls(toolCalls || [], run.startedAt)
        };
      });

      input.updateActivity(
        patchActivitySteps(
          input.activity,
          upsertActivityStep(
            input.activity.steps,
            "llm-request",
            "Modell-Anfrage senden",
            "running",
            turn > 0 ? `Turn ${turn} · ${content.length} Zeichen` : `Streaming … ${content.length} Zeichen`
          )
        )
      );

      const now = Date.now();
      const shouldRefreshStreamUi =
        !input.conversationControlV2Enabled ||
        toolCalls.length > 0 ||
        now - lastAgentStreamUiUpdateAt >= input.streamingUiThrottleMs;

      if (shouldRefreshStreamUi) {
        if (input.conversationControlV2Enabled) {
          input.set((state) => ({
            messages: state.messages.map((message, index) =>
              index === state.messages.length - 1 && message.role === "assistant"
                ? mergeStreamingAssistantMessage({
                    message,
                    content,
                    rawContent: content,
                    toolCalls
                  })
                : message
            )
          }));
        } else {
          const { reasoningSummary, planProposal, cleanContent } = extractReasoningSummary(content);
          input.set((state) => ({
            messages: state.messages.map((message, index) =>
              index === state.messages.length - 1 && message.role === "assistant"
                ? mergeStreamingAssistantMessage({
                    message,
                    content: cleanContent,
                    reasoningSummary,
                    planProposal,
                    toolCalls
                  })
                : message
            ),
            planProposalsById:
              planProposal && !state.planProposalsById[planProposal.id]
                ? { ...state.planProposalsById, [planProposal.id]: planProposal }
                : state.planProposalsById
          }));
        }
        lastAgentStreamUiUpdateAt = now;
      }
    },
    onTurnStart: (turn: number) => {
      input.appendStepDetail("llm-request", `Turn ${turn}`);
    },
    onActivityDetail: (line: string) => {
      input.appendStepDetail("llm-request", line);
    }
  };
}
