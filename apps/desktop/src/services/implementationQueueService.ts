/**
 * DBZS – Division By Zeros
 * Datei: implementationQueueService.ts
 * Bereich: Desktop Services / Implementation Queue Service
 *
 * Zweck:
 *   Wandelt ImplementationPlanV1 Tasks in Jobs für den Job-Spooler um.
 *   Verwaltet die Queue und berücksichtigt Abhängigkeiten.
 *
 * Warum:
 *   Der Chat-Assistent darf nicht direkt Jobs erzeugen. Diese Schicht
 *   validiert, transformiert und queued Tasks kontrolliert.
 *
 * Wozu:
 *   Ermöglicht die nahtlose Integration von ImplementationPlans in den
 *   bestehenden Job-Spooler mit korrekter Reihenfolge und Dependency-Handling.
 */

import type {
  ImplementationPlanV1,
  ImplementationTaskV1,
  ImplementationTaskState,
  JobEnqueueRequest,
  JobRecord
} from "@dbzs/shared";
import { topologicalSortTasks } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

/**
 * Queue-Fehler beim Enqueuen eines Plans.
 */
export class QueueError extends Error {
  constructor(
    message: string,
    public readonly planId?: string,
    public readonly taskId?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "QueueError";
  }
}

/**
 * Ergebnis des Enqueue-Vorgangs.
 */
export interface EnqueuePlanResult {
  planId: string;
  queuedTasks: QueuedTaskInfo[];
  failedTasks: FailedTaskInfo[];
  totalQueued: number;
  totalFailed: number;
}

export interface QueuedTaskInfo {
  taskId: string;
  jobId: string;
  title: string;
  priority: number;
}

export interface FailedTaskInfo {
  taskId: string;
  title: string;
  error: string;
}

/**
 * Interne Repräsentation eines Tasks im Queue-Manager.
 */
interface QueuedTask {
  task: ImplementationTaskV1;
  jobId: string | null;
  state: ImplementationTaskState;
}

/**
 * Queue-Manager für einen einzelnen Plan.
 */
export class ImplementationQueueManager {
  private readonly plan: ImplementationPlanV1;
  private readonly taskMap: Map<string, QueuedTask>;
  private isLocked: boolean = false;

  constructor(plan: ImplementationPlanV1) {
    this.plan = plan;
    this.taskMap = new Map(
      plan.tasks.map((t) => [
        t.id,
        { task: t, jobId: null, state: t.state ?? "proposed" }
      ])
    );
  }

  /**
   * Holt den Plan.
   */
  getPlan(): ImplementationPlanV1 {
    return this.plan;
  }

  /**
   * Holt alle Tasks mit ihrem aktuellen Queue-Status.
   */
  getTasks(): ImplementationTaskV1[] {
    return Array.from(this.taskMap.values()).map((qt) => ({
      ...qt.task,
      state: qt.state,
      jobId: qt.jobId
    }));
  }

  /**
   * Prüft, ob ein Task bereit zur Ausführung ist.
   */
  isTaskReady(taskId: string): boolean {
    const qt = this.taskMap.get(taskId);
    if (!qt) return false;

    // Task muss im richtigen Status sein
    const canRunWithoutApproval = qt.state === "proposed" && !qt.task.requiresApproval;
    if (!canRunWithoutApproval && qt.state !== "approved" && qt.state !== "queued" && qt.state !== "ready") {
      return false;
    }

    // Alle Abhängigkeiten müssen "done" sein
    for (const depId of qt.task.dependsOn) {
      const depQt = this.taskMap.get(depId);
      if (!depQt || depQt.state !== "done") {
        return false;
      }
    }

    return true;
  }

  /**
   * Holt die IDs der Tasks, die bereit zur Ausführung sind.
   */
  getReadyTaskIds(): string[] {
    const ready: string[] = [];
    for (const qt of this.taskMap.values()) {
      if (
        (
          qt.state === "approved" ||
          qt.state === "queued" ||
          qt.state === "ready" ||
          (qt.state === "proposed" && !qt.task.requiresApproval)
        ) &&
        qt.task.dependsOn.every((depId) => {
          const depQt = this.taskMap.get(depId);
          return depQt && depQt.state === "done";
        })
      ) {
        ready.push(qt.task.id);
      }
    }
    return ready;
  }

  /**
   * Aktualisiert den Status eines Tasks.
   */
  updateTaskState(taskId: string, state: ImplementationTaskState): void {
    const qt = this.taskMap.get(taskId);
    if (!qt) {
      throw new QueueError(`Task "${taskId}" nicht gefunden`, this.plan.id, taskId);
    }
    qt.state = state;
  }

  /**
   * Setzt die Job-ID für einen Task.
   */
  setJobId(taskId: string, jobId: string | null): void {
    const qt = this.taskMap.get(taskId);
    if (!qt) {
      throw new QueueError(`Task "${taskId}" nicht gefunden`, this.plan.id, taskId);
    }
    qt.jobId = jobId;
  }

  /**
   * Sperrt die Queue für exklusive Bearbeitung.
   */
  acquireLock(): boolean {
    if (this.isLocked) {
      return false;
    }
    this.isLocked = true;
    return true;
  }

  /**
   * Gibt die Queue frei.
   */
  releaseLock(): void {
    this.isLocked = false;
  }
}

/**
 * Wandelt einen ImplementationTaskV1 in einen JobEnqueueRequest um.
 *
 * @param task - Der Task
 * @param planId - Die Plan-ID für Metadaten
 * @returns JobEnqueueRequest für den Spooler
 */
