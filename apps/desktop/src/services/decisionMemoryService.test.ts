import { describe, expect, it } from "vitest";
import { clearRunDecisions, lookupRunDecision, recordRunDecision } from "@/services/decisionMemoryService";
import type { DecisionMemoryEntry } from "@dbzs/shared";

function entry(overrides: Partial<DecisionMemoryEntry> = {}): DecisionMemoryEntry {
  return {
    id: `d-${Math.random()}`,
    workflow: "coding",
    questionPrompt: "Welche Datei bzw. welches Modul soll geändert werden?",
    answer: { questionId: "q1", answeredAt: new Date().toISOString(), freeText: "apps/desktop/src/foo.ts" },
    scope: "run",
    decidedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("decisionMemoryService — run scope", () => {
  it("returns null when nothing has been recorded for the run", () => {
    const runId = `run-${Math.random()}`;
    expect(lookupRunDecision(runId, "coding", "Welche Datei soll geändert werden?")).toBeNull();
  });

  it("finds a previously recorded decision for a similar question in the same workflow", () => {
    const runId = `run-${Math.random()}`;
    recordRunDecision(runId, entry());

    const found = lookupRunDecision(runId, "coding", "Welche Datei bzw. welches Modul soll geändert werden?");
    expect(found).not.toBeNull();
    expect(found?.answer.freeText).toBe("apps/desktop/src/foo.ts");
  });

  it("does not match across different workflows", () => {
    const runId = `run-${Math.random()}`;
    recordRunDecision(runId, entry({ workflow: "coding" }));

    expect(lookupRunDecision(runId, "review", "Welche Datei bzw. welches Modul soll geändert werden?")).toBeNull();
  });

  it("does not match an unrelated question", () => {
    const runId = `run-${Math.random()}`;
    recordRunDecision(runId, entry());

    expect(lookupRunDecision(runId, "coding", "Soll ich die Tests auch anpassen?")).toBeNull();
  });

  it("does not match decisions from a different run", () => {
    const runIdA = `run-${Math.random()}`;
    const runIdB = `run-${Math.random()}`;
    recordRunDecision(runIdA, entry());

    expect(lookupRunDecision(runIdB, "coding", "Welche Datei bzw. welches Modul soll geändert werden?")).toBeNull();
  });

  it("clearRunDecisions removes all decisions for that run", () => {
    const runId = `run-${Math.random()}`;
    recordRunDecision(runId, entry());
    clearRunDecisions(runId);

    expect(lookupRunDecision(runId, "coding", "Welche Datei bzw. welches Modul soll geändert werden?")).toBeNull();
  });

  it("ignores expired decisions", () => {
    const runId = `run-${Math.random()}`;
    recordRunDecision(runId, entry({ expiresAt: new Date(Date.now() - 1000).toISOString() }));

    expect(lookupRunDecision(runId, "coding", "Welche Datei bzw. welches Modul soll geändert werden?")).toBeNull();
  });
});
