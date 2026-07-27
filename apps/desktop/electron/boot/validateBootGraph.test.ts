import { describe, expect, it } from "vitest";
import { validateBootGraph } from "./validateBootGraph.js";
import type { BootPhaseDefinition } from "./bootPhaseDefinitions.js";
import type { PhaseRunner } from "./bootOrchestrator.js";

function timeouts(partial: Partial<BootPhaseDefinition["timeouts"]> = {}): BootPhaseDefinition["timeouts"] {
  return {
    softTimeoutMs: 100,
    hardTimeoutMs: 500,
    pollIntervalMs: 50,
    maxRetries: 1,
    retryDelayMs: 10,
    extendDeadlineOnProgress: false,
    maxDeadlineExtensionMs: 0,
    ...partial
  };
}

function phase(partial: Partial<BootPhaseDefinition> & { id: string }): BootPhaseDefinition {
  return {
    label: partial.id,
    dependencies: [],
    optional: false,
    blocksWindowRelease: true,
    timeouts: timeouts(),
    ...partial
  };
}

const noopRunner: PhaseRunner = async () => ({ outcome: "success", message: "" });

function runnersFor(defs: BootPhaseDefinition[]): Record<string, PhaseRunner> {
  const runners: Record<string, PhaseRunner> = {};
  for (const def of defs) runners[def.id] = noopRunner;
  return runners;
}

describe("validateBootGraph", () => {
  it("accepts a well-formed graph", () => {
    const defs = [phase({ id: "a" }), phase({ id: "b", dependencies: ["a"] })];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a duplicate phase id", () => {
    const defs = [phase({ id: "a" }), phase({ id: "a" })];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate phase id"))).toBe(true);
  });

  it("rejects a dependency referencing an unknown phase", () => {
    const defs = [phase({ id: "a", dependencies: ["ghost"] })];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown phase "ghost"'))).toBe(true);
  });

  it("rejects a phase with no registered runner", () => {
    const defs = [phase({ id: "a" })];
    const result = validateBootGraph(defs, {});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("no registered runner"))).toBe(true);
  });

  it("rejects a runner with no matching phase", () => {
    const defs = [phase({ id: "a" })];
    const runners = { ...runnersFor(defs), extra: noopRunner };
    const result = validateBootGraph(defs, runners);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Runner "extra" has no matching phase'))).toBe(true);
  });

  it("rejects a direct cycle", () => {
    const defs = [phase({ id: "a", dependencies: ["b"] }), phase({ id: "b", dependencies: ["a"] })];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cycle detected"))).toBe(true);
  });

  it("rejects an indirect cycle", () => {
    const defs = [
      phase({ id: "a", dependencies: ["c"] }),
      phase({ id: "b", dependencies: ["a"] }),
      phase({ id: "c", dependencies: ["b"] })
    ];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cycle detected"))).toBe(true);
  });

  it("rejects an unreachable phase (dependency chain never bottoms out)", () => {
    // "island" depends on a nonexistent phase, so its chain never resolves —
    // distinct from the cycle case above since there's no cycle here.
    const defs = [phase({ id: "a" }), phase({ id: "island", dependencies: ["ghost-dep"] })];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"island" is not reachable'))).toBe(true);
  });

  it("rejects an invalid timeout (hardTimeoutMs <= softTimeoutMs)", () => {
    const defs = [phase({ id: "a", timeouts: timeouts({ softTimeoutMs: 500, hardTimeoutMs: 100 }) })];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("hardTimeoutMs") && e.includes("must be greater than softTimeoutMs"))).toBe(true);
  });

  it("rejects pollIntervalMs <= 0", () => {
    const defs = [phase({ id: "a", timeouts: timeouts({ pollIntervalMs: 0 }) })];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("pollIntervalMs must be greater than 0"))).toBe(true);
  });

  it("rejects a negative maxRetries", () => {
    const defs = [phase({ id: "a", timeouts: timeouts({ maxRetries: -1 }) })];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("maxRetries must be an integer"))).toBe(true);
  });

  it("rejects multiple release phases (no unique phase that nothing depends on)", () => {
    const defs = [phase({ id: "a" }), phase({ id: "b" })];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Expected exactly one non-optional release phase"))).toBe(true);
  });

  it("does not count an optional dangling leaf as a competing release-phase candidate", () => {
    // Mirrors the real production shape: resident-model is optional and (in
    // the current phase order) nothing depends on it, yet main-app-released
    // must still be recognized as the sole release phase.
    const defs = [
      phase({ id: "a" }),
      phase({ id: "release", dependencies: ["a"] }),
      phase({ id: "optional-leaf", optional: true })
    ];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a graph where every dangling leaf is optional (no mandatory release phase)", () => {
    const defs = [phase({ id: "a" }), phase({ id: "optional-leaf", dependencies: ["a"], optional: true })];
    const result = validateBootGraph(defs, runnersFor(defs));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Expected exactly one non-optional release phase"))).toBe(true);
  });
});
