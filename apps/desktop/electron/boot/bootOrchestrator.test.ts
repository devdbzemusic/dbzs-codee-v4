import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootOrchestrator, type PhaseRunner, type PhaseRunnerResult } from "./bootOrchestrator.js";
import type { BootPhaseDefinition } from "./bootPhaseDefinitions.js";

function timeouts(partial: Partial<BootPhaseDefinition["timeouts"]> = {}): BootPhaseDefinition["timeouts"] {
  return {
    softTimeoutMs: 50,
    hardTimeoutMs: 200,
    pollIntervalMs: 10,
    maxRetries: 0,
    retryDelayMs: 10,
    extendDeadlineOnProgress: false,
    maxDeadlineExtensionMs: 0,
    ...partial
  };
}

function def(partial: Partial<BootPhaseDefinition> & { id: string }): BootPhaseDefinition {
  return {
    label: partial.id,
    dependencies: [],
    optional: false,
    blocksWindowRelease: true,
    timeouts: timeouts(),
    ...partial
  };
}

function ok(message = "ok"): PhaseRunnerResult {
  return { outcome: "success", message };
}

function fail(message = "fail"): PhaseRunnerResult {
  return { outcome: "failed", message, error: { code: "test", message, retryAttempts: 0 } };
}

function pending(message = "pending", progress?: number): PhaseRunnerResult {
  return { outcome: "pending", message, progress, pollAfterMs: 5 };
}

