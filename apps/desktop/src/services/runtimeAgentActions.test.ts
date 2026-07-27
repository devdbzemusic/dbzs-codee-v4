import { describe, expect, it } from "vitest";
import { buildRuntimeAgentActionRegistry, getPendingStructuredApprovalItems } from "./runtimeAgentActions";

describe("runtimeAgentActions", () => {
  it("builds agent action registry entries and message actionIds from structured chat actions", () => {
    const registry = buildRuntimeAgentActionRegistry([
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
        id: "msg-command",
        role: "assistant",
        content: "Command approval needed",
        actions: [{
          id: "act-command",
          runId: "run-2",
          messageId: "msg-command",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "approve_command",
          title: "Ausfuehren",
          state: "pending",
          payload: { commandId: "pnpm test", approvalRequestId: "command-1" },
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

    expect(registry.agentActionsById["plan-1"]?.kind).toBe("plan");
    expect(registry.agentActionsById["command-1"]?.kind).toBe("command");
    expect(registry.messages.find((message) => message.id === "msg-plan")?.actionIds).toEqual(["plan-1"]);
    expect(registry.messages.find((message) => message.id === "msg-command")?.actionIds).toEqual(["command-1"]);
  });

  it("deduplicates approve/reject source actions into one pending approval item", () => {
    const approvals = getPendingStructuredApprovalItems([
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
            payload: { commandId: "pnpm test", approvalRequestId: "command-1" },
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
            payload: { commandId: "pnpm test", approvalRequestId: "command-1" },
            createdAt: new Date().toISOString()
          }
        ]
      }
    ]);

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      id: "command-1",
      workspaceId: "c:/work/a",
      kind: "command",
      approveActionId: "act-command-approve",
      rejectActionId: "act-command-reject"
    });
  });

  it("filters structured approvals by workspace", () => {
    const messages = [{
      id: "msg-command",
      role: "assistant" as const,
      content: "Command approval needed",
      actions: [{
        id: "act-command",
        runId: "run-1",
        messageId: "msg-command",
        workspaceRoot: "C:/work/a",
        workspaceId: "c:/work/a",
        kind: "approve_command" as const,
        title: "Ausfuehren",
        state: "pending" as const,
        payload: { commandId: "pnpm test", approvalRequestId: "command-1" },
        createdAt: new Date().toISOString()
      }]
    }];

    expect(getPendingStructuredApprovalItems(messages, { workspaceId: "c:/work/a" })).toHaveLength(1);
    expect(getPendingStructuredApprovalItems(messages, { workspaceId: "c:/work/b" })).toEqual([]);
  });
});
