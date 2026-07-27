import { create } from "zustand";
import { workspaceScopeId, type RuntimeChatWorkspaceContext, type WorkspaceFile } from "@dbzs/shared";
import type { ToolName } from "@/runtime/tool/toolContracts";
import { rememberTerminalAllowlist } from "@/runtime/tool/terminalAllowlist";
import { looksLikeAgentChangePayload, parseAgentOutputToProposedChanges } from "@/services/agentOutputParser";
import { executeAssistantTakeover } from "@/services/runtimeChatTakeover";

export type ChatTakeoverKind = "implementation" | "patch";
export type ChatTakeoverStatus = "pending" | "approved" | "rejected";

export interface ChatTakeoverApproval {
  id: string;
  kind: ChatTakeoverKind;
  title: string;
  preview: string;
  proposal: string;
  status: ChatTakeoverStatus;
  workspaceRoot: string;
  workspaceId: string;
  workspaceContext: RuntimeChatWorkspaceContext | null;
  activeFile: WorkspaceFile | null;
  createdAt: string;
  resultMessage?: string;
}

export interface ToolExecutionApproval {
  id: string;
  actorId: string;
  toolName: ToolName;
  reason: string;
  status: ChatTakeoverStatus;
  createdAt: string;
  inputSnapshot?: Record<string, unknown>;
  workspaceRoot: string;
  workspaceId: string;
}

interface RuntimeChatApprovalState {
  takeovers: ChatTakeoverApproval[];
  toolApprovals: ToolExecutionApproval[];
  requestTakeoverApproval: (input: {
    proposal: string;
    workspaceRoot: string;
    workspaceContext: RuntimeChatWorkspaceContext | null;
    activeFile: WorkspaceFile | null;
  }) => string;
  requestToolApproval: (
    actorId: string,
    toolName: ToolName,
    reason: string,
    inputSnapshot: Record<string, unknown> | undefined,
    workspaceRoot: string
  ) => Promise<boolean>;
  approveToolApproval: (
    approvalId: string,
    options?: { rememberAllowlist?: boolean; workspaceId?: string }
  ) => void;
  rejectToolApproval: (approvalId: string, workspaceId?: string) => void;
  approveTakeover: (
    approvalId: string,
    queueProposedChanges: (changes: ReturnType<typeof parseAgentOutputToProposedChanges>) => Promise<void>,
    workspaceId?: string
  ) => Promise<string>;
  rejectTakeover: (approvalId: string, workspaceId?: string) => void;
  clearResolvedTakeovers: () => void;
  switchWorkspace: (workspaceRoot: string | null) => void;
}

const pendingToolResolvers = new Map<string, (approved: boolean) => void>();

function createApprovalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `takeover-${Date.now().toString(36)}`;
}

function buildTitle(proposal: string): string {
  const firstLine = proposal.trim().split(/\r?\n/, 1)[0]?.trim();
  return firstLine ? firstLine.slice(0, 120) : "Assistant-Vorschlag";
}

