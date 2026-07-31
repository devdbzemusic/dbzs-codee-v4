import { describe, expect, it } from "vitest";
import {
  checkMissingInformation,
  workflowForTaskType
} from "@/services/missingInformationPolicy";

describe("workflowForTaskType", () => {
  it("maps coding task types", () => {
    expect(workflowForTaskType("small_code_change")).toBe("coding");
    expect(workflowForTaskType("large_code_change")).toBe("coding");
    expect(workflowForTaskType("refactoring")).toBe("coding");
  });

  it("maps review task types", () => {
    expect(workflowForTaskType("review")).toBe("review");
    expect(workflowForTaskType("test_analysis")).toBe("review");
  });

  it("maps planning task types", () => {
    expect(workflowForTaskType("planning")).toBe("planning");
    expect(workflowForTaskType("architecture")).toBe("planning");
  });

  it("returns null for chat/utility task types", () => {
    expect(workflowForTaskType("casual_chat")).toBeNull();
    expect(workflowForTaskType("normal_chat")).toBeNull();
    expect(workflowForTaskType("debugging")).toBeNull();
    expect(workflowForTaskType("embedding")).toBeNull();
  });
});

describe("checkMissingInformation — coding", () => {
  it("asks for the desired behavior on an open StringLab feature intent", () => {
    const checks = checkMissingInformation(
      "coding",
      "small_code_change",
      "Wir bauen heute eine kleine neue Funktion für StringLab",
      false
    );

    expect(checks.find((check) => check.field === "target")?.askIfMissing.prompt)
      .toBe("Welche konkrete Funktion soll StringLab bekommen?");
  });

  it("flags target and acceptance criteria as missing for a vague request", () => {
    const checks = checkMissingInformation("coding", "small_code_change", "fix it", false);
    const target = checks.find((c) => c.field === "target");
    const acceptance = checks.find((c) => c.field === "acceptance_criteria");

    expect(target?.present).toBe(false);
    expect(acceptance?.present).toBe(false);
  });

  it("offers selectable acceptance criteria with an optional custom answer", () => {
    const checks = checkMissingInformation("coding", "small_code_change", "fix it", false);
    const acceptance = checks.find((c) => c.field === "acceptance_criteria")?.askIfMissing;

    expect(acceptance?.questionType).toBe("single_choice");
    expect(acceptance?.defaultOptionId).toBe("tests_green");
    expect(acceptance?.allowFreeText).toBe(true);
    expect(acceptance?.options?.map((option) => option.id)).toEqual([
      "tests_green",
      "ui_behavior_visible",
      "bug_not_reproducible",
      "preserve_existing_behavior"
    ]);
  });

  it("treats target as present when a file path is mentioned", () => {
    const checks = checkMissingInformation(
      "coding",
      "small_code_change",
      "fix the bug in apps/desktop/src/foo.ts",
      false
    );
    expect(checks.find((c) => c.field === "target")?.present).toBe(true);
  });

  it("treats target as present when file context is already open", () => {
    const checks = checkMissingInformation("coding", "small_code_change", "fix this", true);
    expect(checks.find((c) => c.field === "target")?.present).toBe(true);
  });

  it("treats acceptance criteria as present when a success condition is stated", () => {
    const checks = checkMissingInformation(
      "coding",
      "small_code_change",
      "fix the login bug damit die Tests wieder gruen werden",
      false
    );
    expect(checks.find((c) => c.field === "acceptance_criteria")?.present).toBe(true);
  });

  it("only checks scope_boundary for large changes/refactors", () => {
    const small = checkMissingInformation("coding", "small_code_change", "fix it", false);
    const large = checkMissingInformation("coding", "large_code_change", "refactor it", false);

    expect(small.find((c) => c.field === "scope_boundary")).toBeUndefined();
    expect(large.find((c) => c.field === "scope_boundary")).toBeDefined();
  });

  it("treats scope_boundary as present when a scope keyword is used", () => {
    const checks = checkMissingInformation(
      "coding",
      "large_code_change",
      "refactor this, nur in dieser Datei",
      false
    );
    expect(checks.find((c) => c.field === "scope_boundary")?.present).toBe(true);
  });

  it("treats a file-specific behavior-preserving refactor as sufficiently scoped", () => {
    const checks = checkMissingInformation(
      "coding",
      "refactoring",
      "Refactore src/core/reportFormatter.ts, aber veraendere das Verhalten nicht",
      false
    );

    expect(checks.find((c) => c.field === "acceptance_criteria")?.present).toBe(true);
    expect(checks.find((c) => c.field === "scope_boundary")?.present).toBe(true);
  });
});

describe("checkMissingInformation — review", () => {
  it("flags review target and focus as missing for a generic review request", () => {
    const checks = checkMissingInformation("review", "review", "review this", false);
    expect(checks.find((c) => c.field === "review_target")?.present).toBe(false);
    expect(checks.find((c) => c.field === "review_focus")?.present).toBe(false);
  });

  it("skips scope ask for complete repository review", () => {
    const checks = checkMissingInformation(
      "review",
      "review",
      "Mache einen kompletten Codereview",
      false
    );
    expect(checks.length).toBe(0);
  });

  it("treats focus as present when a concrete focus is named", () => {
    const checks = checkMissingInformation("review", "review", "review this for security issues", true);
    expect(checks.find((c) => c.field === "review_focus")?.present).toBe(true);
  });
});

describe("checkMissingInformation — planning", () => {
  it("flags success criteria and constraints as missing for a vague plan request", () => {
    const checks = checkMissingInformation("planning", "planning", "plan a new feature", false);
    expect(checks.find((c) => c.field === "success_criteria")?.present).toBe(false);
    expect(checks.find((c) => c.field === "constraints")?.present).toBe(false);
  });

  it("treats success criteria as present when a definition of done is stated", () => {
    const checks = checkMissingInformation(
      "planning",
      "planning",
      "plan this; success means a working prototype with tests exists",
      false
    );
    expect(checks.find((c) => c.field === "success_criteria")?.present).toBe(true);
  });

  it("treats success criteria as present when answeredFields already contains it", () => {
    const checks = checkMissingInformation(
      "planning",
      "planning",
      "Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.",
      false,
      { answeredFields: new Set(["success_criteria"]) }
    );
    expect(checks.find((c) => c.field === "success_criteria")?.present).toBe(true);
    expect(checks.find((c) => c.field === "success_criteria")?.askIfMissing.requiredField).toBe(
      "success_criteria"
    );
  });

  it("treats feature acceptanceCriteria as planning success criteria", () => {
    const checks = checkMissingInformation(
      "planning",
      "planning",
      "Next steps",
      false,
      {
        answeredFields: new Set(),
        acceptanceCriteria: ["Session lifecycle + local persistence"]
      }
    );
    expect(checks.find((c) => c.field === "success_criteria")?.present).toBe(true);
  });

  it("does not force extra planning clarification when deliverables are already explicit", () => {
    const checks = checkMissingInformation(
      "planning",
      "planning",
      "Erstelle einen klaren Implementierungsplan mit konkreten Schritten, Risiken und Tests",
      false
    );
    expect(checks.find((c) => c.field === "success_criteria")?.present).toBe(true);
    expect(checks.find((c) => c.field === "constraints")?.present).toBe(true);
  });
});
