import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootOrchestrator, type PhaseRunner, type PhaseRunnerResult } from "./bootOrchestrator.js";
import type { BootPhaseDefinition } from "./bootPhaseDefinitions.js";

function def(partial: Partial<BootPhaseDefinition> & { id: string }): BootPhaseDefinition {
  return {
    label: partial.id,
    dependencies: [],
    optional: false,
    timeouts: { softTimeoutMs: 50, hardTimeoutMs: 200, retryCount: 0, retryDelayMs: 10 },
    ...partial
  };
}

function ok(message = "ok"): PhaseRunnerResult {
  return { outcome: "success", message };
}

function fail(message = "fail"): PhaseRunnerResult {
  return { outcome: "failed", message, error: { code: "test", message, retryAttempts: 0 } };
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
    const phases = [def({ id: "backend", timeouts: { softTimeoutMs: 50, hardTimeoutMs: 500, retryCount: 5, retryDelayMs: 20 } })];
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
      def({ id: "spawn", timeouts: { softTimeoutMs: 10, hardTimeoutMs: 50, retryCount: 1, retryDelayMs: 5 } }),
      def({ id: "alive", dependencies: ["spawn"] }),
      def({ id: "unrelated" })
    ];
    const runners: Record<string, PhaseRunner> = {
      spawn: async () => fail("ENOENT"),
      alive: async () => ok(),
      unrelated: async () => ok()
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
    const phases = [def({ id: "slow", timeouts: { softTimeoutMs: 20, hardTimeoutMs: 500, retryCount: 0, retryDelayMs: 0 } })];
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
    const phases = [def({ id: "hangs", timeouts: { softTimeoutMs: 5, hardTimeoutMs: 30, retryCount: 1, retryDelayMs: 5 } })];
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
    const degradedPhases = [def({ id: "resident-model", optional: true, timeouts: { softTimeoutMs: 5, hardTimeoutMs: 20, retryCount: 0, retryDelayMs: 0 } })];
    const degraded = new BootOrchestrator(degradedPhases, { "resident-model": async () => fail("no model") });
    const degradedRun = degraded.run();
    await vi.runAllTimersAsync();
    expect((await degradedRun).status).toBe("degraded");

    const mandatoryPhases = [def({ id: "database", optional: false, timeouts: { softTimeoutMs: 5, hardTimeoutMs: 20, retryCount: 0, retryDelayMs: 0 } })];
    const mandatory = new BootOrchestrator(mandatoryPhases, { database: async () => fail("db down") });
    const mandatoryRun = mandatory.run();
    await vi.runAllTimersAsync();
    expect((await mandatoryRun).status).toBe("failed");
  });

  it("retryPhase() re-runs a failed phase and unblocks its dependents", async () => {
    let shouldFail = true;
    const phases = [
      def({ id: "backend", timeouts: { softTimeoutMs: 5, hardTimeoutMs: 20, retryCount: 0, retryDelayMs: 0 } }),
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
});
