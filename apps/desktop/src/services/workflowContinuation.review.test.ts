import { describe, expect, it } from "vitest";
import type { ActiveTaskContract } from "@/services/activeTaskContract";
import {
  phaseForTaskType,
  resolvePhaseForRoutedAgent,
  resolveWorkflowContinuation
} from "@/services/workflowContinuation";

function contract(partial: Partial<ActiveTaskContract> = {}): ActiveTaskContract {
  return {
    workflowId: "wf-1",
    workspaceId: "ws-1",
    workspaceRoot: "C:/tmp/ws",
    runId: "run-1",
    originalRequest: "baue feature",
    confirmedGoal: "feature",
    acceptanceCriteria: [],
    answeredQuestions: [],
    answeredFields: {},
    taskType: "large_code_change",
    assignedAgent: "planner",
    currentPhase: "implementation",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial
  };
}

describe("workflowContinuation review switch", () => {
  it("switches an open coding contract to review without ambiguity ask", () => {
    const result = resolveWorkflowContinuation({
      message: "mach einfach einen Code Review",
      contract: contract(),
      classifiedTaskType: "review"
    });
    expect(result.useActiveContract).toBe(true);
    expect(result.taskType).toBe("review");
    expect(result.needsAmbiguityAsk).toBe(false);
    expect(phaseForTaskType(result.taskType)).toBe("review");
  });

  it("treats a short follow-up like 'ja' as a natural continuation", () => {
    const result = resolveWorkflowContinuation({
      message: "ja",
      contract: contract(),
      classifiedTaskType: "casual_chat"
    });
    expect(result.useActiveContract).toBe(true);
    expect(result.needsAmbiguityAsk).toBe(false);
    expect(result.reason).toBe("active_workflow_continue");
  });

  it("treats a terse 'weiter' as a natural continuation", () => {
    const result = resolveWorkflowContinuation({
      message: "weiter",
      contract: contract(),
      classifiedTaskType: "casual_chat"
    });
    expect(result.useActiveContract).toBe(true);
    expect(result.needsAmbiguityAsk).toBe(false);
    expect(result.reason).toBe("active_workflow_continue");
  });

  it("still asks when the user clearly pivots into an independent chat question", () => {
    const result = resolveWorkflowContinuation({
      message: "Erkläre mir bitte kurz, was Event Sourcing ist.",
      contract: contract(),
      classifiedTaskType: "casual_chat"
    });
    expect(result.useActiveContract).toBe(false);
    expect(result.needsAmbiguityAsk).toBe(true);
    expect(result.reason).toBe("workflow_ambiguity");
  });
});

describe("resolvePhaseForRoutedAgent", () => {
  it("keeps planner-first refactor starts in planning (not implementation)", () => {
    expect(resolvePhaseForRoutedAgent("refactoring", "planner")).toBe("planning");
    expect(resolvePhaseForRoutedAgent("small_code_change", "planner")).toBe("planning");
    expect(resolvePhaseForRoutedAgent("large_code_change", "coder")).toBe("implementation");
  });

  it("keeps chat default on clarification", () => {
    expect(resolvePhaseForRoutedAgent("casual_chat", "default")).toBe("clarification");
  });
});
