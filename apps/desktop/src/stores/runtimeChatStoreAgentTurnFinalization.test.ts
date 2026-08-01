import { describe, expect, it, vi } from "vitest";
import type { AgentChatRunnerResult } from "@/services/runtimeChatAgentRunner";
import { finalizeAgentTurnResult } from "@/stores/runtimeChatStoreAgentTurnFinalization";

describe("finalizeAgentTurnResult", () => {
  it("normalizes invalid_protocol without envelope evidence to execution_no_action", async () => {
    const result = await finalizeAgentTurnResult({
      agentResult: {
        finalContent: "Analyse alle gguf.json Dateien:",
        trajectory: {
          runId: "run-agent",
          goal: "Erstelle eine Liste mit Informationen zu allen GGUF Modellen.",
          profile: "ask",
          startedAt: new Date().toISOString(),
          status: "failed",
          turns: [],
          totalToolCalls: 0,
          events: []
        } as AgentChatRunnerResult["trajectory"],
        patchCount: 0,
        patchDetected: false,
        systemMessages: [],
        lastResponse: {
          message: { role: "assistant", content: "Analyse alle gguf.json Dateien:" },
          model_id: "model",
          model_name: "Model",
          finish_reason: "stop"
        } as AgentChatRunnerResult["lastResponse"],
        assistantMessage: {
          id: "msg-assistant",
          role: "assistant",
          content: "Analyse alle gguf.json Dateien:",
          rawContent: "Analyse alle gguf.json Dateien:"
        },
        turnsExecuted: 2,
        toolCallsExecuted: 0,
        terminalReason: "invalid_protocol"
      },
      currentMessages: [{ id: "msg-assistant", role: "assistant", content: "" }],
      trimmedContent: "Erstelle eine Liste mit Informationen zu allen GGUF Modellen.",
      executionIntentForTurn: "implement",
      toolsEnabled: true,
      workspaceRoot: "D:\\Models",
      initialRunId: "run-normalized-invalid-protocol",
      routing: {
        targetAgent: "planner",
        modelId: "model",
        modelName: "Model",
        providerId: "llama-cpp",
        warmupStatus: "ready"
      },
      contextSlotId: "fast_gpu",
      safeTraceEvents: [],
      tokenBudget: { runtimeContextLimit: 4096, totalRequiredTokens: 1200 },
      firstTokenAt: new Date().toISOString(),
      taskType: "large_code_change",
      activeTaskPhase: "planning",
      reasoningTraceEnabled: false,
      applyPlanningRelevanceGate: async (answer) => ({ content: answer }),
      persistTraceEvents: vi.fn()
    });

    expect(result.finalization.outcome).toBe("execution_no_action");
    expect(result.finalization.error?.stage).toBe("generation");
    expect(result.finalization.userMessage).toContain("keine Tools");
  });
});