export function taskToJobRequest(
  task: ImplementationTaskV1,
  planId: string
): JobEnqueueRequest {
  return {
    title: task.title,
    task_type: "implementation_task",
    priority: task.priority,
    assigned_agent_role: "coder",
    input_payload: {
      planId,
      taskId: task.id,
      description: task.description,
      expectedFiles: task.expectedFiles,
      acceptanceCriteria: task.acceptanceCriteria,
      testCommands: task.testCommands,
      requiresApproval: task.requiresApproval
    },
    max_attempts: task.maxAttempts
  };
}

/**
 * Enqueued alle Tasks eines Plans in den Job-Spooler.
 *
 * Tasks werden in topologischer Reihenfolge gequeued (Abhängigkeiten zuerst).
 *
 * @param plan - Der zu enqueuende Plan
 * @returns Ergebnis mit gequeued Tasks und Fehlern
 */
export async function enqueueImplementationPlan(
  plan: ImplementationPlanV1
): Promise<EnqueuePlanResult> {
  const queuedTasks: QueuedTaskInfo[] = [];
  const failedTasks: FailedTaskInfo[] = [];

  // Topologisch sortieren (Abhängigkeiten zuerst)
  const sortedTasks = topologicalSortTasks(plan.tasks);

  for (const task of sortedTasks) {
    try {
      const jobRequest = taskToJobRequest(task, plan.id);

      const job: JobRecord = await backendClient.enqueueJob(jobRequest);

      // Task-Status aktualisieren
      task.state = "queued";
      task.jobId = job.id;

      queuedTasks.push({
        taskId: task.id,
        jobId: job.id,
        title: task.title,
        priority: task.priority
      });
    } catch (error) {
      failedTasks.push({
        taskId: task.id,
        title: task.title,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    planId: plan.id,
    queuedTasks,
    failedTasks,
    totalQueued: queuedTasks.length,
    totalFailed: failedTasks.length
  };
}

/**
 * Holt den nächsten ausführbaren Task aus der Queue.
 *
 * @param manager - Der Queue-Manager
 * @returns Der nächste Task oder null wenn keiner bereit ist
 */
export function getNextExecutableTask(
  manager: ImplementationQueueManager
): ImplementationTaskV1 | null {
  const readyIds = manager.getReadyTaskIds();
  if (readyIds.length === 0) {
    return null;
  }

  // Höchste Priorität zuerst
  const tasks = manager.getTasks();
  const readyTasks = tasks.filter((t) => readyIds.includes(t.id));
  readyTasks.sort((a, b) => b.priority - a.priority);

  return readyTasks[0];
}

/**
 * Aktualisiert den Status eines Tasks nach Job-Abschluss.
 *
 * @param manager - Der Queue-Manager
 * @param taskId - Die Task-ID
 * @param newStatus - Der neue Status
 * @param jobId - Die Job-ID (zur Validierung)
 */
export function updateTaskAfterJobCompletion(
  manager: ImplementationQueueManager,
  taskId: string,
  newStatus: ImplementationTaskState,
  jobId: string
): void {
  const tasks = manager.getTasks();
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    throw new QueueError(`Task "${taskId}" nicht gefunden`, manager.getPlan().id, taskId);
  }

  if (task.jobId !== jobId) {
    throw new QueueError(
      `Job-ID Mismatch für Task "${taskId}"`,
      manager.getPlan().id,
      taskId
    );
  }

  manager.updateTaskState(taskId, newStatus);
}

/**
 * Prüft, ob alle Tasks eines Plans abgeschlossen sind.
 *
 * @param manager - Der Queue-Manager
 * @returns true wenn alle Tasks "done" sind
 */
export function isPlanComplete(manager: ImplementationQueueManager): boolean {
  const tasks = manager.getTasks();
  return tasks.every((t) => t.state === "done");
}

/**
 * Prüft, ob ein Plan fehlgeschlagen ist.
 *
 * @param manager - Der Queue-Manager
 * @returns true wenn mindestens ein Task "failed" ist
 */
export function isPlanFailed(manager: ImplementationQueueManager): boolean {
  const tasks = manager.getTasks();
  return tasks.some((t) => t.state === "failed");
}

/**
 * Berechnet den Gesamtstatus eines Plans basierend auf Task-States.
 *
 * @param manager - Der Queue-Manager
 * @returns Der berechnete Plan-Status
 */
export function calculatePlanStatusFromQueue(
  manager: ImplementationQueueManager
): "draft" | "in_progress" | "blocked" | "completed" | "failed" | "cancelled" {
  const tasks = manager.getTasks();

  if (tasks.length === 0) {
    return "draft";
  }

  const states = tasks.map((t) => t.state ?? "proposed");

  if (states.some((s) => s === "failed")) {
    return "failed";
  }

  if (states.some((s) => s === "cancelled")) {
    return "cancelled";
  }

  if (states.every((s) => s === "done")) {
    return "completed";
  }

  if (states.some((s) => s === "running" || s === "validating")) {
    return "in_progress";
  }

  // Prüfen ob Tasks blockiert sind (nicht ready aber waiting)
  const hasBlocked = tasks.some(
    (t) =>
      (t.state === "approved" || t.state === "queued" || t.state === "ready") &&
      !t.dependsOn.every((depId) => {
        const depTask = tasks.find((dt) => dt.id === depId);
        return depTask && depTask.state === "done";
      })
  );

  if (hasBlocked) {
    return "blocked";
  }

  return "in_progress";
}
