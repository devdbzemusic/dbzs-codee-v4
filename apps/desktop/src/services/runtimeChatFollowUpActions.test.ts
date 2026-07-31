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

  it("echtes Retry: nutzt den urspruenglichen Nutzerprompt statt einer Standardformulierung", () => {
    const actions = buildFollowUpActions(
      baseContext({ outcome: "generation_failed", originalUserPrompt: "Baue eine neue Login-Seite." })
    );
    const retry = actions.find((a) => a.kind === "retry_run")!;
    expect(retry.payload.prompt).toBe("Baue eine neue Login-Seite.");
    expect(retry.payload.retryOriginal).toBe(true);
  });

  it("echtes Retry: faellt ohne urspruenglichen Prompt auf die generische Formulierung zurueck", () => {
    const actions = buildFollowUpActions(baseContext({ outcome: "generation_failed" }));
    const retry = actions.find((a) => a.kind === "retry_run")!;
    expect(retry.payload.prompt).toBe("Bitte versuche die letzte Aufgabe erneut auszuführen.");
    expect(retry.payload.retryOriginal).toBe(false);
  });

  it("echtes Retry: traegt Run-Kontext (taskType/provider/agentMode/forceUseResidentModel) im Payload", () => {
    const run = { id: "run-1", provider: "llama-cpp", mode: "agent" } as unknown as RuntimeChatRun;
    const actions = buildFollowUpActions(
      baseContext({ outcome: "generation_failed", taskType: "debugging", run })
    );
    const retry = actions.find((a) => a.kind === "retry_run")!;
    expect(retry.payload.taskType).toBe("debugging");
    expect(retry.payload.provider).toBe("llama-cpp");
    expect(retry.payload.agentMode).toBe("agent");
    expect(retry.payload.forceUseResidentModel).toBe(true);
  });

  it('Fehlschlag mit hohem Resource-Risiko zeigt zusaetzlich "Modell wechseln"', () => {
    const run = { id: "run-1", resourceRisk: "high" } as unknown as RuntimeChatRun;
    const actions = buildFollowUpActions(baseContext({ outcome: "generation_failed", run }));
    expect(actions.map((a) => a.kind)).toEqual(["retry_run", "switch_model", "inspect_result"]);
    expect(actions).toHaveLength(3);
  });

  it('Fehlschlag mit abgelehntem Fallback-Modell zeigt "Modell wechseln"', () => {
    const run = {
      id: "run-1",
      fallbackRejection: { modelId: "m1", modelName: "Model 1", reason: "incompatible" }
    } as unknown as RuntimeChatRun;
    const actions = buildFollowUpActions(baseContext({ outcome: "generation_failed", run }));
    expect(actions.map((a) => a.kind)).toContain("switch_model");
  });

  it("Fehlschlag ohne Resource-Risiko zeigt kein Modellwechsel-Angebot", () => {
    const run = { id: "run-1", resourceRisk: "low" } as unknown as RuntimeChatRun;
    const actions = buildFollowUpActions(baseContext({ outcome: "generation_failed", run }));
    expect(actions.map((a) => a.kind)).toEqual(["retry_run", "inspect_result"]);
  });

  it("execution_no_action mit Code-Spuren bietet Recovery-Auswahl an", () => {
    const message: RuntimeChatMessage = {
      id: "msg-recovery",
      role: "assistant",
      content: "Im Ausfuehrungsmodus wurden keine Tools ausgefuehrt.",
      rawContent: "Datei: `src/app.ts`\n```ts\nexport const ok = true;\n```"
    };
    const actions = buildFollowUpActions(
      baseContext({
        message,
        outcome: "execution_no_action",
        originalUserPrompt: "Fixe src/app.ts"
      })
    );

    expect(actions.map((a) => a.title)).toEqual(["Aktion vorbereiten", "Mit Tools erneut", "Nur analysieren"]);
    expect(actions[0]!.payload.recoveryKind).toBe("no_action_output");
    expect(actions[0]!.payload.prompt).toContain("Wandle das jetzt in eine sichere CODEE-Aktion um.");
  });

  it("execution_no_action ohne Code-Spuren bietet Retry und Analyse an", () => {
    const actions = buildFollowUpActions(
      baseContext({
        outcome: "execution_no_action",
        message: { id: "msg-empty", role: "assistant", content: "Ich kann das leider nicht tun." }
      })
    );

    expect(actions.map((a) => a.title)).toEqual(["Mit Tools erneut", "Nur analysieren"]);
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

  it("echtes Retry: findet den urspruenglichen Nutzerprompt ueber run.userMessageId", () => {
    const userMessage: RuntimeChatMessage = { id: "msg-user", role: "user", content: "Fixe den Login-Bug." };
    const run = {
      id: "run-1",
      userMessageId: "msg-user",
      provider: "llama-cpp",
      outcome: "generation_failed"
    } as unknown as RuntimeChatRun;
    const result = attachFollowUpActionsToMessages({
      ...baseInput(),
      messages: [userMessage, finalizedAssistantMessage],
      run,
      taskType: "debugging",
      hasPatchProposal: false
    });
    const assistant = result.find((m) => m.id === finalizedAssistantMessage.id)!;
    const retry = assistant.actions?.find((a) => a.kind === "retry_run");
    expect(retry?.payload.prompt).toBe("Fixe den Login-Bug.");
  });

  it("Freitext-Fehlererkennung: Stacktrace in der Antwort loest Fehler-Folgeaktionen aus, auch ohne Tool-Fehler", () => {
    const message: RuntimeChatMessage = {
      id: "msg-1",
      role: "assistant",
      content: "Beim Ausfuehren trat auf:\nTypeError: Cannot read properties of undefined (reading 'foo')"
    };
    const result = attachFollowUpActionsToMessages({
      ...baseInput(),
      messages: [message],
      finalizedAssistantMessage: message,
      run: { id: "run-1", outcome: "success" } as unknown as RuntimeChatRun
    });
    const actions = result[0]!.actions ?? [];
    expect(actions.map((a) => a.kind)).toContain("continue_task");
    expect(actions.find((a) => a.kind === "continue_task")!.title).toBe("Fehler beheben");
  });

  it("Freitext-Fehlererkennung: normale Erwaehnung von 'Fehler' loest keine Fehler-Folgeaktionen aus", () => {
    const message: RuntimeChatMessage = {
      id: "msg-1",
      role: "assistant",
      content: "Der Fehler in der letzten Version wurde bereits vor zwei Wochen behoben."
    };
    const result = attachFollowUpActionsToMessages({
      ...baseInput(),
      messages: [message],
      finalizedAssistantMessage: message
    });
    const actions = result[0]!.actions ?? [];
    expect(actions.find((a) => a.kind === "continue_task")!.title).toBe("Vertiefen");
  });
});
