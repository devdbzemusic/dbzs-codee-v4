import { describe, expect, it } from "vitest";
import type { BootState } from "@dbzs/shared";
import { collectRetryAllPhaseIds } from "./bootEventBridge.js";

function createState(overrides?: Partial<BootState>): BootState {
  return {
    runId: "run-1",
    status: "failed",
    currentPhaseId: null,
    overallProgress: 100,
    phases: [
      {
        id: "backend-spawn",
        label: "Backend",
        state: "failed",
        progress: 100,
        message: "port blocked",
        dependencies: [],
        optional: false,
        blocksWindowRelease: true,
        pollCount: 1,
        retryCount: 0,
        details: []
      },
      {
        id: "frontend-config-sync",
        label: "Frontend",
        state: "blocked",
        progress: 0,
        message: "blocked",
        dependencies: ["backend-spawn"],
        optional: false,
        blocksWindowRelease: true,
        pollCount: 0,
        retryCount: 0,
        details: []
      },
      {
        id: "main-app-released",
        label: "Release",
        state: "success",
        progress: 100,
        message: "done",
        dependencies: ["frontend-config-sync"],
        optional: false,
        blocksWindowRelease: true,
        pollCount: 0,
        retryCount: 0,
        details: []
      }
    ],
    startedAt: 1,
    backendPid: null,
    backendPort: 8876,
    activeRuntimeSlot: null,
    residentModelId: null,
    detectedModelCount: 7,
    lastErrorMessage: "failed",
    ...overrides
  };
}

describe("collectRetryAllPhaseIds", () => {
  it("returns only failed and blocked phases in boot order", () => {
    const state = createState();

    expect(collectRetryAllPhaseIds(state)).toEqual(["backend-spawn", "frontend-config-sync"]);
  });

  it("returns an empty list when nothing is retryable", () => {
    const state = createState({
      status: "ready",
      phases: createState().phases.map((phase) => ({
        ...phase,
        state: phase.id === "main-app-released" ? "success" : "success"
      })),
      lastErrorMessage: null
    });

    expect(collectRetryAllPhaseIds(state)).toEqual([]);
  });
});
