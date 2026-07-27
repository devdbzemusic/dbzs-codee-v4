import { describe, expect, it, vi } from "vitest";
import { runAgentTurnEngine } from "@/runtime/agent/agentTurnEngine";
import type { RuntimeChatResponse } from "@dbzs/shared";

function mockResponse(content: string, toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>): RuntimeChatResponse {
  return {
    message: {
      role: "assistant",
      content,
      ...(toolCalls ? { tool_calls: toolCalls } : {})
    } as RuntimeChatResponse["message"],
    model_id: "test",
    model_name: "test"
  } as RuntimeChatResponse;
}

describe("runAgentTurnEngine execution no-action", () => {
  it("does not complete implement goals without tools; one repair then execution_no_action", async () => {
    const requestAssistant = vi
      .fn()
      .mockResolvedValueOnce(mockResponse("Öffne dein Terminal und führe npm install aus."))
      .mockResolvedValueOnce(mockResponse("Hier ist weiterhin nur eine Anleitung."));

    const result = await runAgentTurnEngine({
      runId: "run-1",
      goal: "Baue Electron ein.",
      targetAgent: "coder",
      profile: "agent",
      workspaceRoot: "C:\\tmp\\ws",
      toolAvailabilityContext: {
        workspaceRoot: "C:\\tmp\\ws",
        hasTerminalBridge: true,
        hasTestCommands: true,
        hasGitRepo: true
      },
      baseMessages: [{ id: "u1", role: "user", content: "Baue Electron ein." }],
      requireToolAction: true,
      requestAssistant: async () => requestAssistant(),
      runTool: vi.fn(),
      queuePatches: vi.fn(),
      applyPatches: vi.fn(),
      callbacks: {
        onTurnStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onToolCall: vi.fn()
      }
    });

    expect(requestAssistant).toHaveBeenCalledTimes(2);
    expect(result.toolCallsExecuted).toBe(0);
    expect(result.terminalReason).toBe("execution_no_action");
    expect(result.trajectory.status).toBe("failed");
  });

  it("allows a valid tool call with empty final text", async () => {
    const requestAssistant = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse("", [
          {
            id: "tc1",
            type: "function",
            function: { name: "list_files", arguments: "{}" }
          }
        ])
      )
      .mockResolvedValueOnce(mockResponse("Workspace gelesen, nächster Schritt folgt."));

    const runTool = vi.fn().mockResolvedValue({
      toolName: "list_files",
      requestId: "r1",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "ok",
      output: ["package.json"]
    });

    const result = await runAgentTurnEngine({
      runId: "run-2",
      goal: "Baue Electron ein.",
      targetAgent: "coder",
      profile: "agent",
      workspaceRoot: "C:\\tmp\\ws",
      toolAvailabilityContext: {
        workspaceRoot: "C:\\tmp\\ws",
        hasTerminalBridge: true,
        hasTestCommands: true,
        hasGitRepo: true
      },
      baseMessages: [{ id: "u1", role: "user", content: "Baue Electron ein." }],
      policy: { maxRuntimeMs: 60_000, maxSteps: 2, maxToolCalls: 4, maxRetriesPerStep: 1, requiresApprovalForPatch: true },
      requireToolAction: true,
      requestAssistant: async () => requestAssistant(),
      runTool,
      queuePatches: vi.fn(),
      applyPatches: vi.fn(),
      callbacks: {
        onTurnStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onToolCall: vi.fn()
      }
    });

    expect(runTool).toHaveBeenCalled();
    expect(result.toolCallsExecuted).toBeGreaterThan(0);
    expect(result.terminalReason).not.toBe("execution_no_action");
  });
});
