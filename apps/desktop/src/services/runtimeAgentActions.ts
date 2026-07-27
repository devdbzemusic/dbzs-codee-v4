import type {
  AgentAction,
  AgentActionState,
  AgentPlanProposal,
  RuntimeChatMessage
} from "@dbzs/shared";

export interface StructuredChatApprovalItem {
  action: NonNullable<RuntimeChatMessage["actions"]>[number];
  messageId: string;
}

export interface RuntimeAgentActionItem {
  action: AgentAction;
  messageId: string;
  sourceActionIds: string[];
  sourceActions: StructuredChatApprovalItem["action"][];
}

export interface PendingStructuredApprovalItem {
  id: string;
  messageId: string;
  workspaceId: string;
  kind: AgentAction["kind"] | "continue";
  title: string;
  description?: string;
  riskLevel: "low" | "medium" | "high";
  approveActionId: string;
  rejectActionId?: string;
}

interface RuntimeAgentActionOptions {
  planProposalsById?: Record<string, AgentPlanProposal>;
  workspaceId?: string;
}

export function isPendingStructuredAction(action: StructuredChatApprovalItem["action"]): boolean {
  return action.state === "pending" && (
    action.kind.startsWith("approve_") ||
    action.kind.startsWith("reject_") ||
    action.kind === "confirm_continue"
  );
}

function mapChatActionStateToAgentActionState(
  state: NonNullable<StructuredChatApprovalItem["action"]["state"]>
): AgentActionState {
  switch (state) {
    case "approved":
      return "approved";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "rejected":
      return "rejected";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    case "pending":
    default:
      return "pending";
  }
}

function deriveRuntimeActionKind(actionKind: StructuredChatApprovalItem["action"]["kind"]): AgentAction["kind"] | null {
  if (actionKind === "approve_plan" || actionKind === "reject_plan") {
    return "plan";
  }
  if (actionKind === "approve_patch" || actionKind === "reject_patch") {
    return "patch";
  }
  if (actionKind === "approve_command" || actionKind === "reject_command") {
    return "command";
  }
  if (actionKind === "approve_web_access" || actionKind === "reject_web_access") {
    return "web";
  }
  return null;
}

function deriveRuntimeActionRef(item: StructuredChatApprovalItem): string | null {
  const payload = item.action.payload;
  switch (deriveRuntimeActionKind(item.action.kind)) {
    case "plan":
      return typeof payload.planProposalId === "string" ? payload.planProposalId : null;
    case "patch":
      return typeof payload.proposalId === "string" ? payload.proposalId : null;
    case "command":
      return typeof payload.approvalRequestId === "string"
        ? payload.approvalRequestId
        : typeof payload.commandId === "string"
          ? payload.commandId
          : null;
    case "web":
      return typeof payload.approvalRequestId === "string"
        ? payload.approvalRequestId
        : typeof payload.query === "string"
          ? payload.query
          : typeof payload.url === "string"
            ? payload.url
            : null;
    default:
      return null;
  }
}

export function getPendingStructuredChatActions(messages: RuntimeChatMessage[]): StructuredChatApprovalItem[] {
  return messages.flatMap((message) =>
    (message.actions ?? [])
      .filter((action) => isPendingStructuredAction(action))
      .map((action) => ({ messageId: message.id, action }))
  );
}

