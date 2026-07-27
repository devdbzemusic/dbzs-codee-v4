import { describe, expect, it, vi } from "vitest";
import { runAgentChatTurnLoop } from "./runtimeChatAgentRunner";

vi.mock("@/runtime/agent/agentProfilePolicy", () => ({
  upsertRuntimeActorPolicyForProfile: vi.fn()
}));

vi.mock("@/runtime/agent/toolProtocolAdapter", () => ({
  buildToolSystemMessages: vi.fn(() => []),
  resolveToolProtocolMode: vi.fn(() => "text")
}));

vi.mock("@/runtime/tool/toolDisclosure", () => ({
  resolveToolExposure: vi.fn(() => ({ deferrableNames: [] }))
}));

vi.mock("@/services/toolAvailabilityService", () => ({
  buildToolAvailabilityContext: vi.fn(() => ({}))
}));

vi.mock("@/services/runtimeKernelService", () => ({
  buildRuntimeToolRequest: vi.fn()
}));

vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => ({
      queueProposedChanges: vi.fn(),
      applyPendingChange: vi.fn()
    })
  }
}));

vi.mock("@/stores/runtimeAgentStore", () => ({
  useRuntimeAgentStore: {
    getState: () => ({
      runTool: vi.fn()
    })
  }
}));

vi.mock("@/runtime/agent/agentTurnEngine", () => ({
  runAgentTurnEngine: vi.fn(async (params) => {
    params.callbacks.onTurnStart(1);
    let streamed = "";
    const response = await params.requestAssistant(
      "coder",
      { messages: [{ role: "user", content: "Hi" }], max_tokens: 16 },
      (delta: string, totalLength: number) => {
        streamed += delta;
        params.callbacks.onAssistantDelta(delta, totalLength, 1);
      }
    );

    return {
      finalContent: response.message.content || streamed,
      trajectory: { runId: "run-test", events: [] },
      patchCount: 0,
      patchDetected: false,
      systemMessages: [],
      lastResponse: response,
      turnsExecuted: 1,
      toolCallsExecuted: 0
    };
  })
}));

describe("runAgentChatTurnLoop", () => {
  it("streams each assistant delta only once to the UI", async () => {
    const updates: string[] = [];

    await runAgentChatTurnLoop({
      runId: "run-test",
      goal: "Antworten",
      targetAgent: "coder",
      profile: "agent",
      workspaceRoot: "C:/workspace",
      systemMessages: [],
      historyMessages: [],
      requestAssistant: async (_request, onDelta) => {
        onDelta("Hallo", 5);
        onDelta(" Welt", 11);
        return {
          message: { id: "msg-test-assistant", role: "assistant", content: "Hallo Welt" },
          model_id: "coder",
          model_name: "Coder"
        };
      },
      onStreamUpdate: (content) => {
        updates.push(content);
      },
      onTurnStart: vi.fn()
    });

    expect(updates).toEqual(["Hallo", "Hallo Welt"]);
  });
});
