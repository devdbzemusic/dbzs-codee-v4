import type {
  AgentPlanProposal,
  AssistantAnswer,
  ChatActionRequest,
  RuntimeChatMessage
} from "@dbzs/shared";
import type { RuntimeChatState } from "@/stores/runtimeChatStore";
import { syncRuntimeAgentActions } from "@/stores/runtimeChatStoreRuntimeHelpers";

export function replaceMessageById(
  messages: RuntimeChatMessage[],
  messageId: string,
  updater: (message: RuntimeChatMessage) => RuntimeChatMessage
) {
  return messages.map((message) => (message.id === messageId ? updater(message) : message));
}

export function withSyncedMessages(
  state: Pick<RuntimeChatState, "messages" | "planProposalsById">,
  messages: RuntimeChatMessage[],
  planProposalsById: Record<string, AgentPlanProposal> = state.planProposalsById
) {
  const synced = syncRuntimeAgentActions(messages, planProposalsById);
  return {
    messages: synced.messages,
    agentActionsById: synced.agentActionsById
  };
}

export function withUpdatedMessage(
  state: Pick<RuntimeChatState, "messages" | "planProposalsById">,
  messageId: string,
  updater: (message: RuntimeChatMessage) => RuntimeChatMessage,
  planProposalsById: Record<string, AgentPlanProposal> = state.planProposalsById
) {
  return withSyncedMessages(
    state,
    replaceMessageById(state.messages, messageId, updater),
    planProposalsById
  );
}

export function setMessageActionStates(
  message: RuntimeChatMessage,
  actionId: string,
  updater: (action: ChatActionRequest) => ChatActionRequest
) {
  return {
    ...message,
    actions: message.actions?.map((action) => (action.id === actionId ? updater(action) : action))
  };
}

export function markChatActionDecisionState(
  state: Pick<RuntimeChatState, "messages" | "planProposalsById">,
  messageId: string,
  actionId: string,
  approve: boolean
) {
  return withUpdatedMessage(state, messageId, (message) =>
    setMessageActionStates(message, actionId, (action) =>
      action.id === actionId
        ? { ...action, state: approve ? "approved" : "rejected" }
        : { ...action, state: action.state === "pending" ? "expired" : action.state }
    )
  );
}

export function markChatActionCompleted(
  state: Pick<RuntimeChatState, "messages" | "planProposalsById">,
  messageId: string,
  actionId: string
) {
  return withUpdatedMessage(state, messageId, (message) =>
    setMessageActionStates(message, actionId, (action) => ({ ...action, state: "completed" }))
  );
}

export function markChatActionFailed(
  state: Pick<RuntimeChatState, "messages" | "planProposalsById">,
  messageId: string,
  actionId: string,
  description: string
) {
  return withUpdatedMessage(state, messageId, (message) =>
    setMessageActionStates(message, actionId, (action) => ({
      ...action,
      state: "failed",
      description
    }))
  );
}

export function completeAssistantAnswerAction(input: {
  state: Pick<RuntimeChatState, "messages" | "planProposalsById">;
  messageId: string;
  actionId: string;
  answer: AssistantAnswer;
  workflowLabel: string;
  isWorkflowScope: boolean;
}) {
  return withUpdatedMessage(input.state, input.messageId, (message) => ({
    ...message,
    content: input.isWorkflowScope
      ? `Workflow-Entscheidung:\n✓ ${input.workflowLabel}`
      : message.content,
    actions: message.actions?.map((action) =>
      action.id === input.actionId
        ? {
            ...action,
            state: "completed",
            title: input.isWorkflowScope ? `Workflow-Entscheidung: ${input.workflowLabel}` : action.title,
            description: input.isWorkflowScope ? input.workflowLabel : action.description,
            payload: { ...action.payload, answer: input.answer }
          }
        : action
    )
  }));
}
