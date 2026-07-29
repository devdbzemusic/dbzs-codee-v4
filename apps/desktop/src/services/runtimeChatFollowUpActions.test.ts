import { describe, expect, it } from "vitest";
import type { RuntimeChatMessage, RuntimeChatRun } from "@dbzs/shared";
import { attachFollowUpActionsToMessages, buildFollowUpActions, type FollowUpActionContext } from "./runtimeChatFollowUpActions";

function baseContext(overrides: Partial<FollowUpActionContext> = {}): FollowUpActionContext {
  return {
    message: { id: "msg-1", role: "assistant", content: "answer" },
    run: null,
    taskType: "normal_chat",
    outcome: "success",
    status: "completed",
    hasPlanProposal: false,
    hasPatchProposal: false,
    hasErrors: false,
    workspaceRoot: "C:/work/a",
    ...overrides
  };
}

describe("buildFollowUpActions", () => {
  it("normaler Chat zeigt Folgeaktionen", () => {
    const actions = buildFollowUpActions(baseContext());
    expect(actions).toHaveLength(3);
    expect(actions.map((a) => a.kind)).toEqual(["continue_task", "show_next_steps", "new_task"]);
    expect(actions[0]!.title).toBe("Vertiefen");
  });

  it('Plan zeigt "Plan umsetzen"', () => {
    const actions = buildFollowUpActions(baseContext({ taskType: "planning" }));
    expect(actions.map((a) => a.kind)).toContain("implement_plan");
    expect(actions.find((a) => a.kind === "implement_plan")!.title).toBe("Plan umsetzen");
  });

  it('Analyse mit Fehlern zeigt "Fehler beheben"', () => {
    const actions = buildFollowUpActions(baseContext({ hasErrors: true }));
    const fixAction = actions.find((a) => a.kind === "continue_task");
    expect(fixAction).toBeDefined();
    expect(fixAction!.title).toBe("Fehler beheben");
  });

  it('fehlgeschlagener Run zeigt "Erneut versuchen"', () => {
    const actions = buildFollowUpActions(baseContext({ outcome: "generation_failed" }));
    expect(actions.map((a) => a.kind)).toEqual(["retry_run", "inspect_result"]);
    expect(actions[0]!.title).toBe("Erneut versuchen");
  });

  it("needs_user_input erzeugt keine konkurrierenden Vorschlaege", () => {
    expect(buildFollowUpActions(baseContext({ outcome: "needs_user_input" }))).toEqual([]);
  });

  it("cancelled erzeugt keine Vorschlaege", () => {
    expect(buildFollowUpActions(baseContext({ outcome: "cancelled" }))).toEqual([]);
  });

  it("Patch-Approval bleibt unveraendert (hasPatchProposal unterdrueckt Follow-ups)", () => {
    expect(buildFollowUpActions(baseContext({ hasPatchProposal: true, taskType: "planning" }))).toEqual([]);
  });

  it("Plan-Proposal unterdrueckt Follow-ups", () => {
    expect(buildFollowUpActions(baseContext({ hasPlanProposal: true }))).toEqual([]);
  });

  it("Review zeigt weiterhin Findings-Aktionen (generischer Builder haelt sich raus)", () => {
    const run = { id: "run-1", repositoryReview: { reviewId: "r1" } } as unknown as RuntimeChatRun;
    expect(buildFollowUpActions(baseContext({ run, outcome: "success" }))).toEqual([]);
  });
});

describe("attachFollowUpActionsToMessages", () => {
  const finalizedAssistantMessage: RuntimeChatMessage = { id: "msg-1", role: "assistant", content: "answer" };

  function baseInput() {
    return {
      messages: [finalizedAssistantMessage] as RuntimeChatMessage[],
      finalizedAssistantMessage,
      run: null,
      taskType: "normal_chat",
      hasPlanProposal: false,
      hasPatchProposal: false,
      workspaceRoot: "C:/work/a"
    };
  }

  it("attaches follow-up actions to the target message", () => {
    const result = attachFollowUpActionsToMessages(baseInput());
    expect(result[0]!.actions).toHaveLength(3);
  });

  it("is idempotent when called twice on the same message", () => {
    const once = attachFollowUpActionsToMessages(baseInput());
    const twice = attachFollowUpActionsToMessages({ ...baseInput(), messages: once });
    expect(twice[0]!.actions).toHaveLength(3);
  });

  it("returns the original messages array when the target message is not found", () => {
    const input = { ...baseInput(), messages: [] as RuntimeChatMessage[] };
    expect(attachFollowUpActionsToMessages(input)).toBe(input.messages);
  });
});
