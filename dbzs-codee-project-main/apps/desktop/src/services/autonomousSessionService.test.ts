import { describe, expect, it, vi } from "vitest";
import type { AutonomousSessionDependencies } from "./autonomousSessionService";
import { AutonomousSessionService } from "./autonomousSessionService";

interface HarnessOptions {
  failTests?: boolean;
  reviewError?: boolean;
  reviewHighRisk?: boolean;
  duplicateFingerprint?: boolean;
  settings?: {
    maxAgentRuntimeSeconds?: number;
    maxAutonomousSteps?: number;
    maxDebugRetries?: number;
    maxFailedTaskRetries?: number;
    safeMode?: boolean;
    localOnly?: boolean;
  };
}

function createHarness(options: HarnessOptions = {}) {
  const queueByExecution = new Map<string, string[]>();

  const deps: AutonomousSessionDependencies = {
    getSettings: () => ({
      maxAgentRuntimeSeconds: options.settings?.maxAgentRuntimeSeconds ?? 3600,
      maxAutonomousSteps: options.settings?.maxAutonomousSteps ?? 20,
      maxDebugRetries: options.settings?.maxDebugRetries ?? 2,
      maxFailedTaskRetries: options.settings?.maxFailedTaskRetries ?? 1,
      safeMode: options.settings?.safeMode ?? true,
      localOnly: options.settings?.localOnly ?? true
    }),
    createRestorePoint: vi.fn(async () => "rp-1"),
    createPlannerPlan: vi.fn(async (goal: string) => ({
      id: "plan-1",
      goal,
      summary: "summary",
      tasks: [
        {
          id: "task-1",
          title: "Task",
          description: "Task desc",
          affectedFiles: ["apps/desktop/src/App.tsx"],
          priority: "high" as const,
          estimatedComplexity: "medium" as const,
          dependencies: []
        }
      ],
      risks: [],
      assumptions: [],
      affectedAreas: ["Renderer UI"],
      createdAt: new Date().toISOString()
    })),
    createExecutionPlan: vi.fn(async () => {
      queueByExecution.set("exec-1", ["task-1"]);
      return {
        id: "exec-1",
        plannerPlanId: "plan-1",
        tasks: [],
        status: "running" as const
      };
    }),
    nextTask: vi.fn(async (executionPlanId: string) => {
      const queue = queueByExecution.get(executionPlanId) ?? [];
      const next = queue.shift() ?? null;
      queueByExecution.set(executionPlanId, queue);
      if (!next) {
        return { taskId: null, state: "completed" as const };
      }
      return { taskId: next, state: "task" as const };
    }),
    createCoderProposedChange: vi.fn(async () => ({
      changeId: "change-1",
      fingerprint: options.duplicateFingerprint ? "dup-fp" : `fp-${Date.now()}`
    })),
    applyProposedChange: vi.fn(async (changeId: string) => ({ appliedChangeId: `applied-${changeId}` })),
    runTests: vi.fn(async () => {
      const result = options.failTests
        ? { runId: "test-1", success: false, reason: "tests failed" }
        : { runId: "test-1", success: true };
      return result;
    }),
    runDebug: vi.fn(async () => ({
      analysisId: "debug-1",
      proposedChangeId: "change-debug-1",
      fingerprint: "fp-debug-1"
    })),
    runReview: vi.fn(async () => {
      const result = {
        reportId: "review-1",
        hasErrors: options.reviewError ?? false,
        highRisk: options.reviewHighRisk ?? false
      };
      return result;
    })
  };

  return {
    deps,
    service: new AutonomousSessionService(deps)
  };
}

