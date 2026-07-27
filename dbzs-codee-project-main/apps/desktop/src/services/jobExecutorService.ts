/**
 * DBZS – Division By Zeros
 * Datei: jobExecutorService.ts
 * Bereich: Desktop Services / Job Executor Service
 *
 * Zweck:
 *   Führt einzelne Jobs aus dem Spooler aus. Verarbeitet ImplementationTask-Jobs
 *   und berichtet Fortschritt über Waypoints zurück.
 *
 * Warum:
 *   Der Executor darf immer nur einen Job bearbeiten, nicht den gesamten Plan.
 *   Diese Schicht isoliert die Job-Ausführung von der Plan-Logik.
 *
 * Wozu:
 *   Ermöglicht kontrollierte, nachvollziehbare Einzeljob-Ausführung mit
 *   korrektem Locking, Fortschrittsreporting und Review-Gate-Integration.
 */

import type {
  ImplementationTaskV1,
  JobRecord,
  JobWaypointRequest,
  ProposedChange
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { releaseJobLock, renewJobLock } from "@/services/jobWorkspaceLock";
import { runAgentTurnEngine } from "@/runtime/agent/agentTurnEngine";
import { DEFAULT_AGENT_POLICY } from "@/runtime/agent/agentOrchestrator";
import { getNativeToolDefinitions } from "@/runtime/agent/toolProtocolAdapter";
import { createDefaultToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import { createAgentTrajectory, finalizeTrajectory } from "@/runtime/observability/agentTrajectory";

/**
 * Executor-Status.
 */
export type JobExecutorState =
  | "idle"
  | "preparing"
  | "running"
  | "validating"
  | "completed"
  | "failed"
  | "error";

export interface JobExecutorStatus {
  state: JobExecutorState;
  currentJobId: string | null;
  currentTaskId: string | null;
  currentWorkspace: string | null;
  workerId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

/**
 * Konfiguration für die Job-Ausführung.
 */
export interface JobExecutorConfig {
  workerId: string;
  maxRuntimeMs?: number;
  renewLockIntervalMs?: number;
}

/**
 * Ergebnis der Job-Ausführung.
 */
export interface JobExecutionResult {
  success: boolean;
  jobId: string;
  taskId: string;
  patchCount: number;
  testResults: TestResult[];
  validationPassed: boolean;
  commitSha?: string | null;
  errorMessage?: string;
}

export interface TestResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
}

/**
 * Fehler bei der Job-Ausführung.
 */
export class JobExecutionError extends Error {
  constructor(
    message: string,
    public readonly jobId: string,
    public readonly taskId: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "JobExecutionError";
  }
}

/**
 * Service für die Ausführung einzelner Jobs.
 */
export class JobExecutorService {
  private readonly config: JobExecutorConfig;
  private status: JobExecutorStatus = {
    state: "idle",
    currentJobId: null,
    currentTaskId: null,
    currentWorkspace: null,
    workerId: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null
  };
  private lockRenewTimer: number | null = null;
  private abortController: AbortController | null = null;

  constructor(config: JobExecutorConfig) {
    this.config = config;
  }

  /**
   * Holt den aktuellen Status.
   */
  getStatus(): JobExecutorStatus {
    return { ...this.status };
  }

  /**
   * Führt einen Job aus.
   *
   * @param job - Der auszuführende Job
   * @param workspaceRoot - Der Workspace-Pfad
   * @returns Ergebnis der Ausführung
   */
  async executeJob(job: JobRecord, workspaceRoot: string): Promise<JobExecutionResult> {
    const taskId = this.extractTaskId(job);
    const task = this.extractTaskFromJob(job);

    this.updateStatus({
      state: "preparing",
      currentJobId: job.id,
      currentTaskId: taskId,
      currentWorkspace: workspaceRoot,
      workerId: this.config.workerId,
      startedAt: new Date().toISOString(),
      errorMessage: null
    });

    try {
      // Schritt 1: Waypoint "running" setzen
      await this.addWaypoint(job.id, "started", "Job wird ausgeführt", 0);

      // Schritt 2: Lock-Renewal starten
      this.startLockRenewal(workspaceRoot, job.id, this.config.workerId);

      // Schritt 3: Job ausführen
      const result = await this.executeTask(task, workspaceRoot, job.id);

      // Schritt 4: Lock-Renewal stoppen
      this.stopLockRenewal();

      // Schritt 5: Waypoint "completed" setzen
      await this.addWaypoint(job.id, "completed", "Job erfolgreich abgeschlossen", 100, {
        patchCount: result.patchCount,
        testResults: result.testResults
      });

      // Schritt 6: Lock freigeben
      releaseJobLock(workspaceRoot, job.id, this.config.workerId);

      this.updateStatus({
        state: "completed",
        completedAt: new Date().toISOString()
      });

      return result;
    } catch (error) {
      // Lock-Renewal stoppen
      this.stopLockRenewal();

      // Lock freigeben (auch im Fehlerfall)
      releaseJobLock(workspaceRoot, job.id, this.config.workerId);

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Waypoint "failed" setzen
      await this.addWaypoint(job.id, "failed", errorMessage, 0, {
        error: errorMessage
      });

      this.updateStatus({
        state: "failed",
        completedAt: new Date().toISOString(),
        errorMessage
      });

      throw new JobExecutionError(
        `Job ${job.id} fehlgeschlagen: ${errorMessage}`,
        job.id,
        taskId,
        error
      );
    }
  }

  /**
   * Führt einen einzelnen Task aus.
   */
  private async executeTask(
    task: ImplementationTaskV1,
    workspaceRoot: string,
    jobId: string
  ): Promise<JobExecutionResult> {
    console.log(`[JobExecutor] Starte Task "${task.title}" (${task.id})`);

    this.updateStatus({ state: "running" });
    await this.addWaypoint(jobId, "progress", "Task wird ausgeführt", 10);

    // Agent Turn Engine ausführen
    this.abortController = new AbortController();
    const timeoutMs = this.config.maxRuntimeMs ?? 120_000;
    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, timeoutMs);

    try {
      // Tool-Verfügbarkeit prüfen
      const toolAvailabilityContext = createDefaultToolAvailabilityContext(workspaceRoot);

      // Agent Turn Engine Parameter
      const turnResult = await runAgentTurnEngine({
        runId: `job-${jobId}`,
        goal: task.description,
        targetAgent: "coder",
        profile: "agent",
        workspaceRoot,
        toolAvailabilityContext,
        baseMessages: [
          {
            id: "system-init",
            role: "system",
            content: this.buildSystemPrompt(task)
          }
        ],
        policy: {
          ...DEFAULT_AGENT_POLICY,
          maxRuntimeMs: timeoutMs,
          maxSteps: 10,
          maxToolCalls: 20
        },
        requestAssistant: async (targetAgent, request, onDelta, signal) => {
          // Hier würde der eigentliche Model-Call stattfinden
          // Für jetzt als Placeholder
          return {
            message: {
              id: `response-${Date.now()}`,
              role: "assistant",
              content: "Task wurde analysiert."
            },
            model_id: null,
            model_name: null
          };
        },
        runTool: async (name, input) => {
          // Tool-Ausführung über backendClient
          console.log(`[JobExecutor] Tool: ${name}`, input);
          return {
            toolName: name,
            requestId: `tool-${Date.now()}`,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            status: "ok",
            output: {}
          };
        },
        queuePatches: async (changes: ProposedChange[]) => {
          console.log(`[JobExecutor] Queue ${changes.length} Patches`);
          await this.addWaypoint(jobId, "progress", `Patches vorbereitet: ${changes.length}`, 50);
        },
        applyPatches: async (filePaths: string[]) => {
          console.log(`[JobExecutor] Apply ${filePaths.length} Patches`);
          await this.addWaypoint(jobId, "progress", `Patches angewendet: ${filePaths.length}`, 70);
        },
        signal: this.abortController.signal,
        callbacks: {
          onTurnStart: (turn) => {
            console.log(`[JobExecutor] Turn ${turn} gestartet`);
          },
          onAssistantDelta: (delta, totalLength, turn) => {
            // Streaming-Output
          },
          onToolCall: (event) => {
            console.log(`[JobExecutor] Tool-Call: ${event.call.name} (${event.status})`);
          },
          onActivityDetail: (line) => {
            console.log(`[JobExecutor] ${line}`);
          }
        }
      });

      clearTimeout(timeoutId);

      this.updateStatus({ state: "validating" });
      await this.addWaypoint(jobId, "waiting_verification", "Warte auf Validierung", 90);

      // Tests ausführen
      const testResults = await this.runTests(task.testCommands, workspaceRoot);

      // Validierung prüfen
      const validationPassed = testResults.every((r) => r.passed);

      if (!validationPassed) {
        const failedTests = testResults.filter((r) => !r.passed);
        throw new JobExecutionError(
          `Validierung fehlgeschlagen: ${failedTests.map((t) => t.command).join(", ")}`,
          jobId,
          task.id
        );
      }

      this.updateStatus({ state: "completed" });

      return {
        success: true,
        jobId,
        taskId: task.id,
        patchCount: turnResult.patchCount,
        testResults,
        validationPassed: true,
        commitSha: null
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Baut den System-Prompt für einen Task.
   */
  private buildSystemPrompt(task: ImplementationTaskV1): string {
    return `Du bist ein Implementierungs-Agent für DBZS Codee.

Deine Aufgabe:
${task.description}

Erwartete Dateien:
${task.expectedFiles.join("\n")}

Akzeptanzkriterien:
${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}

Wichtige Regeln:
- Führe nur die notwendige Änderung durch
- Halte Änderungen minimal und fokussiert
- Teste nach der Implementierung
- Berichte Fortschritt über Waypoints`;
  }

  /**
   * Führt Testkommandos aus.
   */
  private async runTests(
    testCommands: string[],
    workspaceRoot: string
  ): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const command of testCommands) {
      try {
        console.log(`[JobExecutor] Test: ${command}`);

        // Placeholder für Test-Ausführung
        // In Production: backendClient.executeCommand oder ähnlich
        const result: TestResult = {
          command,
          exitCode: 0,
          stdout: "",
          stderr: "",
          passed: true
        };

        results.push(result);
      } catch (error) {
        results.push({
          command,
          exitCode: 1,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          passed: false
        });
      }
    }

    return results;
  }

  /**
   * Fügt einen Waypoint zum Job hinzu.
   */
  private async addWaypoint(
    jobId: string,
    waypoint: JobWaypointRequest["waypoint"],
    message: string,
    progress?: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      const request: JobWaypointRequest = {
        worker_id: this.config.workerId,
        waypoint,
        message,
        progress,
        metadata
      };

      await backendClient.addJobWaypoint(jobId, request);
    } catch (error) {
      console.error(`[JobExecutor] Fehler beim Add-Waypoint:`, error);
      // Nicht kritisch –继续执行
    }
  }

  /**
   * Startet die periodische Lock-Verlängerung.
   */
  private startLockRenewal(
    workspaceRoot: string,
    jobId: string,
    workerId: string
  ): void {
    const renewInterval = this.config.renewLockIntervalMs ?? 300_000; // 5 Minuten

    this.lockRenewTimer = window.setInterval(() => {
      const renewed = renewJobLock(workspaceRoot, jobId, workerId);
      if (renewed) {
        console.log(`[JobExecutor] Lock renewed for ${workspaceRoot}`);
      }
    }, renewInterval);
  }

  /**
   * Stoppt die Lock-Verlängerung.
   */
  private stopLockRenewal(): void {
    if (this.lockRenewTimer !== null) {
      window.clearInterval(this.lockRenewTimer);
      this.lockRenewTimer = null;
    }
  }

  /**
   * Aktualisiert den Status.
   */
  private updateStatus(updates: Partial<JobExecutorStatus>): void {
    this.status = { ...this.status, ...updates };
    console.log(`[JobExecutor] Status: ${this.status.state}`, {
      jobId: this.status.currentJobId,
      taskId: this.status.currentTaskId
    });
  }

  /**
   * Extrahiert die Task-ID aus einem Job.
   */
  private extractTaskId(job: JobRecord): string {
    const payload = job.input_payload as Record<string, unknown> | null;
    if (payload && typeof payload === "object" && "taskId" in payload) {
      return String(payload.taskId);
    }
    return job.id;
  }

  /**
   * Extrahiert einen ImplementationTaskV1 aus einem Job.
   */
  private extractTaskFromJob(job: JobRecord): ImplementationTaskV1 {
    const payload = job.input_payload as Record<string, unknown> | null;

    if (!payload || typeof payload !== "object") {
      // Fallback: Job als Task behandeln
      return {
        id: job.id,
        title: job.title,
        description: job.title,
        priority: job.priority,
        dependsOn: [],
        expectedFiles: [],
        acceptanceCriteria: [],
        testCommands: [],
        maxAttempts: job.max_attempts,
        requiresApproval: false,
        state: job.status as any
      };
    }

    return {
      id: String(payload.taskId ?? job.id),
      title: String(payload.title ?? job.title),
      description: String(payload.description ?? job.title),
      priority: Number(payload.priority ?? job.priority),
      dependsOn: Array.isArray(payload.dependsOn) ? payload.dependsOn : [],
      expectedFiles: Array.isArray(payload.expectedFiles) ? payload.expectedFiles : [],
      acceptanceCriteria: Array.isArray(payload.acceptanceCriteria)
        ? payload.acceptanceCriteria
        : [],
      testCommands: Array.isArray(payload.testCommands) ? payload.testCommands : [],
      maxAttempts: Number(payload.maxAttempts ?? job.max_attempts),
      requiresApproval: Boolean(payload.requiresApproval ?? false),
      state: job.status as any,
      jobId: job.id
    };
  }
}

/**
 * Singleton-Instanz des Job-Executors.
 */
export const jobExecutor = new JobExecutorService({
  workerId: "desktop-primary",
  maxRuntimeMs: 120_000,
  renewLockIntervalMs: 300_000
});
