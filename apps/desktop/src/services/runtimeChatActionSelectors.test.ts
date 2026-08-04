import { describe, expect, it } from "vitest";
import {
  findLastAssistantMessageIndex,
  getFollowUpChatActions,
  getRequiredChatActions,
  getRuntimeAgentActionsForMessage,
  getTransportActionTone,
  getTransportChatActions,
  hasPendingRuntimeActionKind,
  isRejectTransportAction
} from "./runtimeChatActionSelectors";

describe("runtimeChatActionSelectors", () => {
  it("derives transport and runtime actions for a message", () => {
    const message = {
      id: "msg-1",
      role: "assistant" as const,
      content: "approval needed",
      actionIds: ["cmd-1"],
      actions: [
        {
          id: "act-1",
          runId: "run-1",
          messageId: "msg-1",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "approve_command" as const,
          title: "Ausfuehren",
          state: "pending" as const,
          payload: { commandId: "pnpm test", approvalRequestId: "cmd-1" },
          createdAt: new Date().toISOString()
        }
      ]
    };

    const transportActions = getTransportChatActions(message);
    const runtimeActions = getRuntimeAgentActionsForMessage(message, {
      "cmd-1": {
        kind: "command",
        id: "cmd-1",
        runId: "run-1",
        version: 1,
        riskLevel: "medium",
        state: "pending",
        commandRequestId: "cmd-1"
      }
    });

    expect(transportActions).toHaveLength(1);
    expect(runtimeActions).toHaveLength(1);
    expect(hasPendingRuntimeActionKind(runtimeActions, "command")).toBe(true);
    expect(isRejectTransportAction(transportActions[0])).toBe(false);
  });

  it("filters answer_question out of transport chips", () => {
    const message = {
      id: "msg-2",
      role: "system" as const,
      content: "workflow ask",
      actions: [
        {
          id: "act-q",
          runId: "run-1",
          messageId: "msg-2",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "answer_question" as const,
          title: "Workflow-Fortsetzung",
          state: "pending" as const,
          payload: {
            question: {
              id: "q1",
              questionType: "single_choice" as const,
              prompt: "Bleiben oder neu?",
              toolCallId: "workflow-continuation-policy",
              options: [
                { id: "continue_active_task", label: "Bleiben" },
                { id: "start_new_task", label: "Neu" }
              ]
            }
          },
          createdAt: new Date().toISOString()
        }
      ]
    };

    expect(getTransportChatActions(message)).toEqual([]);
  });

  it("returns red tone for destructive transport actions", () => {
    const tone = getTransportActionTone({
      id: "act-reject",
      runId: "run-1",
      messageId: "msg-1",
      workspaceRoot: "C:/work/a",
      workspaceId: "c:/work/a",
      kind: "reject_patch",
      title: "Ablehnen",
      state: "pending",
      payload: { proposalId: "patch-1" },
      createdAt: new Date().toISOString()
    });

    expect(tone.statusBadgeClass).toBe("text-dbzs-red");
  });

  it("partitions required vs follow-up actions from a mixed actions array", () => {
    const message = {
      id: "msg-3",
      role: "assistant" as const,
      content: "patch proposed with a suggested follow-up",
      actions: [
        {
          id: "act-approve-patch",
          runId: "run-1",
          messageId: "msg-3",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "approve_patch" as const,
          title: "Uebernehmen",
          state: "pending" as const,
          payload: { proposalId: "patch-1" },
          createdAt: new Date().toISOString()
        },
        {
          id: "act-continue-task",
          runId: "run-1",
          messageId: "msg-3",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "continue_task" as const,
          title: "Vertiefen",
          state: "pending" as const,
          payload: { prompt: "Vertiefe deine letzte Antwort mit mehr Details." },
          createdAt: new Date().toISOString()
        }
      ]
    };

    const required = getRequiredChatActions(message);
    const followUps = getFollowUpChatActions(message);

    expect(required).toHaveLength(1);
    expect(required[0].kind).toBe("approve_patch");
    expect(followUps).toHaveLength(1);
    expect(followUps[0].kind).toBe("continue_task");
  });

  it("finds the last assistant message even when trailing system messages follow it", () => {
    const messages = [
      { id: "m1", role: "user" as const, content: "hi" },
      { id: "m2", role: "assistant" as const, content: "hello" },
      { id: "m3", role: "system" as const, content: "[Analyse-Protokoll] ..." }
    ];

    expect(findLastAssistantMessageIndex(messages)).toBe(1);
  });

  it("returns -1 when there is no assistant message", () => {
    const messages = [{ id: "m1", role: "user" as const, content: "hi" }];
    expect(findLastAssistantMessageIndex(messages)).toBe(-1);
  });
});
