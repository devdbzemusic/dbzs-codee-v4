import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalHub } from "./approvalHub";
import { useRuntimeChatApprovalStore } from "@/stores/runtimeChatApprovalStore";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";

describe("approvalHub", () => {
  beforeEach(() => {
    useRuntimeChatApprovalStore.setState({ takeovers: [], toolApprovals: [] });
    useRuntimeChatStore.setState({ messages: [] });
  });

  it("delegates takeover decisions through the central hub", async () => {
    const queueProposedChanges = vi.fn();
    const approveTakeover = vi.spyOn(useRuntimeChatApprovalStore.getState(), "approveTakeover").mockResolvedValue("ok");
    const rejectTakeover = vi.spyOn(useRuntimeChatApprovalStore.getState(), "rejectTakeover").mockImplementation(() => undefined);

    await expect(approvalHub.approveTakeover("takeover-1", queueProposedChanges)).resolves.toBe("ok");
    approvalHub.rejectTakeover("takeover-1");

    expect(approveTakeover).toHaveBeenCalledWith("takeover-1", queueProposedChanges);
    expect(rejectTakeover).toHaveBeenCalledWith("takeover-1");
  });

  it("delegates structured chat actions through the central hub", async () => {
    const handleChatAction = vi.spyOn(useRuntimeChatStore.getState(), "handleChatAction").mockResolvedValue(undefined);

    await approvalHub.approveChatAction("action-1", "message-1", "c:/work/a");
    await approvalHub.rejectChatAction("action-2", "message-2", "c:/work/a");

    expect(handleChatAction).toHaveBeenNthCalledWith(1, "action-1", "message-1", true, "c:/work/a");
    expect(handleChatAction).toHaveBeenNthCalledWith(2, "action-2", "message-2", false, "c:/work/a");
  });

  it("counts pending structured chat actions in the hub", () => {
    const pendingCount = approvalHub.getPendingCount([], [
      {
        id: "msg-1",
        role: "assistant",
        content: "approval needed",
        actions: [{
          id: "act-1",
          runId: "run-1",
          messageId: "msg-1",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "approve_command",
          title: "Ausfuehren",
          state: "pending",
          payload: { commandId: "pnpm test" },
          createdAt: new Date().toISOString()
        }]
      }
    ]);

    expect(pendingCount).toBe(1);
    expect(approvalHub.getPendingStructuredChatActions(useRuntimeChatStore.getState().messages)).toEqual([]);
  });

  it("deduplicates pending runtime approvals into a single approval item", () => {
    const approvals = approvalHub.getPendingStructuredApprovalItems([
      {
        id: "msg-command",
        role: "assistant",
        content: "Command approval needed",
        actions: [
          {
            id: "act-command-approve",
            runId: "run-1",
            messageId: "msg-command",
            workspaceRoot: "C:/work/a",
            workspaceId: "c:/work/a",
            kind: "approve_command",
            title: "Ausfuehren",
            state: "pending",
            payload: { commandId: "pnpm test", approvalRequestId: "cmd-1" },
            createdAt: new Date().toISOString()
          },
          {
            id: "act-command-reject",
            runId: "run-1",
            messageId: "msg-command",
            workspaceRoot: "C:/work/a",
            workspaceId: "c:/work/a",
            kind: "reject_command",
            title: "Ablehnen",
            state: "pending",
            payload: { commandId: "pnpm test", approvalRequestId: "cmd-1" },
            createdAt: new Date().toISOString()
          }
        ]
      }
    ]);

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      id: "cmd-1",
      messageId: "msg-command",
      kind: "command",
      approveActionId: "act-command-approve",
      rejectActionId: "act-command-reject"
    });
  });

  it("maps structured chat actions to runtime agent actions", () => {
    const actions = approvalHub.getRuntimeAgentActions([
      {
        id: "msg-plan",
        role: "assistant",
        content: "Plan approval needed",
        actions: [
          {
            id: "act-plan-approve",
            runId: "run-1",
            messageId: "msg-plan",
            workspaceRoot: "C:/work/a",
            workspaceId: "c:/work/a",
            kind: "approve_plan",
            title: "Plan uebernehmen",
            state: "pending",
            payload: { planProposalId: "plan-1" },
            createdAt: new Date().toISOString()
          },
          {
            id: "act-plan-reject",
            runId: "run-1",
            messageId: "msg-plan",
            workspaceRoot: "C:/work/a",
            workspaceId: "c:/work/a",
            kind: "reject_plan",
            title: "Ablehnen",
            state: "pending",
            payload: { planProposalId: "plan-1" },
            createdAt: new Date().toISOString()
          }
        ]
      },
      {
        id: "msg-cmd",
        role: "assistant",
        content: "Command approval needed",
        actions: [{
          id: "act-cmd",
          runId: "run-2",
          messageId: "msg-cmd",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "approve_command",
          title: "Ausfuehren",
          state: "pending",
          payload: { commandId: "pnpm test", approvalRequestId: "cmd-1" },
          createdAt: new Date().toISOString()
        }]
      }
    ], {
      planProposalsById: {
        "plan-1": {
          type: "agent_plan_proposal",
          version: 1,
          id: "plan-1",
          runId: "run-1",
          title: "Inspect and fix",
          summary: "Review the code and apply the patch.",
          steps: [],
          createdAt: new Date().toISOString(),
          state: "proposed"
        }
      }
    });

    expect(actions).toHaveLength(2);
    expect(actions[0]?.action.kind).toBe("plan");
    expect(actions[0]?.sourceActionIds).toHaveLength(2);
    expect(actions[1]?.action.kind).toBe("command");
    expect(actions[1]?.action.id).toBe("cmd-1");
  });
});
