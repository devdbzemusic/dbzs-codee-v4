import { describe, expect, it } from "vitest";
import { BOOT_PHASE_DEFINITIONS } from "./bootPhaseDefinitions.js";
import { validateBootGraph } from "./validateBootGraph.js";
import type { PhaseRunner } from "./bootOrchestrator.js";

describe("BOOT_PHASE_DEFINITIONS timeout/retry consistency", () => {
  it("every phase id is unique and every dependency references a defined phase", () => {
    const ids = new Set(BOOT_PHASE_DEFINITIONS.map((p) => p.id));
    expect(ids.size).toBe(BOOT_PHASE_DEFINITIONS.length);
    for (const phase of BOOT_PHASE_DEFINITIONS) {
      for (const dep of phase.dependencies) {
        expect(ids.has(dep)).toBe(true);
      }
    }
  });

  it("passes validateBootGraph's full structural validation (regression guard for the real production graph)", () => {
    const stubRunner: PhaseRunner = async () => ({ outcome: "success", message: "" });
    const runners: Record<string, PhaseRunner> = {};
    for (const def of BOOT_PHASE_DEFINITIONS) runners[def.id] = stubRunner;

    const result = validateBootGraph(BOOT_PHASE_DEFINITIONS, runners);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
