import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkflowContinuationForSend } from "./workflowContinuationPhase";
import { clearActiveTaskContract } from "@/services/activeTaskContract";

const workspaceRoot = "C:/repo/demo";

const baseInput = {
  trimmedContent: "Hallo",
  sendOptions: undefined,
  isAutoTrivial: false,
  taskType: "casual_chat" as const,
  effectiveAgent: "runtime_chat" as const,
  intentClassification: {
    taskType: "casual_chat" as const,
    confidence: 1,
    matchedPatterns: [],
    alternativeTaskTypes: []
  },
  messages: [],
  lastRouting: null,
  lastBrokerDecision: null,
  lastActivitySummary: null,
  activeRunStatus: null
};

describe("resolveWorkflowContinuationForSend", () => {
  afterEach(() => {
    clearActiveTaskContract(workspaceRoot);
  });

  it("returns a continue outcome for a plain message with no active contract", () => {
    const result = resolveWorkflowContinuationForSend(baseInput);
    expect(result.kind).toBe("continue");
    if (result.kind === "continue") {
      expect(result.taskType).toBe("casual_chat");
      expect(result.activeTaskContract).toBeNull();
    }
  });

  it("answers 'summarize active task' meta-intent directly without touching routing", () => {
    const result = resolveWorkflowContinuationForSend({
      ...baseInput,
      trimmedContent: "Fasse den aktuellen Auftrag zusammen"
    });
    expect(result.kind).toBe("summarize_active_task");
    if (result.kind === "summarize_active_task") {
      expect(result.userMessage.role).toBe("user");
      expect(result.assistantMessage.role).toBe("assistant");
    }
  });
});
