import { describe, expect, it } from "vitest";
import { BOOT_PHASE_DEFINITIONS } from "./bootPhaseDefinitions.js";
import { validateBootGraph } from "./validateBootGraph.js";
import type { PhaseRunner } from "./bootOrchestrator.js";

// These phases' runners (phaseRunners.ts) return outcome:"failed" purely to
// mean "not ready yet" — the orchestrator's retry loop doubles as a poll.
// Regression test for a real bug found via live testing: backend-health-live
// failed at exactly retryCount(40) * retryDelayMs(500) = 20s despite a 60s
// hardTimeoutMs, because retryCount was tuned independently of the deadline.
const POLLING_PHASE_IDS = [
  "backend-health-live",
  "backend-ready",
  "database-init",
  "model-index",
  "runtime-manager-init",
  "resident-model"
];

describe("BOOT_PHASE_DEFINITIONS timeout/retry consistency", () => {
  it.each(POLLING_PHASE_IDS)("%s: maxRetries * retryDelayMs comfortably exceeds hardTimeoutMs", (id) => {
    const def = BOOT_PHASE_DEFINITIONS.find((p) => p.id === id);
    expect(def).toBeDefined();
    const retryBudgetMs = def!.timeouts.maxRetries * def!.timeouts.retryDelayMs;
    expect(retryBudgetMs).toBeGreaterThanOrEqual(def!.timeouts.hardTimeoutMs);
  });

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
