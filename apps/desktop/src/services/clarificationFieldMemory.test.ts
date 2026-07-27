import { beforeEach, describe, expect, it } from "vitest";
import {
  appendContractFieldAnswer,
  answeredFieldIds,
  clearActiveTaskContract,
  readActiveTaskContract,
  resetActiveTaskContractMemoryForTests,
  upsertActiveTaskContract
} from "./activeTaskContract";
import { checkMissingInformation } from "./missingInformationPolicy";

const WORKSPACE_A = "C:/repos/workspace-a";
const WORKSPACE_B = "C:/repos/workspace-b";

describe("clarification field memory", () => {
  beforeEach(() => {
    resetActiveTaskContractMemoryForTests();
    clearActiveTaskContract(WORKSPACE_A);
    clearActiveTaskContract(WORKSPACE_B);
  });

  it("asks success_criteria once and stores requiredField", () => {
    const first = checkMissingInformation("planning", "planning", "Erstelle einen klaren Implementierungsplan", false);
    expect(first.find((c) => c.field === "success_criteria")?.present).toBe(false);
    expect(first.find((c) => c.field === "success_criteria")?.askIfMissing.requiredField).toBe(
      "success_criteria"
    );

    upsertActiveTaskContract(WORKSPACE_A, {
      originalRequest: "Plan",
      confirmedGoal: "Smart Practice Session",
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "clarification"
    });

    appendContractFieldAnswer(
      WORKSPACE_A,
      "success_criteria",
      "q-success-random-1",
      "Woran würdest du erkennen, dass die Planung erfolgreich war?",
      "Session kann gestartet, pausiert und wiederhergestellt werden."
    );

    const contract = readActiveTaskContract(WORKSPACE_A);
    expect(contract?.answeredFields.success_criteria?.field).toBe("success_criteria");
    expect(answeredFieldIds(contract).has("success_criteria")).toBe(true);

    const second = checkMissingInformation(
      "planning",
      "planning",
      "Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.",
      false,
      {
        answeredFields: answeredFieldIds(contract),
        confirmedGoal: contract?.confirmedGoal,
        acceptanceCriteria: contract?.acceptanceCriteria
      }
    );

    expect(second.find((c) => c.field === "success_criteria")?.present).toBe(true);
  });

  it("does not re-ask success_criteria when a new random question id would be generated", () => {
    const state = {
      answeredFields: new Set(["success_criteria"]),
      acceptanceCriteria: ["Lifecycle ok"]
    };
    const a = checkMissingInformation("planning", "planning", "Next steps please", false, state);
    const b = checkMissingInformation("planning", "planning", "Next steps please", false, state);
    expect(a.find((c) => c.field === "success_criteria")?.present).toBe(true);
    expect(b.find((c) => c.field === "success_criteria")?.present).toBe(true);
    expect(a.find((c) => c.field === "success_criteria")?.askIfMissing.id).not.toBe(
      b.find((c) => c.field === "success_criteria")?.askIfMissing.id
    );
  });

  it("treats feature acceptance criteria as planning success criteria", () => {
    const checks = checkMissingInformation(
      "planning",
      "planning",
      "Gib die nächsten 3 priorisierten Schritte an.",
      false,
      {
        answeredFields: new Set(),
        acceptanceCriteria: [
          "Session für Gitarre/Bass starten, pausieren, fortsetzen und lokal speichern"
        ]
      }
    );
    expect(checks.find((c) => c.field === "success_criteria")?.present).toBe(true);
  });

  it("allows constraints to be asked separately once, and accepts no-extra-constraints", () => {
    const withSuccessOnly = checkMissingInformation(
      "planning",
      "planning",
      "Plan next steps",
      false,
      { answeredFields: new Set(["success_criteria"]) }
    );
    expect(withSuccessOnly.find((c) => c.field === "success_criteria")?.present).toBe(true);
    expect(withSuccessOnly.find((c) => c.field === "constraints")?.present).toBe(false);

    upsertActiveTaskContract(WORKSPACE_A, {
      originalRequest: "Plan",
      confirmedGoal: "Feature",
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "planning"
    });
    appendContractFieldAnswer(
      WORKSPACE_A,
      "constraints",
      "q-constraints-1",
      "Gibt es technische Einschränkungen oder Vorgaben (Stack, Zeit, Umfang)?",
      "Keine weiteren Vorgaben"
    );
    const contract = readActiveTaskContract(WORKSPACE_A);
    expect(contract?.answeredFields.constraints?.answer).toContain("Keine zusätzlichen Vorgaben");

    const afterConstraints = checkMissingInformation(
      "planning",
      "planning",
      "Plan next steps",
      false,
      { answeredFields: answeredFieldIds(contract) }
    );
    expect(afterConstraints.find((c) => c.field === "constraints")?.present).toBe(true);
  });

  it("keeps clarification answers isolated per workspace", () => {
    upsertActiveTaskContract(WORKSPACE_A, {
      originalRequest: "A",
      confirmedGoal: "Goal A",
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "planning"
    });
    upsertActiveTaskContract(WORKSPACE_B, {
      originalRequest: "B",
      confirmedGoal: "Goal B",
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "planning"
    });
    appendContractFieldAnswer(WORKSPACE_A, "success_criteria", "q-a", "Q?", "Answer A");
    appendContractFieldAnswer(WORKSPACE_B, "constraints", "q-b", "Q?", "Answer B");

    expect(answeredFieldIds(readActiveTaskContract(WORKSPACE_A)).has("success_criteria")).toBe(true);
    expect(answeredFieldIds(readActiveTaskContract(WORKSPACE_A)).has("constraints")).toBe(false);
    expect(answeredFieldIds(readActiveTaskContract(WORKSPACE_B)).has("constraints")).toBe(true);
    expect(answeredFieldIds(readActiveTaskContract(WORKSPACE_B)).has("success_criteria")).toBe(false);
  });
});

describe("pending question rehydration vs answered fields", () => {
  beforeEach(() => {
    resetActiveTaskContractMemoryForTests();
    clearActiveTaskContract(WORKSPACE_A);
  });

  it("treats a pending question as stale when requiredField is already answered", () => {
    upsertActiveTaskContract(WORKSPACE_A, {
      originalRequest: "Plan",
      confirmedGoal: "Feature",
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "planning"
    });
    appendContractFieldAnswer(
      WORKSPACE_A,
      "success_criteria",
      "q-old",
      "Woran würdest du erkennen, dass die Planung erfolgreich war?",
      "Done when lifecycle works"
    );

    const pendingRequiredField = "success_criteria";
    const shouldDropPending = answeredFieldIds(readActiveTaskContract(WORKSPACE_A)).has(pendingRequiredField);
    expect(shouldDropPending).toBe(true);
  });
});