export const useRuntimeChatApprovalStore = create<RuntimeChatApprovalState>((set, get) => ({
  takeovers: [],
  toolApprovals: [],

  requestTakeoverApproval: ({ proposal, workspaceRoot, workspaceContext, activeFile }) => {
    const trimmed = proposal.trim();
    const id = createApprovalId();
    const kind: ChatTakeoverKind = looksLikeAgentChangePayload(trimmed) ? "patch" : "implementation";
    const approval: ChatTakeoverApproval = {
      id,
      kind,
      title: buildTitle(trimmed),
      preview: trimmed.slice(0, 280),
      proposal: trimmed,
      status: "pending",
      workspaceRoot,
      workspaceId: workspaceScopeId(workspaceRoot),
      workspaceContext,
      activeFile,
      createdAt: new Date().toISOString()
    };

    set({ takeovers: [approval, ...get().takeovers] });
    return id;
  },

  requestToolApproval: (actorId, toolName, reason, inputSnapshot, workspaceRoot) => {
    const id = createApprovalId();
    const approval: ToolExecutionApproval = {
      id,
      actorId,
      toolName,
      reason,
      status: "pending",
      createdAt: new Date().toISOString(),
      inputSnapshot,
      workspaceRoot,
      workspaceId: workspaceScopeId(workspaceRoot)
    };

    set({ toolApprovals: [approval, ...get().toolApprovals] });

    return new Promise<boolean>((resolve) => {
      pendingToolResolvers.set(id, resolve);
    });
  },

  approveToolApproval: (approvalId, options) => {
    const approval = get().toolApprovals.find((entry) => entry.id === approvalId);
    if (!approval || approval.workspaceId !== options?.workspaceId) {
      throw new Error("Tool-Freigabe gehoert zu einem anderen Workspace.");
    }
    const resolver = pendingToolResolvers.get(approvalId);
    pendingToolResolvers.delete(approvalId);

    if (
      options?.rememberAllowlist &&
      approval?.toolName === "run_terminal_command" &&
      approval.workspaceRoot &&
      typeof approval.inputSnapshot?.command === "string"
    ) {
      rememberTerminalAllowlist(approval.workspaceRoot, approval.inputSnapshot.command);
    }

    set({
      toolApprovals: get().toolApprovals.map((entry) =>
        entry.id === approvalId && entry.status === "pending"
          ? { ...entry, status: "approved" }
          : entry
      )
    });
    resolver?.(true);
  },

  rejectToolApproval: (approvalId, workspaceId) => {
    const approval = get().toolApprovals.find((entry) => entry.id === approvalId);
    if (!approval || approval.workspaceId !== workspaceId) {
      throw new Error("Tool-Freigabe gehoert zu einem anderen Workspace.");
    }
    const resolver = pendingToolResolvers.get(approvalId);
    pendingToolResolvers.delete(approvalId);
    set({
      toolApprovals: get().toolApprovals.map((entry) =>
        entry.id === approvalId && entry.status === "pending"
          ? { ...entry, status: "rejected" }
          : entry
      )
    });
    resolver?.(false);
  },

  approveTakeover: async (approvalId, queueProposedChanges, workspaceId) => {
    const approval = get().takeovers.find((entry) => entry.id === approvalId);
    if (!approval || approval.status !== "pending") {
      throw new Error("Freigabe nicht mehr verfuegbar.");
    }
    if (approval.workspaceId !== workspaceId) {
      throw new Error("Vorschlag gehoert zu einem anderen Workspace.");
    }

    const resultMessage = await executeAssistantTakeover({
      proposal: approval.proposal,
      workspaceRoot: approval.workspaceRoot,
      workspaceContext: approval.workspaceContext,
      activeFile: approval.activeFile,
      queueProposedChanges
    });

    set({
      takeovers: get().takeovers.map((entry) =>
        entry.id === approvalId
          ? { ...entry, status: "approved", resultMessage }
          : entry
      )
    });
    return resultMessage;
  },

  rejectTakeover: (approvalId, workspaceId) => {
    const approval = get().takeovers.find((entry) => entry.id === approvalId);
    if (!approval || approval.workspaceId !== workspaceId) {
      throw new Error("Vorschlag gehoert zu einem anderen Workspace.");
    }
    set({
      takeovers: get().takeovers.map((entry) =>
        entry.id === approvalId && entry.status === "pending"
          ? { ...entry, status: "rejected", resultMessage: "Vorschlag abgelehnt." }
          : entry
      )
    });
  },

  clearResolvedTakeovers: () => {
    set({ takeovers: get().takeovers.filter((entry) => entry.status === "pending") });
  },

  switchWorkspace: (workspaceRoot) => {
    const nextWorkspaceId = workspaceRoot ? workspaceScopeId(workspaceRoot) : null;
    for (const approval of get().toolApprovals) {
      if (approval.status === "pending" && approval.workspaceId !== nextWorkspaceId) {
        pendingToolResolvers.get(approval.id)?.(false);
        pendingToolResolvers.delete(approval.id);
      }
    }
    set({
      takeovers: nextWorkspaceId
        ? get().takeovers.filter((entry) => entry.workspaceId === nextWorkspaceId)
        : [],
      toolApprovals: nextWorkspaceId
        ? get().toolApprovals.filter((entry) => entry.workspaceId === nextWorkspaceId)
        : []
    });
  }
}));
