import { describe, expect, it } from "vitest";
import type { ActiveTaskContract } from "@/services/activeTaskContract";
import {
  buildWorkflowAmbiguityQuestion,
  mapWorkflowScopeTextAlias,
  workflowScopeDecisionLabel
} from "@/services/workflowContinuation";

function makeContract(overrides: Partial<ActiveTaskContract> = {}): ActiveTaskContract {
  return {
    workspaceId: "ws",
    workspaceRoot: "C:/tmp/stringlab",
    workflowId: "wf-stringlab",
    runId: "run-1",
    originalRequest: "Baue StringLab Smart Practice Session",
    confirmedGoal: "StringLab Smart Practice Session",
    acceptanceCriteria: ["Demo läuft"],
    currentPhase: "planning",
    assignedAgent: "planner",
    taskType: "planning",
    answeredQuestions: [],
    answeredFields: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("buildWorkflowAmbiguityQuestion", () => {
  it("erzeugt echte single_choice Optionen ohne A/B-Fließtext im Prompt", () => {
    const built = buildWorkflowAmbiguityQuestion(makeContract());
    expect(built.question.questionType).toBe("single_choice");
    expect(built.question.requiredField).toBe("workflow_scope_decision");
    expect(built.question.allowFreeText).toBe(false);
    expect(built.question.defaultOptionId).toBe("continue_active_task");
    expect(built.question.options?.map((o) => o.id)).toEqual([
      "continue_active_task",
      "start_new_task"
    ]);
    expect(built.prompt).not.toMatch(/A\s*[–-]/);
    expect(built.prompt).not.toMatch(/B\s*[–-]/);
    expect(built.question.prompt).toBe(built.prompt);
    expect(built.question.options?.[0]?.recommended).toBe(true);
  });
});

describe("mapWorkflowScopeTextAlias", () => {
  it("mappt A/1/weiter auf continue_active_task", () => {
    expect(mapWorkflowScopeTextAlias("A")).toBe("continue_active_task");
    expect(mapWorkflowScopeTextAlias("1")).toBe("continue_active_task");
    expect(mapWorkflowScopeTextAlias("weiter")).toBe("continue_active_task");
    expect(mapWorkflowScopeTextAlias("beim Auftrag bleiben")).toBe("continue_active_task");
  });

  it("mappt B/2/neu auf start_new_task", () => {
    expect(mapWorkflowScopeTextAlias("B")).toBe("start_new_task");
    expect(mapWorkflowScopeTextAlias("2")).toBe("start_new_task");
    expect(mapWorkflowScopeTextAlias("neu")).toBe("start_new_task");
    expect(mapWorkflowScopeTextAlias("neue Aufgabe")).toBe("start_new_task");
  });

  it("gibt null für unklare Texte", () => {
    expect(mapWorkflowScopeTextAlias("vielleicht später")).toBeNull();
    expect(mapWorkflowScopeTextAlias("erkläre Quantenphysik")).toBeNull();
  });
});

describe("workflowScopeDecisionLabel", () => {
  it("liefert kurze Verlaufslabels", () => {
    expect(workflowScopeDecisionLabel("continue_active_task")).toContain("Auftrag bleiben");
    expect(workflowScopeDecisionLabel("start_new_task")).toContain("Neue Aufgabe");
  });
});
