import { describe, expect, it, vi } from "vitest";
import {
  applyPreflightVisionOptions,
  handleClarificationAssistantAnswerFlow,
  handleWorkflowScopeAssistantAnswerFlow,
  type AssistantAnswerPreflight
} from "@/stores/runtimeChatStoreAssistantAnswerFlows";

vi.mock("@/services/decisionMemoryService", () => ({
  recordProjectDecision: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/services/pendingQuestionPersistence", () => ({
  clearPendingQuestion: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/services/pendingWorkflowScopeDecision", () => ({
  clearPendingWorkflowScopeDecision: vi.fn(),
  readPendingWorkflowScopeDecision: vi.fn(() => null)
}));

vi.mock("@/services/activeTaskContract", () => ({
  appendContractFieldAnswer: vi.fn(),
  pauseActiveTaskContract: vi.fn(),
  readActiveTaskContract: vi.fn(() => null),
  upsertActiveTaskContract: vi.fn()
}));

const basePreflight: AssistantAnswerPreflight = {
  originalMessage: "Bitte reviewe diesen Screenshot",
  targetAgent: "runtime_chat",
  workspaceRoot: "C:/repo",
  workflow: "clarification",
  taskType: "review",
  hasImageInput: true,
  requiresVision: true
};

describe("runtimeChatStoreAssistantAnswerFlows", () => {
  it("maps preflight vision options deterministically", () => {
    expect(applyPreflightVisionOptions(basePreflight)).toEqual({
      hasImageInput: true,
      requiresVision: true
    });
    expect(
      applyPreflightVisionOptions({
        ...basePreflight,
        hasImageInput: false,
        requiresVision: false
      })
    ).toEqual({
      hasImageInput: false,
      requiresVision: false
    });
  });

  it("preserves vision flags when continuing after clarification", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await handleClarificationAssistantAnswerFlow({
      preflight: basePreflight,
      question: {
        id: "clarify-review-target",
        questionType: "free_text",
        prompt: "Was genau soll ich im Screenshot pruefen?",
        requiredField: "target",
        toolCallId: "tool-clarify-review-target"
      },
      answer: {
        questionId: "clarify-review-target",
        answeredAt: "2026-07-28T20:06:00.000Z",
        freeText: "Bitte Fokus auf UI-Regressionen und Routing."
      },
      sendMessage
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[2]).toMatchObject({
      hasImageInput: true,
      requiresVision: true,
      stickyTaskType: "review"
    });
  });

  it("preserves vision flags when continuing the active workflow after ambiguity resolution", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await handleWorkflowScopeAssistantAnswerFlow({
      preflight: basePreflight,
      selectedOptionId: "continue_active_task",
      sendMessage
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[2]).toMatchObject({
      hasImageInput: true,
      requiresVision: true,
      stickyTaskType: "review",
      forceContinueActiveWorkflow: true
    });
  });
});
