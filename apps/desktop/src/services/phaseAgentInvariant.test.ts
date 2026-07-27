import { describe, expect, it } from "vitest";
import { assertValidPhaseAgentPair } from "@/services/phaseAgentInvariant";

describe("assertValidPhaseAgentPair", () => {
  it("allows default/runtime_chat during clarification (chat path)", () => {
    expect(assertValidPhaseAgentPair("clarification", "default")).toEqual({ ok: true });
    expect(assertValidPhaseAgentPair("clarification", "runtime_chat")).toEqual({ ok: true });
    expect(assertValidPhaseAgentPair("clarification", "planner")).toEqual({ ok: true });
  });

  it("rejects coder during clarification", () => {
    const result = assertValidPhaseAgentPair("clarification", "coder");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("invalid_phase_agent_pair");
      expect(result.expected).toContain("planner");
    }
  });

  it("requires coder for implementation", () => {
    expect(assertValidPhaseAgentPair("implementation", "coder")).toEqual({ ok: true });
    expect(assertValidPhaseAgentPair("implementation", "default").ok).toBe(false);
  });
});
