import { beforeEach, describe, expect, it } from "vitest";
import { getActiveRunIdsSnapshot, markRunActive, markRunInactive } from "./activeRunTracker";

describe("activeRunTracker", () => {
  beforeEach(() => {
    for (const runId of getActiveRunIdsSnapshot()) {
      markRunInactive(runId);
    }
  });

  it("tracks a run as active once marked", () => {
    markRunActive("run-1");
    expect(getActiveRunIdsSnapshot()).toEqual(["run-1"]);
  });

  it("removes a run once marked inactive", () => {
    markRunActive("run-1");
    markRunInactive("run-1");
    expect(getActiveRunIdsSnapshot()).toEqual([]);
  });

  it("supports multiple concurrent runs (e.g. two windows sending at once)", () => {
    markRunActive("run-1");
    markRunActive("run-2");
    expect(getActiveRunIdsSnapshot().sort()).toEqual(["run-1", "run-2"]);

    markRunInactive("run-1");
    expect(getActiveRunIdsSnapshot()).toEqual(["run-2"]);
  });

  it("ignores null, undefined and blank run ids", () => {
    markRunActive(null);
    markRunActive(undefined);
    markRunActive("   ");
    expect(getActiveRunIdsSnapshot()).toEqual([]);

    // Must not throw when marking inactive either.
    expect(() => markRunInactive(null)).not.toThrow();
    expect(() => markRunInactive(undefined)).not.toThrow();
  });

  it("marking an already-inactive run inactive again is a no-op", () => {
    markRunActive("run-1");
    markRunInactive("run-1");
    markRunInactive("run-1");
    expect(getActiveRunIdsSnapshot()).toEqual([]);
  });

  it("trims whitespace before tracking", () => {
    markRunActive("  run-1  ");
    expect(getActiveRunIdsSnapshot()).toEqual(["run-1"]);
  });
});
