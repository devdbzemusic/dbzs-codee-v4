import { describe, expect, it } from "vitest";
import type { PlannerPlan } from "@dbzs/shared";
import { TaskOrchestratorService } from "./taskOrchestratorService";

function createPlannerPlan(taskCount = 2): PlannerPlan {
  return {
    id: "planner-plan-1",
    goal: "Implementiere orchestrierte Agenten-Ausfuehrung",
    summary: "Plan summary",
    tasks: Array.from({ length: taskCount }, (_, index) => ({
      id: `planner-task-${index + 1}`,
      title: `Task ${index + 1}`,
      description: `Beschreibung ${index + 1}`,
      affectedFiles: ["apps/desktop/src/App.tsx"],
      priority: "high",
      estimatedComplexity: "medium",
      dependencies: index === 0 ? [] : [`planner-task-${index}`]
    })),
    risks: [],
    assumptions: [],
    affectedAreas: ["Renderer UI"],
    createdAt: new Date().toISOString()
  };
}

describe("TaskOrchestratorService", () => {
  it("wandelt Planner-Plan in Queue-Plan", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(1));

    expect(executionPlan.status).toBe("idle");
    expect(executionPlan.tasks).toHaveLength(5);
    expect(executionPlan.tasks.every((task) => task.status === "pending")).toBe(true);

    const started = service.startExecution(executionPlan.id).plan;
    expect(started.status).toBe("running");
    expect(started.tasks.filter((task) => task.status === "queued")).toHaveLength(1);
  });

  it("fuehrt Tasks sequentiell aus", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(2));

    service.startExecution(executionPlan.id);
    const step1 = service.runNextTask(executionPlan.id).plan;
    expect(step1.tasks.some((task) => task.status === "running")).toBe(false);

    service.runNextTask(executionPlan.id); // coder task 1
    service.runNextTask(executionPlan.id); // tester task 1 (skip debugger)
    service.runNextTask(executionPlan.id); // reviewer task 1

    const afterFirstTask = service.getExecutionStatus(executionPlan.id);
    expect(afterFirstTask).not.toBeNull();
    const firstTaskPipeline = afterFirstTask?.tasks.filter((task) => task.taskId === "planner-task-1") ?? [];
    expect(firstTaskPipeline.some((task) => task.status === "completed")).toBe(true);

    const secondTaskPlanner = afterFirstTask?.tasks.find(
      (task) => task.taskId === "planner-task-2" && task.assignedAgent === "planner"
    );
    expect(secondTaskPlanner?.status === "queued" || secondTaskPlanner?.status === "completed").toBe(true);
  });

  it("stoppt bei waiting_approval", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(1));

    service.startExecution(executionPlan.id);
    service.runNextTask(executionPlan.id); // planner complete, coder queued

    const blocked = service.runNextTask(executionPlan.id, { hasOpenDiffs: true }).plan;
    expect(blocked.status).toBe("waiting_approval");
    expect(blocked.tasks.some((task) => task.status === "waiting_approval")).toBe(true);
  });

  it("stoppt bei failed", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(1));

    service.startExecution(executionPlan.id);
    service.runNextTask(executionPlan.id); // planner
    service.runNextTask(executionPlan.id); // coder

    const failed = service.runNextTask(executionPlan.id, { hasFailedTests: true }).plan;
    expect(failed.status).toBe("failed");
    expect(failed.tasks.some((task) => task.status === "failed")).toBe(true);
  });

  it("retry setzt failed task wieder in queue", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(1));

    service.startExecution(executionPlan.id);
    service.runNextTask(executionPlan.id); // planner
    service.runNextTask(executionPlan.id); // coder
    const failed = service.runNextTask(executionPlan.id, { hasFailedTests: true }).plan;

    const failedTask = failed.tasks.find((task) => task.status === "failed");
    expect(failedTask).toBeDefined();

    const retried = service.retryTask(failedTask?.id ?? "").plan;
    expect(retried.status).toBe("running");
    const target = retried.tasks.find((task) => task.id === failedTask?.id);
    expect(target?.status).toBe("queued");
    expect(target?.error).toBeUndefined();
  });

  it("cancel markiert offene tasks als cancelled", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(2));

    service.startExecution(executionPlan.id);
    const cancelled = service.cancelExecution(executionPlan.id);

    expect(cancelled.status).toBe("idle");
    expect(
      cancelled.tasks.every((task) => task.status === "cancelled" || task.status === "completed")
    ).toBe(true);
  });

  it("wartet am Plan-Gate bis zur Freigabe", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(1));

    const started = service.startExecution(executionPlan.id, { requirePlanApproval: true }).plan;
    expect(started.status).toBe("waiting_approval");
    const waiting = started.tasks.find((task) => task.status === "waiting_approval");
    expect(waiting?.awaitingGate).toBe("plan");

    const approved = service.approveCurrentGate(executionPlan.id).plan;
    expect(approved.status === "running" || approved.status === "completed").toBe(true);

    const progressed = service.runNextTask(executionPlan.id).plan;
    expect(progressed.tasks.some((task) => task.assignedAgent === "planner" && task.status === "completed")).toBe(true);
  });

  it("setzt Apply-Gate fuer coder task", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(1));

    service.startExecution(executionPlan.id);
    service.runNextTask(executionPlan.id); // planner -> completed, coder queued

    const gated = service.runNextTask(executionPlan.id, { requireApplyApproval: true }).plan;
    const waiting = gated.tasks.find((task) => task.status === "waiting_approval");
    expect(gated.status).toBe("waiting_approval");
    expect(waiting?.assignedAgent).toBe("coder");
    expect(waiting?.awaitingGate).toBe("apply");

    service.approveCurrentGate(executionPlan.id);
    const afterApprove = service.runNextTask(executionPlan.id).plan;
    expect(afterApprove.tasks.some((task) => task.assignedAgent === "coder" && task.status === "completed")).toBe(true);
  });

  it("setzt Commit-Gate fuer reviewer task", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(1));

    service.startExecution(executionPlan.id);
    service.runNextTask(executionPlan.id); // planner
    service.runNextTask(executionPlan.id); // coder
    service.runNextTask(executionPlan.id); // tester -> debugger skipped, reviewer queued

    const gated = service.runNextTask(executionPlan.id, { requireCommitApproval: true }).plan;
    const waiting = gated.tasks.find((task) => task.status === "waiting_approval");
    expect(waiting?.assignedAgent).toBe("reviewer");
    expect(waiting?.awaitingGate).toBe("commit");

    service.approveCurrentGate(executionPlan.id);
    const afterApprove = service.runNextTask(executionPlan.id).plan;
    expect(afterApprove.tasks.some((task) => task.assignedAgent === "reviewer" && task.status === "completed")).toBe(true);
  });

  it("setzt Restore-Gate bei offenen Diffs", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(1));

    service.startExecution(executionPlan.id);
    const gated = service.runNextTask(executionPlan.id, { hasOpenDiffs: true, requireRestoreApproval: true }).plan;

    expect(gated.status).toBe("waiting_approval");
    const waiting = gated.tasks.find((task) => task.status === "waiting_approval");
    expect(waiting?.awaitingGate).toBe("restore");
  });

  it("kann offenes Gate ablehnen und setzt Plan auf failed", () => {
    const service = new TaskOrchestratorService();
    const executionPlan = service.createExecutionPlan(createPlannerPlan(1));

    service.startExecution(executionPlan.id, { requirePlanApproval: true });
    const rejected = service.rejectCurrentGate(executionPlan.id, "Nicht freigegeben").plan;

    expect(rejected.status).toBe("failed");
    expect(rejected.tasks.some((task) => task.status === "failed" && task.error?.includes("Nicht freigegeben"))).toBe(true);
  });
});