function skip(message = "skipped"): PhaseRunnerResult {
  return { outcome: "skipped", message };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BootOrchestrator", () => {
  it("runs a full successful boot in dependency order", async () => {
    const order: string[] = [];
    const phases = [def({ id: "a" }), def({ id: "b", dependencies: ["a"] }), def({ id: "c", dependencies: ["b"] })];
    const runners: Record<string, PhaseRunner> = {
      a: async () => {
        order.push("a");
        return ok();
      },
      b: async () => {
        order.push("b");
        return ok();
      },
      c: async () => {
        order.push("c");
        return ok();
      }
    };

    const orchestrator = new BootOrchestrator(phases, runners);
    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const finalState = await runPromise;

    expect(order).toEqual(["a", "b", "c"]);
    expect(finalState.status).toBe("ready");
    expect(finalState.phases.every((p) => p.state === "success")).toBe(true);
    expect(finalState.overallProgress).toBe(100);
  });

  it("retries a phase that fails transiently and eventually succeeds (late backend start)", async () => {
    let attempts = 0;
    const phases = [def({ id: "backend", timeouts: timeouts({ softTimeoutMs: 50, hardTimeoutMs: 500, maxRetries: 5, retryDelayMs: 20 }) })];
    const runners: Record<string, PhaseRunner> = {
      backend: async () => {
        attempts += 1;
        return attempts < 3 ? fail("not up yet") : ok("up");
      }
    };

    const orchestrator = new BootOrchestrator(phases, runners);
    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const finalState = await runPromise;

    expect(attempts).toBe(3);
    expect(finalState.phases[0].state).toBe("success");
    expect(finalState.phases[0].retryCount).toBe(2);
    expect(finalState.status).toBe("ready");
  });

  it("fails a phase and blocks its dependents when the backend process never starts", async () => {
    const phases = [
      def({ id: "spawn", timeouts: timeouts({ softTimeoutMs: 10, hardTimeoutMs: 50, maxRetries: 1, retryDelayMs: 5 }) }),
      def({ id: "alive", dependencies: ["spawn"] }),
      def({ id: "unrelated" }),
      def({ id: "release", dependencies: ["alive", "unrelated"] })
    ];
    const runners: Record<string, PhaseRunner> = {
      spawn: async () => fail("ENOENT"),
      alive: async () => ok(),
      unrelated: async () => ok(),
      release: async () => ok()
    };

    const orchestrator = new BootOrchestrator(phases, runners);
    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const finalState = await runPromise;

    const spawn = finalState.phases.find((p) => p.id === "spawn")!;
    const alive = finalState.phases.find((p) => p.id === "alive")!;
    const unrelated = finalState.phases.find((p) => p.id === "unrelated")!;

    expect(spawn.state).toBe("failed");
    expect(spawn.retryCount).toBe(1);
    expect(alive.state).toBe("blocked");
    expect(unrelated.state).toBe("success");
    expect(finalState.status).toBe("failed");
  });

  it("soft-timeout keeps a slow phase running (with a warning log) instead of failing it", async () => {
    const phases = [def({ id: "slow", timeouts: timeouts({ softTimeoutMs: 20, hardTimeoutMs: 500, maxRetries: 0, retryDelayMs: 0 }) })];
    const runners: Record<string, PhaseRunner> = {
      slow: () =>
        new Promise<PhaseRunnerResult>((resolve) => {
          setTimeout(() => resolve(ok("finally done")), 100);
        })
    };

    const orchestrator = new BootOrchestrator(phases, runners);
    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const finalState = await runPromise;

    const slow = finalState.phases[0];
    expect(slow.state).toBe("success");
    expect(slow.details.some((entry) => entry.event === "soft-timeout")).toBe(true);
  });

  it("hard-timeout fails a phase whose runner never resolves, exhausting no more than the retry budget", async () => {
    const phases = [def({ id: "hangs", timeouts: timeouts({ softTimeoutMs: 5, hardTimeoutMs: 30, maxRetries: 1, retryDelayMs: 5 }) })];
    const runners: Record<string, PhaseRunner> = {
      hangs: () => new Promise<PhaseRunnerResult>(() => {}) // never resolves
    };

    const orchestrator = new BootOrchestrator(phases, runners);
    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const finalState = await runPromise;

    const hangs = finalState.phases[0];
    expect(hangs.state).toBe("failed");
    expect(hangs.error?.code).toBe("hard-timeout");
  });

  it("an optional phase failing degrades the run instead of failing it; a mandatory failure fails it", async () => {
    // "release" mirrors main-app-released: mandatory, and deliberately does
    // NOT depend on the optional resident-model phase, so resident-model's
    // failure degrades the run instead of blocking (and thus failing) it.
    const degradedPhases = [
      def({ id: "resident-model", optional: true, timeouts: timeouts({ softTimeoutMs: 5, hardTimeoutMs: 20, maxRetries: 0, retryDelayMs: 0 }) }),
      def({ id: "release" })
    ];
    const degraded = new BootOrchestrator(degradedPhases, {
      "resident-model": async () => fail("no model"),
      release: async () => ok()
    });
    const degradedRun = degraded.run();
    await vi.runAllTimersAsync();
    expect((await degradedRun).status).toBe("degraded");

    const mandatoryPhases = [def({ id: "database", optional: false, timeouts: timeouts({ softTimeoutMs: 5, hardTimeoutMs: 20, maxRetries: 0, retryDelayMs: 0 }) })];
    const mandatory = new BootOrchestrator(mandatoryPhases, { database: async () => fail("db down") });
    const mandatoryRun = mandatory.run();
    await vi.runAllTimersAsync();
    expect((await mandatoryRun).status).toBe("failed");
  });

  it("retryPhase() re-runs a failed phase and unblocks its dependents", async () => {
    let shouldFail = true;
    const phases = [
      def({ id: "backend", timeouts: timeouts({ softTimeoutMs: 5, hardTimeoutMs: 20, maxRetries: 0, retryDelayMs: 0 }) }),
      def({ id: "ready", dependencies: ["backend"] })
    ];
    const runners: Record<string, PhaseRunner> = {
      backend: async () => (shouldFail ? fail("down") : ok("up")),
      ready: async () => ok()
    };

    const orchestrator = new BootOrchestrator(phases, runners);
    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const firstResult = await runPromise;
    expect(firstResult.status).toBe("failed");
    expect(firstResult.phases.find((p) => p.id === "ready")!.state).toBe("blocked");

    shouldFail = false;
    await orchestrator.retryPhase("backend");
    await vi.runAllTimersAsync();

    const state = orchestrator.getState();
    expect(state.phases.find((p) => p.id === "backend")!.state).toBe("success");
    expect(state.phases.find((p) => p.id === "ready")!.state).toBe("success");
  });

  it("publishes state changes to subscribers and exposes HUD patches", async () => {
    const phases = [def({ id: "a" })];
    const orchestrator = new BootOrchestrator(phases, { a: async () => ok() });
    const snapshots: string[] = [];
    orchestrator.onStateChange((state) => {
      snapshots.push(state.phases[0]?.state ?? "none");
    });

    orchestrator.patchHud({ backendPid: 1234 });
    expect(orchestrator.getState().backendPid).toBe(1234);

    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    await runPromise;

    expect(snapshots).toContain("success");
  });

  it("never runs more than one phase concurrently, even when several phases are independently runnable", async () => {
    // "a", "b", and "c" share no dependencies, so a scheduler that starts
    // every runnable phase at once (the pre-repair behavior) would run all
    // three concurrently here.
    let active = 0;
    let maxObservedConcurrentPhases = 0;
    const makeRunner = (): PhaseRunner => async () => {
      active += 1;
      maxObservedConcurrentPhases = Math.max(maxObservedConcurrentPhases, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return ok();
    };

    const phases = [def({ id: "a" }), def({ id: "b" }), def({ id: "c" }), def({ id: "release", dependencies: ["a", "b", "c"] })];
    const orchestrator = new BootOrchestrator(phases, {
      a: makeRunner(),
      b: makeRunner(),
      c: makeRunner(),
      release: async () => ok()
    });
    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const finalState = await runPromise;

    expect(maxObservedConcurrentPhases).toBe(1);
    expect(finalState.phases.every((p) => p.state === "success")).toBe(true);
  });

  it("outcome:pending sets state to waiting and increments pollCount, never retryCount", async () => {
    let calls = 0;
    const phases = [
      def({ id: "backend-ready", timeouts: timeouts({ softTimeoutMs: 500, hardTimeoutMs: 1000, pollIntervalMs: 5, maxRetries: 0, retryDelayMs: 0 }) })
    ];
    const observedStatesWhileWaiting: string[] = [];
    const orchestrator = new BootOrchestrator(phases, {
      "backend-ready": async () => {
        calls += 1;
        if (calls < 4) return pending(`not ready yet (${calls})`, calls * 10);
        return ok("ready");
      }
    });
    orchestrator.onStateChange((state) => {
      const phase = state.phases[0];
      if (phase?.state === "waiting") observedStatesWhileWaiting.push(phase.state);
    });

    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const finalState = await runPromise;

    expect(calls).toBe(4);
    expect(observedStatesWhileWaiting.length).toBeGreaterThan(0);
    expect(finalState.phases[0].state).toBe("success");
    expect(finalState.phases[0].pollCount).toBe(3);
    expect(finalState.phases[0].retryCount).toBe(0);
  });

  it("outcome:skipped finalizes the phase as skipped and satisfies dependents", async () => {
    const phases = [def({ id: "resident-model", optional: true }), def({ id: "release", dependencies: ["resident-model"] })];
    const orchestrator = new BootOrchestrator(phases, {
      "resident-model": async () => skip("Autostart deaktiviert."),
      release: async () => ok()
    });

    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const finalState = await runPromise;

    expect(finalState.phases.find((p) => p.id === "resident-model")!.state).toBe("skipped");
    expect(finalState.phases.find((p) => p.id === "release")!.state).toBe("success");
    expect(finalState.status).toBe("ready");
  });

  it("a failed OPTIONAL dependency does not block its dependents (only degrades the run), unlike a failed mandatory one", async () => {
    // Mirrors the real production shape: backend-ready depends on the
    // optional resident-model. A failed resident-model must still let
    // backend-ready (and everything after it) proceed to success -- the
    // splash waits for resident-model to become terminal, then continues
    // regardless of which terminal outcome it reached.
    const phases = [
      def({ id: "resident-model", optional: true, timeouts: timeouts({ softTimeoutMs: 5, hardTimeoutMs: 20, maxRetries: 0, retryDelayMs: 0 }) }),
      def({ id: "release", dependencies: ["resident-model"] })
    ];
    const orchestrator = new BootOrchestrator(phases, {
      "resident-model": async () => fail("no model available"),
      release: async () => ok()
    });

    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const finalState = await runPromise;

    expect(finalState.phases.find((p) => p.id === "resident-model")!.state).toBe("failed");
    expect(finalState.phases.find((p) => p.id === "release")!.state).toBe("success");
    expect(finalState.status).toBe("degraded");
  });

  it("weights overall progress by phase instead of a flat average (heavy phases count far more than trivial ones)", async () => {
    // Real production weights: desktop-process=1, model-index=20. An
    // unlisted id ("release") defaults to weight 1.
    const phases = [
      def({ id: "desktop-process" }),
      def({ id: "model-index", dependencies: ["desktop-process"] }),
      def({ id: "release", dependencies: ["model-index"] })
    ];
    let capturedProgress: number | null = null;
    const orchestrator = new BootOrchestrator(phases, {
      "desktop-process": async () => ok(),
      "model-index": async (ctx) => {
        ctx.reportProgress(10); // heavy phase only 10% done
        capturedProgress = orchestrator.getState().overallProgress;
        return ok();
      },
      release: async () => ok()
    });

    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    await runPromise;

    // desktop-process (weight 1) done=100, model-index (weight 20) at 10%,
    // release (weight 1, still pending) at 0.
    const expected = Math.round((1 * 100 + 20 * 10 + 1 * 0) / (1 + 20 + 1));
    expect(capturedProgress).toBe(expected);
  });
});
