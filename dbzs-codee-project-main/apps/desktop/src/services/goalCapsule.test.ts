import { describe, expect, it } from "vitest";
import { classifyTaskType, matchesReviewIntent } from "@/services/modelSelectionBroker";
import { classifyUserExecutionIntent } from "@/services/executionIntent";
import { resolveWorkflowContinuation } from "@/services/workflowContinuation";
import { buildGoalCapsule, formatGoalCapsuleBlock } from "@/services/goalCapsule";
import { groundToolCall } from "@/services/toolCallGrounding";
import { computeAgentTurnTokenBudget, resolveEffectiveRuntimeDevice } from "@/services/agentTurnBudget";
import { computeFinalRequestTokenBudget } from "@/services/finalRequestTokenBudget";
import type { ActiveTaskContract } from "@/services/activeTaskContract";

function reviewContract(): ActiveTaskContract {
  return {
    workspaceId: "ws",
    workspaceRoot: "C:/tmp/ws",
    workflowId: "wf-1",
    runId: "run-1",
    originalRequest: "Mach einen Code Review",
    confirmedGoal: "Code Review",
    acceptanceCriteria: [],
    currentPhase: "review",
    assignedAgent: "reviewer",
    taskType: "review",
    answeredQuestions: [],
    answeredFields: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

describe("goal capsule routing P0", () => {
  it("routes Implementiere Electron to implement/coding, not review", () => {
    expect(classifyUserExecutionIntent("Implementiere Electron")).toBe("implement");
    expect(classifyTaskType("Implementiere Electron")).toBe("large_code_change");
    expect(matchesReviewIntent("Implementiere Electron")).toBe(false);
  });

  it("does not let a stale review contract override Implementiere Electron", () => {
    const result = resolveWorkflowContinuation({
      message: "Implementiere Electron",
      contract: reviewContract(),
      classifiedTaskType: "large_code_change"
    });
    expect(result.useActiveContract).toBe(false);
    expect(result.taskType).toBe("large_code_change");
  });

  it("keeps explicit review routing", () => {
    expect(classifyTaskType("Mach einen kompletten Code Review.")).toBe("review");
  });
});

describe("goal capsule", () => {
  it("formats a non-droppable capsule with original user message", () => {
    const capsule = buildGoalCapsule({
      runId: "run-1",
      workspaceRoot: "C:/repos/guitar-bass-academy",
      originalUserMessage: "Implementiere Electron",
      targetAgent: "coder"
    });
    const block = formatGoalCapsuleBlock(capsule);
    expect(block).toContain("P0_NON_DROPPABLE");
    expect(block).toContain("Implementiere Electron");
    expect(block).toContain("executionIntent: implement");
  });
});

describe("tool grounding", () => {
  it("rejects demo placeholder paths and greps", () => {
    expect(
      groundToolCall({
        toolName: "read_file",
        toolInput: { path: "./src/functions/exampleFunction.js" },
        goalText: "Implementiere Electron"
      }).rejectionReason
    ).toBe("demo_placeholder");

    expect(
      groundToolCall({
        toolName: "grep",
        toolInput: { pattern: "^test.*featureName$" },
        goalText: "Implementiere Electron"
      }).rejectionReason
    ).toBe("demo_placeholder");
  });

  it("allows package.json reads for electron goals", () => {
    const result = groundToolCall({
      toolName: "read_file",
      toolInput: { path: "package.json" },
      goalText: "Implementiere Electron"
    });
    expect(result.rejectionReason).toBeUndefined();
    expect(result.groundedInGoal).toBe(true);
  });
});

describe("per-turn budget + overflow honesty", () => {
  it("does not invent toolTokens=1 for empty toolsText", () => {
    const budget = computeFinalRequestTokenBudget({
      runtimeContextLimit: 4096,
      systemText: "hello",
      toolsText: "",
      chatText: "user",
      outputReserveTokens: 512
    });
    expect(budget.toolTokens).toBe(0);
  });

  it("computes overflowTokens from turn budget components", () => {
    const turn = computeAgentTurnTokenBudget({
      runId: "run-1",
      turnIndex: 1,
      runtimeContextLimit: 100,
      goalText: "x".repeat(400),
      systemText: "y".repeat(400),
      toolsText: "z".repeat(400),
      chatHistoryText: "h".repeat(400)
    });
    expect(turn.overflowTokens).toBeGreaterThan(0);
    expect(turn.toolSchemaTokens).toBeGreaterThan(0);
  });
});

describe("effective runtime device", () => {
  it("marks gpuLayers=0 as CPU fallback", () => {
    const device = resolveEffectiveRuntimeDevice({
      configuredSlot: "fast_gpu",
      gpuLayers: 0
    });
    expect(device.effectiveDevice).toBe("cpu");
  });

  it("marks gpuLayers>0 as GPU", () => {
    const device = resolveEffectiveRuntimeDevice({
      configuredSlot: "fast_gpu",
      gpuLayers: 33
    });
    expect(device.effectiveDevice).toBe("gpu");
  });
});
