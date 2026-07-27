import type {
  ReviewGate,
  RuntimeChatMessage
} from "@dbzs/shared";
import type { ToolName } from "@/runtime/tool/toolContracts";
import {
  getPendingStructuredApprovalItems,
  getPendingStructuredChatActions,
  getRuntimeAgentActions,
  type PendingStructuredApprovalItem,
  type RuntimeAgentActionItem,
  type StructuredChatApprovalItem
} from "@/services/runtimeAgentActions";
import type { ChatTakeoverApproval } from "@/stores/runtimeChatApprovalStore";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { useRuntimeChatApprovalStore } from "@/stores/runtimeChatApprovalStore";

export type ApprovalKind = "tool" | "patch" | "takeover" | "review_gate";

export type ApprovalPriority = "deny" | "ask" | "allow";

export interface UnifiedApprovalItem {
  id: string;
  kind: ApprovalKind;
  title: string;
  preview: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  meta?: Record<string, string>;
}

export interface ApprovalHubSnapshot {
  pending: UnifiedApprovalItem[];
  resolved: UnifiedApprovalItem[];
}

function priorityForKind(kind: ApprovalKind): ApprovalPriority {
  switch (kind) {
    case "review_gate":
      return "deny";
    case "tool":
    case "patch":
    case "takeover":
    default:
      return "ask";
  }
}

function sortByPriority(items: UnifiedApprovalItem[]): UnifiedApprovalItem[] {
  const rank: Record<ApprovalPriority, number> = { deny: 0, ask: 1, allow: 2 };
  return [...items].sort((left, right) => {
    const leftRank = rank[priorityForKind(left.kind)];
    const rightRank = rank[priorityForKind(right.kind)];
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function mapTakeover(approval: ChatTakeoverApproval): UnifiedApprovalItem {
  return {
    id: approval.id,
    kind: approval.kind === "patch" ? "patch" : "takeover",
    title: approval.title,
    preview: approval.preview,
    status: approval.status === "pending" ? "pending" : approval.status === "approved" ? "approved" : "rejected",
    createdAt: approval.createdAt,
    meta: {
      workspaceRoot: approval.workspaceRoot
    }
  };
}

type ApproveTakeoverArgs = Parameters<ReturnType<typeof useRuntimeChatApprovalStore.getState>["approveTakeover"]>;

export const approvalHub = {
  priorityForKind,

  requestToolApproval(
    actorId: string,
    toolName: ToolName,
    reason: string,
    inputSnapshot?: Record<string, unknown>,
    workspaceRoot?: string
  ): Promise<boolean> {
    if (!workspaceRoot) {
      return Promise.resolve(false);
    }
    return useRuntimeChatApprovalStore
      .getState()
      .requestToolApproval(actorId, toolName, reason, inputSnapshot, workspaceRoot);
  },

  getSnapshot(reviewGates: ReviewGate[] = [], workspaceId?: string): ApprovalHubSnapshot {
    const store = useRuntimeChatApprovalStore.getState();
    const takeovers = store.takeovers
      .filter((entry) => !workspaceId || entry.workspaceId === workspaceId)
      .map(mapTakeover);
    const tools = store.toolApprovals
      .filter((entry) => !workspaceId || entry.workspaceId === workspaceId)
      .map((entry) => ({
      id: entry.id,
      kind: "tool" as const,
      title: `Tool: ${entry.toolName}`,
      preview: entry.reason,
      status: entry.status === "pending" ? ("pending" as const) : entry.status === "approved" ? ("approved" as const) : ("rejected" as const),
      createdAt: entry.createdAt,
      meta: {
        actorId: entry.actorId,
        toolName: entry.toolName
      }
    }));

    const gates = reviewGates
      .filter((gate) => gate.status === "pending" && (!workspaceId || gate.workspaceId === workspaceId))
      .map((gate) => ({
        id: gate.id,
        kind: "review_gate" as const,
        title: `Review Gate · Schritt ${gate.stepNumber}`,
        preview: gate.proposedChanges.map((change) => change.filePath).join(", ") || gate.jobId,
        status: "pending" as const,
        createdAt: gate.createdAt,
        meta: {
          jobId: gate.jobId,
          riskLevel: gate.proposedChanges[0]?.riskLevel ?? "medium"
        }
      }));

    const pending = sortByPriority([
      ...takeovers.filter((entry) => entry.status === "pending"),
      ...tools.filter((entry) => entry.status === "pending"),
      ...gates
    ]);

    const resolved = sortByPriority([
      ...takeovers.filter((entry) => entry.status !== "pending"),
      ...tools.filter((entry) => entry.status !== "pending")
    ]).slice(0, 12);

    return { pending, resolved };
  },

  getPendingStructuredChatActions(messages: RuntimeChatMessage[]): StructuredChatApprovalItem[] {
    return getPendingStructuredChatActions(messages);
  },

  getPendingStructuredApprovalItems(
    messages: RuntimeChatMessage[],
    options?: {
      planProposalsById?: Record<string, import("@dbzs/shared").AgentPlanProposal>;
      workspaceId?: string;
    }
  ): PendingStructuredApprovalItem[] {
    return getPendingStructuredApprovalItems(messages, options);
  },

  getRuntimeAgentActions(
    messages: RuntimeChatMessage[],
    options?: { planProposalsById?: Record<string, import("@dbzs/shared").AgentPlanProposal> }
  ): RuntimeAgentActionItem[] {
    return getRuntimeAgentActions(messages, options);
  },

  getPendingCount(
    reviewGates: ReviewGate[] = [],
    messages: RuntimeChatMessage[] = [],
    options?: { planProposalsById?: Record<string, import("@dbzs/shared").AgentPlanProposal>; workspaceId?: string }
  ): number {
    const snapshot = approvalHub.getSnapshot(reviewGates, options?.workspaceId);
    return snapshot.pending.length + approvalHub.getPendingStructuredApprovalItems(messages, options).length;
  },

  approveTool(approvalId: string, options?: { rememberAllowlist?: boolean; workspaceId?: string }): void {
    useRuntimeChatApprovalStore.getState().approveToolApproval(approvalId, options);
  },

  rejectTool(approvalId: string, workspaceId?: string): void {
    useRuntimeChatApprovalStore.getState().rejectToolApproval(approvalId, workspaceId);
  },

  approveTakeover(
    approvalId: string,
    queueProposedChanges: ApproveTakeoverArgs[1],
    workspaceId?: string
  ): Promise<string> {
    return workspaceId
      ? useRuntimeChatApprovalStore.getState().approveTakeover(approvalId, queueProposedChanges, workspaceId)
      : useRuntimeChatApprovalStore.getState().approveTakeover(approvalId, queueProposedChanges);
  },

  rejectTakeover(approvalId: string, workspaceId?: string): void {
    if (workspaceId) {
      useRuntimeChatApprovalStore.getState().rejectTakeover(approvalId, workspaceId);
      return;
    }
    useRuntimeChatApprovalStore.getState().rejectTakeover(approvalId);
  },

  clearResolvedTakeovers(): void {
    useRuntimeChatApprovalStore.getState().clearResolvedTakeovers();
  },

  approveChatAction(actionId: string, messageId: string, workspaceId: string): Promise<void> {
    return useRuntimeChatStore.getState().handleChatAction(actionId, messageId, true, workspaceId);
  },

  rejectChatAction(actionId: string, messageId: string, workspaceId: string): Promise<void> {
    return useRuntimeChatStore.getState().handleChatAction(actionId, messageId, false, workspaceId);
  }
};