export function getRuntimeAgentActions(
  messages: RuntimeChatMessage[],
  options?: RuntimeAgentActionOptions
): RuntimeAgentActionItem[] {
  const grouped = new Map<string, RuntimeAgentActionItem>();

  for (const message of messages) {
    for (const action of message.actions ?? []) {
      if (options?.workspaceId && action.workspaceId !== options.workspaceId) {
        continue;
      }
      const runtimeKind = deriveRuntimeActionKind(action.kind);
      const runtimeRef = deriveRuntimeActionRef({ action, messageId: message.id });
      if (!runtimeKind || !runtimeRef) {
        continue;
      }

      const key = `${runtimeKind}:${runtimeRef}`;
      const state = mapChatActionStateToAgentActionState(action.state);
      const riskLevel = action.riskLevel ?? "medium";

      if (!grouped.has(key)) {
        let agentAction: AgentAction | null = null;

        if (runtimeKind === "plan") {
          const plan = options?.planProposalsById?.[runtimeRef];
          if (!plan) {
            continue;
          }
          agentAction = {
            kind: "plan",
            id: runtimeRef,
            runId: action.runId,
            version: 1,
            riskLevel,
            state,
            title: plan.title,
            summary: plan.summary,
            steps: plan.steps
          };
        } else if (runtimeKind === "patch") {
          agentAction = {
            kind: "patch",
            id: runtimeRef,
            runId: action.runId,
            version: 1,
            riskLevel,
            state,
            proposalId: runtimeRef
          };
        } else if (runtimeKind === "command") {
          agentAction = {
            kind: "command",
            id: runtimeRef,
            runId: action.runId,
            version: 1,
            riskLevel,
            state,
            commandRequestId: runtimeRef
          };
        } else if (runtimeKind === "web") {
          agentAction = {
            kind: "web",
            id: runtimeRef,
            runId: action.runId,
            version: 1,
            riskLevel,
            state,
            webRequestId: runtimeRef
          };
        }

        if (!agentAction) {
          continue;
        }

        grouped.set(key, {
          action: agentAction,
          messageId: message.id,
          sourceActionIds: [action.id],
          sourceActions: [action]
        });
        continue;
      }

      const existing = grouped.get(key);
      if (!existing) {
        continue;
      }

      existing.sourceActionIds.push(action.id);
      existing.sourceActions.push(action);
      existing.messageId = message.id;
      if (existing.action.state === "pending" && state !== "pending") {
        existing.action = { ...existing.action, state };
      } else if (state === "rejected") {
        existing.action = { ...existing.action, state };
      }
    }
  }

  return [...grouped.values()];
}

export function getPendingStructuredApprovalItems(
  messages: RuntimeChatMessage[],
  options?: RuntimeAgentActionOptions
): PendingStructuredApprovalItem[] {
  const pendingRuntimeApprovals = getRuntimeAgentActions(messages, options)
    .filter((item) => item.action.state === "pending")
    .map<PendingStructuredApprovalItem | null>((item) => {
      const approveAction = item.sourceActions.find((action) => action.kind.startsWith("approve_"));
      const rejectAction = item.sourceActions.find((action) => action.kind.startsWith("reject_"));
      const primaryAction = approveAction ?? rejectAction ?? item.sourceActions[0];
      if (!primaryAction) {
        return null;
      }

      return {
        id: item.action.id,
        messageId: item.messageId,
        workspaceId: primaryAction.workspaceId,
        kind: item.action.kind,
        title: primaryAction.title,
        description: primaryAction.description,
        riskLevel: primaryAction.riskLevel ?? item.action.riskLevel,
        approveActionId: primaryAction.id,
        rejectActionId: rejectAction?.id ?? primaryAction.id
      };
    })
    .filter((item): item is PendingStructuredApprovalItem => Boolean(item));

  const directContinueApprovals = messages.flatMap((message) =>
    (message.actions ?? [])
      .filter((action) =>
        action.kind === "confirm_continue" &&
        action.state === "pending" &&
        (!options?.workspaceId || action.workspaceId === options.workspaceId)
      )
      .map<PendingStructuredApprovalItem>((action) => ({
        id: action.id,
        messageId: message.id,
        workspaceId: action.workspaceId,
        kind: "continue",
        title: action.title,
        description: action.description,
        riskLevel: action.riskLevel ?? "low",
        approveActionId: action.id,
        rejectActionId: action.id
      }))
  );

  return [...pendingRuntimeApprovals, ...directContinueApprovals];
}

export function buildRuntimeAgentActionRegistry(
  messages: RuntimeChatMessage[],
  options?: RuntimeAgentActionOptions
): {
  agentActionsById: Record<string, AgentAction>;
  messages: RuntimeChatMessage[];
} {
  const runtimeActions = getRuntimeAgentActions(messages, options);
  const actionIdsByMessageId = new Map<string, string[]>();
  const agentActionsById: Record<string, AgentAction> = {};

  for (const item of runtimeActions) {
    agentActionsById[item.action.id] = item.action;
    const ids = actionIdsByMessageId.get(item.messageId) ?? [];
    ids.push(item.action.id);
    actionIdsByMessageId.set(item.messageId, ids);
  }

  return {
    agentActionsById,
    messages: messages.map((message) => ({
      ...message,
      actionIds: actionIdsByMessageId.get(message.id) ?? []
    }))
  };
}
