import { describe, expect, it } from "vitest";
import { classifyTaskForSend } from "./taskClassificationPhase";

const baseInput = {
  trimmedContent: "Hallo",
  targetAgent: "runtime_chat" as const,
  activeFileHasContent: false,
  contextHint: null,
  sendOptions: undefined,
  enabledSkillIds: [],
  jobContextHint: null,
  storeToolsEnabled: false
};

describe("classifyTaskForSend", () => {
  it("classifies a casual message as casual_chat by default", () => {
    const result = classifyTaskForSend(baseInput);
    expect(result.taskType).toBe("casual_chat");
    expect(result.effectiveAgent).toBe("runtime_chat");
  });

  it("forces casual_chat and runtime_chat agent when agentMode=auto and the message is trivial", () => {
    const result = classifyTaskForSend({
      ...baseInput,
      trimmedContent: "danke",
      targetAgent: "coder",
      sendOptions: { agentMode: "auto" }
    });
    expect(result.isAutoTrivial).toBe(true);
    expect(result.taskType).toBe("casual_chat");
    expect(result.effectiveAgent).toBe("runtime_chat");
  });

  it("applies a sticky task type over a casual_chat/normal_chat classification", () => {
    const result = classifyTaskForSend({
      ...baseInput,
      sendOptions: { stickyTaskType: "planning" }
    });
    expect(result.taskType).toBe("planning");
    expect(result.intentClassification.taskType).toBe("planning");
  });

  it("does not override an already-specific task type with the sticky value", () => {
    const result = classifyTaskForSend({
      ...baseInput,
      trimmedContent: "Bitte refactoriere diese Funktion",
      sendOptions: { stickyTaskType: "planning" }
    });
    expect(result.taskType).not.toBe("planning");
  });

  it("prefers sendOptions overrides over store/prop defaults", () => {
    const result = classifyTaskForSend({
      ...baseInput,
      enabledSkillIds: ["a"],
      storeToolsEnabled: false,
      jobContextHint: "job-hint",
      contextHint: "prop-hint",
      sendOptions: { enabledSkillIds: ["b"], toolsEnabled: true, contextHint: "options-hint" }
    });
    expect(result.skillIds).toEqual(["b"]);
    expect(result.toolsEnabled).toBe(true);
    expect(result.resolvedContextHint).toBe("options-hint");
  });

  it("falls back through contextHint prop then jobContextHint when sendOptions has none", () => {
    const result = classifyTaskForSend({
      ...baseInput,
      contextHint: "prop-hint",
      jobContextHint: "job-hint"
    });
    expect(result.resolvedContextHint).toBe("prop-hint");

    const result2 = classifyTaskForSend({
      ...baseInput,
      contextHint: null,
      jobContextHint: "job-hint"
    });
    expect(result2.resolvedContextHint).toBe("job-hint");
  });
});
