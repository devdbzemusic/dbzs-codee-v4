import type {
  ExecutionPlan,
  OrchestratorApprovalGate,
  OrchestratorAgentRole,
  PlannerPlan,
  PlannedTaskExecution,
  TaskExecutionStatus
} from "@dbzs/shared";

export interface OrchestratorRunContext {
  hasOpenDiffs?: boolean;
  hasReviewErrors?: boolean;
  hasFailedTests?: boolean;
  applyFailed?: boolean;
  agentCrashed?: boolean;
  requirePlanApproval?: boolean;
  requireApplyApproval?: boolean;
  requireCommitApproval?: boolean;
  requireRestoreApproval?: boolean;
}

export interface OrchestratorResult {
  plan: ExecutionPlan;
  message: string;
}

const TASK_SEQUENCE: OrchestratorAgentRole[] = ["planner", "coder", "tester", "debugger", "reviewer"];
const TERMINAL_STATUSES: TaskExecutionStatus[] = ["completed", "failed", "cancelled"];

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clonePlan(plan: ExecutionPlan): ExecutionPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({ ...task }))
  };
}

function isTerminal(status: TaskExecutionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function queueNextPendingTask(tasks: PlannedTaskExecution[]): boolean {
  const hasActive = tasks.some((task) => task.status === "queued" || task.status === "running" || task.status === "waiting_approval");
  if (hasActive) {
    return false;
  }

  const next = tasks.find((task) => task.status === "pending");
  if (!next) {
    return false;
  }

  next.status = "queued";
  return true;
}

function hasGateApproval(task: PlannedTaskExecution, gate: OrchestratorApprovalGate): boolean {
  return (task.approvedGates ?? []).includes(gate);
}

function markGateApproved(task: PlannedTaskExecution, gate: OrchestratorApprovalGate): void {
  const next = new Set(task.approvedGates ?? []);
  next.add(gate);
  task.approvedGates = [...next];
}

function openApprovalGate(task: PlannedTaskExecution, gate: OrchestratorApprovalGate, message: string): void {
  task.status = "waiting_approval";
  task.awaitingGate = gate;
  task.gateMessage = message;
  task.gateRequestedAt = nowIso();
  task.error = message;
}

function clearApprovalGate(task: PlannedTaskExecution): void {
  task.awaitingGate = undefined;
  task.gateMessage = undefined;
  task.gateRequestedAt = undefined;
}

function markDebuggerSkipped(tasks: PlannedTaskExecution[], fromTask: PlannedTaskExecution): void {
  const testerIndex = tasks.findIndex((task) => task.id === fromTask.id);
  if (testerIndex === -1) {
    return;
  }

  const debuggerTask = tasks
    .slice(testerIndex + 1)
    .find((task) => task.taskId === fromTask.taskId && task.assignedAgent === "debugger" && task.status === "pending");

  if (!debuggerTask) {
    return;
  }

  debuggerTask.status = "cancelled";
  debuggerTask.completedAt = nowIso();
  debuggerTask.error = "Debugger nicht erforderlich, Tests erfolgreich.";
}

function toExecutionTasks(plan: PlannerPlan): PlannedTaskExecution[] {
  const executions: PlannedTaskExecution[] = [];

  for (const task of plan.tasks) {
    for (const agent of TASK_SEQUENCE) {
      executions.push({
        id: createId("exec-task"),
        taskId: task.id,
        assignedAgent: agent,
        status: "pending"
      });
    }
  }

  return executions;
}

export class TaskOrchestratorService {
  private readonly plans = new Map<string, ExecutionPlan>();

  createExecutionPlan(plannerPlan: PlannerPlan): ExecutionPlan {
    const plan: ExecutionPlan = {
      id: createId("exec-plan"),
      plannerPlanId: plannerPlan.id,
      tasks: toExecutionTasks(plannerPlan),
      status: "idle"
    };

    this.plans.set(plan.id, plan);
    return clonePlan(plan);
  }

  startExecution(planId: string, context: OrchestratorRunContext = {}): OrchestratorResult {
    const plan = this.requirePlan(planId);

    if (plan.status === "completed") {
      return { plan: clonePlan(plan), message: "Plan ist bereits abgeschlossen." };
    }

    if (plan.status === "failed") {
      return { plan: clonePlan(plan), message: "Plan ist fehlgeschlagen. Bitte Retry fuer eine Task ausfuehren." };
    }

    plan.status = "running";
    queueNextPendingTask(plan.tasks);

    if (context.requirePlanApproval) {
      const nextTask = plan.tasks.find((task) => task.status === "queued");
      if (nextTask && !hasGateApproval(nextTask, "plan")) {
        openApprovalGate(nextTask, "plan", "Plan-Gate wartet auf Freigabe vor Start der autonomen Ausfuehrung.");
        plan.status = "waiting_approval";
        return { plan: clonePlan(plan), message: "Plan-Gate aktiv. Bitte freigeben oder ablehnen." };
      }
    }

    this.syncPlanCompletion(plan);

    return { plan: clonePlan(plan), message: "Ausfuehrung gestartet." };
  }

  runNextTask(planId: string, context: OrchestratorRunContext = {}): OrchestratorResult {
    const plan = this.requirePlan(planId);

    if (plan.status === "completed") {
      return { plan: clonePlan(plan), message: "Plan ist abgeschlossen." };
    }

    if (plan.status === "failed") {
      return { plan: clonePlan(plan), message: "Plan ist im Failed-Status. Retry erforderlich." };
    }

    if (plan.status === "waiting_approval") {
      return { plan: clonePlan(plan), message: "Approval-Gate offen. Bitte erst freigeben oder ablehnen." };
    }

    const blockers = this.resolveBlockers(context);
    if (blockers.length > 0) {
      const activeTask =
        plan.tasks.find((task) => task.status === "queued" || task.status === "running") ??
        plan.tasks.find((task) => task.status === "pending");
      if (!activeTask) {
        return { plan: clonePlan(plan), message: blockers.join(" ") };
      }

      if (activeTask.status === "pending") {
        activeTask.status = "queued";
      }

      if (context.requireRestoreApproval && !hasGateApproval(activeTask, "restore")) {
        openApprovalGate(activeTask, "restore", "Restore-Gate: Offene Diffs erkannt. Vor Fortsetzung Freigabe erforderlich.");
        plan.status = "waiting_approval";
        return { plan: clonePlan(plan), message: "Restore-Gate aktiv. Bitte freigeben oder ablehnen." };
      }

      plan.status = "waiting_approval";
      activeTask.status = "waiting_approval";
      activeTask.error = blockers.join(" ");
      return { plan: clonePlan(plan), message: blockers.join(" ") };
    }

    queueNextPendingTask(plan.tasks);
    const nextTask = plan.tasks.find((task) => task.status === "queued");

    if (!nextTask) {
      this.syncPlanCompletion(plan);
      const finished = plan.tasks.every((task) => task.status === "completed" || task.status === "cancelled");
      return {
        plan: clonePlan(plan),
        message: finished ? "Keine offenen Queue-Eintraege mehr." : "Keine ausfuehrbare Task gefunden."
      };
    }

    if (nextTask.assignedAgent === "coder" && context.requireApplyApproval && !hasGateApproval(nextTask, "apply")) {
      openApprovalGate(nextTask, "apply", "Apply-Gate: Vor Datei-Apply ist explizite Freigabe erforderlich.");
      plan.status = "waiting_approval";
      return { plan: clonePlan(plan), message: "Apply-Gate aktiv. Bitte freigeben oder ablehnen." };
    }

    if (nextTask.assignedAgent === "reviewer" && context.requireCommitApproval && !hasGateApproval(nextTask, "commit")) {
      openApprovalGate(nextTask, "commit", "Commit-Gate: Vor Commit-Erstellung ist explizite Freigabe erforderlich.");
      plan.status = "waiting_approval";
      return { plan: clonePlan(plan), message: "Commit-Gate aktiv. Bitte freigeben oder ablehnen." };
    }

    nextTask.status = "running";
    nextTask.startedAt = nowIso();

    if (context.agentCrashed) {
      return this.failTask(plan, nextTask, "Agent-Ausfuehrung ist abgestuerzt.");
    }

    if (nextTask.assignedAgent === "coder" && context.applyFailed) {
      return this.failTask(plan, nextTask, "Apply-Schritt fehlgeschlagen.");
    }

    if (nextTask.assignedAgent === "tester" && context.hasFailedTests) {
      return this.failTask(plan, nextTask, "Tests fehlgeschlagen.");
    }

    if (nextTask.assignedAgent === "reviewer" && context.hasReviewErrors) {
      nextTask.status = "waiting_approval";
      nextTask.error = "Review meldet Errors. Approval erforderlich.";
      plan.status = "waiting_approval";
      return { plan: clonePlan(plan), message: "Review Errors erkannt. Queue pausiert." };
    }

    nextTask.status = "completed";
    nextTask.completedAt = nowIso();
    nextTask.error = undefined;

    if (nextTask.assignedAgent === "tester") {
      markDebuggerSkipped(plan.tasks, nextTask);
    }

    queueNextPendingTask(plan.tasks);
    this.syncPlanCompletion(plan);

    return {
      plan: clonePlan(plan),
      message: `Task ${nextTask.id} (${nextTask.assignedAgent}) abgeschlossen.`
    };
  }

  cancelExecution(planId: string): ExecutionPlan {
    const plan = this.requirePlan(planId);

    for (const task of plan.tasks) {
      if (task.status === "pending" || task.status === "queued" || task.status === "running" || task.status === "waiting_approval") {
        task.status = "cancelled";
        task.completedAt = nowIso();
        if (!task.error) {
          task.error = "Ausfuehrung wurde manuell abgebrochen.";
        }
      }
    }

    plan.status = "idle";
    return clonePlan(plan);
  }

  retryTask(taskId: string): OrchestratorResult {
    const plan = [...this.plans.values()].find((entry) => entry.tasks.some((task) => task.id === taskId));
    if (!plan) {
      throw new Error(`Execution task ${taskId} wurde nicht gefunden.`);
    }

    const index = plan.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      throw new Error(`Execution task ${taskId} wurde nicht gefunden.`);
    }

    const target = plan.tasks[index];
    if (target.status !== "failed" && target.status !== "waiting_approval" && target.status !== "cancelled") {
      return { plan: clonePlan(plan), message: "Retry nur fuer failed/waiting_approval/cancelled moeglich." };
    }

    for (let position = index; position < plan.tasks.length; position += 1) {
      const task = plan.tasks[position];
      if (!isTerminal(task.status) && task.status !== "waiting_approval") {
        continue;
      }

      task.status = "pending";
      clearApprovalGate(task);
      task.startedAt = undefined;
      task.completedAt = undefined;
      task.error = undefined;
      task.approvedGates = [];
    }

    target.status = "queued";
    plan.status = "running";

    return { plan: clonePlan(plan), message: `Retry vorbereitet fuer Task ${target.id}.` };
  }

  getExecutionStatus(planId: string): ExecutionPlan | null {
    const plan = this.plans.get(planId);
    return plan ? clonePlan(plan) : null;
  }

  approveCurrentGate(planId: string): OrchestratorResult {
    const plan = this.requirePlan(planId);
    const waitingTask = plan.tasks.find((task) => task.status === "waiting_approval");
    if (!waitingTask || !waitingTask.awaitingGate) {
      return { plan: clonePlan(plan), message: "Kein offenes Approval-Gate vorhanden." };
    }

    const gate = waitingTask.awaitingGate;
    markGateApproved(waitingTask, gate);
    clearApprovalGate(waitingTask);
    waitingTask.status = "queued";
    waitingTask.error = undefined;
    plan.status = "running";
    this.syncPlanCompletion(plan);

    return {
      plan: clonePlan(plan),
      message: `Gate ${gate} freigegeben.`
    };
  }

  rejectCurrentGate(planId: string, reason?: string): OrchestratorResult {
    const plan = this.requirePlan(planId);
    const waitingTask = plan.tasks.find((task) => task.status === "waiting_approval");
    if (!waitingTask || !waitingTask.awaitingGate) {
      return { plan: clonePlan(plan), message: "Kein offenes Approval-Gate vorhanden." };
    }

    const gate = waitingTask.awaitingGate;
    clearApprovalGate(waitingTask);
    waitingTask.status = "failed";
    waitingTask.completedAt = nowIso();
    waitingTask.error = reason?.trim() || `Gate ${gate} wurde abgelehnt.`;
    plan.status = "failed";

    return {
      plan: clonePlan(plan),
      message: `Gate ${gate} wurde abgelehnt. Plan auf failed gesetzt.`
    };
  }

  private failTask(plan: ExecutionPlan, task: PlannedTaskExecution, message: string): OrchestratorResult {
    task.status = "failed";
    task.error = message;
    task.completedAt = nowIso();
    plan.status = "failed";
    return { plan: clonePlan(plan), message };
  }

  private requirePlan(planId: string): ExecutionPlan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`ExecutionPlan ${planId} wurde nicht gefunden.`);
    }

    return plan;
  }

  private syncPlanCompletion(plan: ExecutionPlan): void {
    const hasFailed = plan.tasks.some((task) => task.status === "failed");
    if (hasFailed) {
      plan.status = "failed";
      return;
    }

    const hasActive = plan.tasks.some((task) => task.status === "queued" || task.status === "running" || task.status === "waiting_approval");
    if (hasActive) {
      if (plan.status !== "waiting_approval") {
        plan.status = "running";
      }
      return;
    }

    const hasPending = plan.tasks.some((task) => task.status === "pending");
    if (!hasPending) {
      plan.status = "completed";
      return;
    }

    if (plan.status !== "waiting_approval") {
      plan.status = "running";
    }
  }

  private resolveBlockers(context: OrchestratorRunContext): string[] {
    const blockers: string[] = [];

    if (context.hasOpenDiffs) {
      blockers.push("Offene Diffs vorhanden. Queue pausiert bis zur Freigabe.");
    }

    if (context.hasReviewErrors) {
      blockers.push("Review Errors erkannt. Queue pausiert bis zur Korrektur.");
    }

    return blockers;
  }
}
