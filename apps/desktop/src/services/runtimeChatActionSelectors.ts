import type { AgentAction, RuntimeChatMessage } from "@dbzs/shared";
import { FOLLOW_UP_ACTION_KINDS } from "@/services/runtimeChatFollowUpActions";

export type TransportChatAction = NonNullable<RuntimeChatMessage["actions"]>[number];

export function getTransportChatActions(message: RuntimeChatMessage): TransportChatAction[] {
  // answer_question is rendered by AssistantQuestionCard in the approvals panel.
  // Pending chips with the full prompt are not selectable and confuse the flow.
  return (message.actions ?? []).filter((action) => action.kind !== "answer_question");
}

export function getRequiredChatActions(message: RuntimeChatMessage): TransportChatAction[] {
  return getTransportChatActions(message).filter((action) => !FOLLOW_UP_ACTION_KINDS.has(action.kind));
}

export function getFollowUpChatActions(message: RuntimeChatMessage): TransportChatAction[] {
  return getTransportChatActions(message).filter((action) => FOLLOW_UP_ACTION_KINDS.has(action.kind));
}

export function findLastAssistantMessageIndex(messages: RuntimeChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") return i;
  }
  return -1;
}

export function getRuntimeAgentActionsForMessage(
  message: RuntimeChatMessage,
  agentActionsById: Record<string, AgentAction>
): AgentAction[] {
  return (message.actionIds ?? [])
    .map((actionId) => agentActionsById[actionId])
    .filter((action): action is AgentAction => Boolean(action));
}

export function hasPendingRuntimeActionKind(
  actions: AgentAction[],
  kind: AgentAction["kind"]
): boolean {
  return actions.some((action) => action.kind === kind && action.state === "pending");
}

export function isRejectTransportAction(action: TransportChatAction): boolean {
  return action.kind.startsWith("reject");
}

export function getTransportActionTone(action: TransportChatAction): {
  colorClass: string;
  statusBadgeClass: string;
} {
  const colorClass = "border-dbzs-cyan text-dbzs-cyan bg-dbzs-cyan/5 hover:bg-dbzs-cyan/10";
  const statusBadgeClass = "text-dbzs-cyan";

  if (action.kind === "show_diff") {
    return {
      colorClass: "border-dbzs-yellow text-dbzs-yellow bg-dbzs-yellow/5 hover:bg-dbzs-yellow/10",
      statusBadgeClass: "text-dbzs-yellow"
    };
  }

  if (
    action.riskLevel === "high" ||
    action.kind === "reject_patch" ||
    action.kind === "reject_command" ||
    action.kind === "reject_web_access" ||
    action.kind === "rollback_patch"
  ) {
    return {
      colorClass: "border-dbzs-red text-dbzs-red bg-dbzs-red/5 hover:bg-dbzs-red/10",
      statusBadgeClass: "text-dbzs-red"
    };
  }

  if (action.riskLevel === "medium" || action.kind === "approve_patch") {
    return {
      colorClass: "border-dbzs-yellow text-dbzs-yellow bg-dbzs-yellow/5 hover:bg-dbzs-yellow/10",
      statusBadgeClass: "text-dbzs-yellow"
    };
  }

  return { colorClass, statusBadgeClass };
}