describe("AutonomousSessionService", () => {
  it("Session Start erzeugt Restore Point", async () => {
    const { service, deps } = createHarness();

    const session = await service.startSession("Implement autonomous flow", "D:/repo");

    expect(session.restorePointIds).toEqual(["rp-1"]);
    expect(deps.createRestorePoint).toHaveBeenCalledTimes(1);
  });

  it("Planner wird aufgerufen", async () => {
    const { service, deps } = createHarness();

    await service.startSession("Goal", "D:/repo");

    expect(deps.createPlannerPlan).toHaveBeenCalledTimes(1);
  });

  it("Queue wird erstellt", async () => {
    const { service } = createHarness();

    const session = await service.startSession("Goal", "D:/repo");

    expect(session.executionPlanId).toBe("exec-1");
  });

  it("Diff Gate pausiert Session", async () => {
    const { service } = createHarness();
    const started = await service.startSession("Goal", "D:/repo");

    const session = await service.runNextSessionStep(started.id);
    const gates = service.listSessionGates(started.id);

    expect(session.status).toBe("waiting_approval");
    expect(gates.some((gate) => gate.type === "diff" && gate.status === "pending")).toBe(true);
  });

  it("Approval setzt Session fort", async () => {
    const { service } = createHarness();
    const started = await service.startSession("Goal", "D:/repo");
    await service.runNextSessionStep(started.id);
    const diffGate = service.listSessionGates(started.id).find((gate) => gate.type === "diff" && gate.status === "pending");
    expect(diffGate).toBeDefined();

    const session = await service.approveGate(diffGate?.id ?? "");

    expect(session.status).toBe("running");
    expect(session.appliedChangeIds).toContain("applied-change-1");
  });

  it("Reject stoppt oder ueberspringt Task", async () => {
    const { service } = createHarness();
    const started = await service.startSession("Goal", "D:/repo");
    await service.runNextSessionStep(started.id);
    const diffGate = service.listSessionGates(started.id).find((gate) => gate.type === "diff" && gate.status === "pending");
    expect(diffGate).toBeDefined();

    const rejected = service.rejectGate(diffGate?.id ?? "");

    expect(rejected.status).toBe("running");
  });

  it("Test Failure erzeugt Debug Flow", async () => {
    const { service } = createHarness({ failTests: true });
    const started = await service.startSession("Goal", "D:/repo");

    await service.runNextSessionStep(started.id); // diff gate
    const diffGate = service.listSessionGates(started.id).find((gate) => gate.type === "diff" && gate.status === "pending");
    await service.approveGate(diffGate?.id ?? "");

    await service.runNextSessionStep(started.id); // test run -> test_failure gate
    const failureGate = service.listSessionGates(started.id).find((gate) => gate.type === "test_failure" && gate.status === "pending");
    expect(failureGate).toBeDefined();

    await service.approveGate(failureGate?.id ?? "");
    const afterDebugRun = await service.runNextSessionStep(started.id);

    expect(afterDebugRun.debugAnalysisIds).toContain("debug-1");
    expect(service.listSessionGates(started.id).some((gate) => gate.type === "diff" && gate.status === "pending")).toBe(true);
  });

  it("Review Error erzeugt Gate", async () => {
    const { service } = createHarness({ reviewError: true });
    const started = await service.startSession("Goal", "D:/repo");

    await service.runNextSessionStep(started.id);
    const diffGate = service.listSessionGates(started.id).find((gate) => gate.type === "diff" && gate.status === "pending");
    await service.approveGate(diffGate?.id ?? "");

    await service.runNextSessionStep(started.id); // testing ok -> reviewing
    await service.runNextSessionStep(started.id); // review gate

    const gates = service.listSessionGates(started.id);
    expect(gates.some((gate) => gate.type === "review_error" && gate.status === "pending")).toBe(true);
  });

  it("Cancel stoppt Session", async () => {
    const { service } = createHarness();
    const started = await service.startSession("Goal", "D:/repo");

    const cancelled = service.cancelSession(started.id);

    expect(cancelled.status).toBe("cancelled");
  });

  it("maxAutonomousSteps stoppt Session", async () => {
    const { service } = createHarness({ settings: { maxAutonomousSteps: 1 } });
    const started = await service.startSession("Goal", "D:/repo");

    await service.runNextSessionStep(started.id); // step 1
    const diffGate = service.listSessionGates(started.id).find((gate) => gate.type === "diff" && gate.status === "pending");
    await service.approveGate(diffGate?.id ?? "");
    const failed = await service.runNextSessionStep(started.id); // step 2 => fail

    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("maxAutonomousSteps");
  });

  it("maxDebugRetries stoppt Debug Loop", async () => {
    const { service } = createHarness({
      failTests: true,
      settings: {
        maxDebugRetries: 0
      }
    });
    const started = await service.startSession("Goal", "D:/repo");

    await service.runNextSessionStep(started.id); // diff
    const diffGate = service.listSessionGates(started.id).find((gate) => gate.type === "diff" && gate.status === "pending");
    await service.approveGate(diffGate?.id ?? "");

    await service.runNextSessionStep(started.id); // tests fail gate
    const failGate = service.listSessionGates(started.id).find((gate) => gate.type === "test_failure" && gate.status === "pending");
    await service.approveGate(failGate?.id ?? "");

    const failed = await service.runNextSessionStep(started.id); // debugging blocked

    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("maxDebugRetries");
  });

  it("safeMode/localOnly deaktiviert erzeugt High-Risk Gate", async () => {
    const { service } = createHarness({
      settings: {
        safeMode: false,
        localOnly: false
      }
    });
    const started = await service.startSession("Goal", "D:/repo");

    const next = await service.runNextSessionStep(started.id);
    const gates = service.listSessionGates(started.id);

    expect(next.status).toBe("waiting_approval");
    expect(gates.some((gate) => gate.type === "high_risk" && gate.status === "pending")).toBe(true);
  });
});
