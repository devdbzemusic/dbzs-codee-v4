import type {
  ApprovalGate,
  ApprovalGateType,
  AutonomousSession,
  AutonomousSessionStatus,
  ExecutionPlan,
  PlannerPlan
} from "@dbzs/shared";
import { DEFAULT_SETTINGS } from "@dbzs/shared";

interface NextTaskResult {
  taskId: string | null;
  state: "task" | "completed" | "failed";
  error?: string;
}

interface CoderChangeResult {
  changeId: string;
  fingerprint: string;
}

interface TestRunResult {
  runId: string;
  success: boolean;
  reason?: string;
}

interface DebugRunResult {
  analysisId: string;
  proposedChangeId: string;
  fingerprint: string;
}

interface ReviewRunResult {
  reportId: string;
  hasErrors: boolean;
  highRisk?: boolean;
}

interface GateEffect {
  kind: "apply_change" | "allow_debug" | "continue";
  changeId?: string;
  nextPhase?: SessionPhase;
}

interface SessionTimelineEvent {
  id: string;
  sessionId: string;
  title: string;
  description: string;
  createdAt: string;
}

type SessionPhase =
  | "task_fetch"
  | "await_diff"
  | "testing"
  | "await_test_failure"
  | "debugging"
  | "await_debug_diff"
  | "reviewing"
  | "await_review_error"
  | "done";

interface SessionRuntimeState {
  phase: SessionPhase;
  workspaceRoot: string;
  plannerPlan?: PlannerPlan;
  executionPlan?: ExecutionPlan;
  lastChangeFingerprint?: string;
  seenChangeFingerprints: Set<string>;
  debugRetriesByTask: Map<string, number>;
  failedTaskRetriesByTask: Map<string, number>;
  stepCount: number;
  paused: boolean;
  safetyGateCleared: boolean;
  lastErrorSignature?: string;
  repeatedErrorCount: number;
}

interface AutonomousSessionLimits {
  maxAgentRuntimeSeconds: number;
  maxAutonomousSteps: number;
  maxDebugRetries: number;
  maxFailedTaskRetries: number;
  safeMode: boolean;
  localOnly: boolean;
}

export interface AutonomousSessionDependencies {
  getSettings: () => AutonomousSessionLimits;
  createRestorePoint: (workspaceRoot: string, reason: "before_agent_run", label: string) => Promise<string>;
  createPlannerPlan: (goal: string, workspaceRoot: string) => Promise<PlannerPlan>;
  createExecutionPlan: (plan: PlannerPlan) => Promise<ExecutionPlan>;
  nextTask: (executionPlanId: string) => Promise<NextTaskResult>;
  createCoderProposedChange: (sessionId: string, taskId: string) => Promise<CoderChangeResult>;
  applyProposedChange: (changeId: string) => Promise<{ appliedChangeId: string }>;
  runTests: (sessionId: string, taskId: string) => Promise<TestRunResult>;
  runDebug: (sessionId: string, taskId: string) => Promise<DebugRunResult>;
  runReview: (sessionId: string, taskId: string) => Promise<ReviewRunResult>;
}

interface InMemoryData {
  sessions: Map<string, AutonomousSession>;
  gates: Map<string, ApprovalGate>;
  runtime: Map<string, SessionRuntimeState>;
  gateEffects: Map<string, GateEffect>;
  timeline: Map<string, SessionTimelineEvent[]>;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function createDefaultDependencies(): AutonomousSessionDependencies {
  const queueByExecutionPlan = new Map<string, string[]>();

  return {
    getSettings: () => ({
      maxAgentRuntimeSeconds: DEFAULT_SETTINGS.maxAgentRuntimeSeconds,
      maxAutonomousSteps: DEFAULT_SETTINGS.maxAutonomousSteps,
      maxDebugRetries: DEFAULT_SETTINGS.maxDebugRetries,
      maxFailedTaskRetries: DEFAULT_SETTINGS.maxFailedTaskRetries,
      safeMode: DEFAULT_SETTINGS.safeMode,
      localOnly: DEFAULT_SETTINGS.localOnly
    }),
    createRestorePoint: async () => createId("rp"),
    createPlannerPlan: async (goal) => ({
      id: createId("plan"),
      goal,
      summary: `Plan fuer ${goal}`,
      tasks: [
        {
          id: createId("task"),
          title: "Implementierung",
          description: "Autonomous v0 task",
          affectedFiles: [],
          priority: "high",
          estimatedComplexity: "medium",
          dependencies: []
        }
      ],
      risks: [],
      assumptions: [],
      affectedAreas: ["Workspace Core"],
      createdAt: nowIso()
    }),
    createExecutionPlan: async (plan) => {
      const executionPlanId = createId("exec");
      queueByExecutionPlan.set(executionPlanId, plan.tasks.map((task) => task.id));
      return {
        id: executionPlanId,
        plannerPlanId: plan.id,
        tasks: [],
        status: "running"
      };
    },
    nextTask: async (executionPlanId) => {
      const queue = queueByExecutionPlan.get(executionPlanId) ?? [];
      const next = queue.shift() ?? null;
      queueByExecutionPlan.set(executionPlanId, queue);
      if (!next) {
        return { taskId: null, state: "completed" };
      }
      return { taskId: next, state: "task" };
    },
    createCoderProposedChange: async () => ({
      changeId: createId("change"),
      fingerprint: createId("fp")
    }),
    applyProposedChange: async (changeId) => ({ appliedChangeId: changeId }),
    runTests: async () => ({ runId: createId("test"), success: true }),
    runDebug: async () => ({
      analysisId: createId("debug"),
      proposedChangeId: createId("change"),
      fingerprint: createId("fp")
    }),
    runReview: async () => ({ reportId: createId("review"), hasErrors: false })
  };
}

export class AutonomousSessionService {
  private readonly deps: AutonomousSessionDependencies;

  private readonly data: InMemoryData = {
    sessions: new Map(),
    gates: new Map(),
    runtime: new Map(),
    gateEffects: new Map(),
    timeline: new Map()
  };

  constructor(dependencies: Partial<AutonomousSessionDependencies> = {}) {
    this.deps = {
      ...createDefaultDependencies(),
      ...dependencies
    };
  }

  async startSession(goal: string, workspaceRoot: string): Promise<AutonomousSession> {
    const normalizedGoal = goal.trim();
    const normalizedRoot = normalizePath(workspaceRoot);
    if (!normalizedGoal) {
      throw new Error("Session goal darf nicht leer sein.");
    }
    if (!normalizedRoot) {
      throw new Error("Workspace root fehlt.");
    }

    const sessionId = createId("session");
    const baseSession: AutonomousSession = {
      id: sessionId,
      goal: normalizedGoal,
      status: "planning",
      pendingApprovalIds: [],
      appliedChangeIds: [],
      testRunIds: [],
      debugAnalysisIds: [],
      reviewReportIds: [],
      restorePointIds: [],
      startedAt: nowIso()
    };

    const runtime: SessionRuntimeState = {
      phase: "task_fetch",
      workspaceRoot: normalizedRoot,
      seenChangeFingerprints: new Set(),
      debugRetriesByTask: new Map(),
      failedTaskRetriesByTask: new Map(),
      stepCount: 0,
      paused: false,
      safetyGateCleared: false,
      repeatedErrorCount: 0
    };

    this.data.sessions.set(sessionId, baseSession);
    this.data.runtime.set(sessionId, runtime);
    this.data.timeline.set(sessionId, []);

    this.addTimeline(sessionId, "Session gestartet", `Goal: ${normalizedGoal}`);

    try {
      const restorePointId = await this.deps.createRestorePoint(
        normalizedRoot,
        "before_agent_run",
        `Autonomous Session start: ${normalizedGoal}`
      );
      this.patchSession(sessionId, (session) => {
        session.restorePointIds = [...session.restorePointIds, restorePointId];
      });
      this.addTimeline(sessionId, "Restore Point erstellt", restorePointId);

      const plannerPlan = await this.deps.createPlannerPlan(normalizedGoal, normalizedRoot);
      const executionPlan = await this.deps.createExecutionPlan(plannerPlan);
      runtime.plannerPlan = plannerPlan;
      runtime.executionPlan = executionPlan;

      this.patchSession(sessionId, (session) => {
        session.plannerPlanId = plannerPlan.id;
        session.executionPlanId = executionPlan.id;
        session.status = "running";
      });
      this.addTimeline(sessionId, "Plan erstellt", plannerPlan.id);
      this.addTimeline(sessionId, "Queue erstellt", executionPlan.id);

      return this.requireSession(sessionId);
    } catch (error) {
      this.failSession(sessionId, error instanceof Error ? error.message : "Session start fehlgeschlagen.");
      return this.requireSession(sessionId);
    }
  }

  pauseSession(sessionId: string): AutonomousSession {
    const runtime = this.requireRuntime(sessionId);
    const session = this.requireSession(sessionId);
    if (this.isTerminalStatus(session.status)) {
      return session;
    }

    runtime.paused = true;
    this.patchSession(sessionId, (next) => {
      next.status = "idle";
    });
    this.addTimeline(sessionId, "Session pausiert", "Warten auf Resume.");
    return this.requireSession(sessionId);
  }

  resumeSession(sessionId: string): AutonomousSession {
    const runtime = this.requireRuntime(sessionId);
    const session = this.requireSession(sessionId);
    if (this.isTerminalStatus(session.status)) {
      return session;
    }

    runtime.paused = false;
    this.patchSession(sessionId, (next) => {
      if (next.pendingApprovalIds.length > 0) {
        next.status = "waiting_approval";
      } else {
        next.status = "running";
      }
    });
    this.addTimeline(sessionId, "Session fortgesetzt", "Autonomous flow laeuft weiter.");
    return this.requireSession(sessionId);
  }

  cancelSession(sessionId: string): AutonomousSession {
    const session = this.requireSession(sessionId);
    if (this.isTerminalStatus(session.status)) {
      return session;
    }

    this.patchSession(sessionId, (next) => {
      next.status = "cancelled";
      next.finishedAt = nowIso();
    });
    this.addTimeline(sessionId, "Session abgebrochen", "Cancel wurde angefordert.");
    return this.requireSession(sessionId);
  }

  getSessionStatus(sessionId: string): AutonomousSession {
    return this.requireSession(sessionId);
  }

  listSessionGates(sessionId: string): ApprovalGate[] {
    this.requireSession(sessionId);
    return [...this.data.gates.values()]
      .filter((gate) => gate.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listSessionTimeline(sessionId: string): SessionTimelineEvent[] {
    this.requireSession(sessionId);
    return [...(this.data.timeline.get(sessionId) ?? [])];
  }

  async approveGate(gateId: string): Promise<AutonomousSession> {
    const gate = this.requireGate(gateId);
    if (gate.status !== "pending") {
      return this.requireSession(gate.sessionId);
    }

    gate.status = "approved";
    const effect = this.data.gateEffects.get(gateId);
    const sessionId = gate.sessionId;

    this.patchSession(sessionId, (session) => {
      session.pendingApprovalIds = session.pendingApprovalIds.filter((id) => id !== gate.id);
      session.status = session.pendingApprovalIds.length > 0 ? "waiting_approval" : "running";
    });

    if (effect?.kind === "apply_change" && effect.changeId) {
      const result = await this.deps.applyProposedChange(effect.changeId);
      this.patchSession(sessionId, (session) => {
        session.appliedChangeIds = [...session.appliedChangeIds, result.appliedChangeId];
      });
      const runtime = this.requireRuntime(sessionId);
      runtime.phase = effect.nextPhase ?? "testing";
    } else if (effect?.kind === "allow_debug") {
      const runtime = this.requireRuntime(sessionId);
      runtime.phase = effect.nextPhase ?? "debugging";
    } else if (effect?.kind === "continue") {
      const runtime = this.requireRuntime(sessionId);
      runtime.phase = effect.nextPhase ?? "task_fetch";
    }

    this.addTimeline(sessionId, "Approval freigegeben", `${gate.type}: ${gate.title}`);
    return this.requireSession(sessionId);
  }

  rejectGate(gateId: string): AutonomousSession {
    const gate = this.requireGate(gateId);
    if (gate.status !== "pending") {
      return this.requireSession(gate.sessionId);
    }

    gate.status = "rejected";
    const sessionId = gate.sessionId;

    this.patchSession(sessionId, (session) => {
      session.pendingApprovalIds = session.pendingApprovalIds.filter((id) => id !== gate.id);
    });

    const runtime = this.requireRuntime(sessionId);
    if (gate.type === "review_error" || gate.type === "high_risk") {
      this.failSession(sessionId, `${gate.type} gate wurde abgelehnt.`);
      this.addTimeline(sessionId, "Approval abgelehnt", `${gate.type}: Session gestoppt.`);
      return this.requireSession(sessionId);
    }

    runtime.phase = "task_fetch";
    this.patchSession(sessionId, (session) => {
      session.status = "running";
    });
    this.addTimeline(sessionId, "Approval abgelehnt", `${gate.type}: Task wird uebersprungen.`);
    return this.requireSession(sessionId);
  }

  async runNextSessionStep(sessionId: string): Promise<AutonomousSession> {
    const session = this.requireSession(sessionId);
    const runtime = this.requireRuntime(sessionId);
    if (this.isTerminalStatus(session.status) || runtime.paused) {
      return session;
    }
    if (session.pendingApprovalIds.length > 0 || session.status === "waiting_approval") {
      return session;
    }

    const settings = this.deps.getSettings();
    const now = Date.now();
    const started = new Date(session.startedAt).getTime();
    if (Number.isFinite(started) && now - started > settings.maxAgentRuntimeSeconds * 1000) {
      this.failSession(sessionId, "Session timeout erreicht.");
      return this.requireSession(sessionId);
    }

    runtime.stepCount += 1;
    if (runtime.stepCount > settings.maxAutonomousSteps) {
      this.failSession(sessionId, "maxAutonomousSteps erreicht.");
      return this.requireSession(sessionId);
    }

    try {
      if (!runtime.safetyGateCleared && (!settings.safeMode || !settings.localOnly)) {
        const restrictions = [
          settings.safeMode ? null : "safeMode deaktiviert",
          settings.localOnly ? null : "localOnly deaktiviert"
        ].filter(Boolean).join(" und ");
        runtime.safetyGateCleared = true;
        this.createGate(
          sessionId,
          "high_risk",
          "Session Safety Gate",
          `Erhoehtes Risiko erkannt (${restrictions}). Explizite Freigabe erforderlich.`,
          [sessionId],
          {
            kind: "continue",
            nextPhase: runtime.phase
          }
        );
        return this.requireSession(sessionId);
      }

      if (runtime.phase === "done") {
        this.completeSession(sessionId);
        return this.requireSession(sessionId);
      }

      if (!runtime.executionPlan) {
        this.failSession(sessionId, "Execution Plan fehlt.");
        return this.requireSession(sessionId);
      }

      if (runtime.phase === "task_fetch") {
        const next = await this.deps.nextTask(runtime.executionPlan.id);
        if (next.state === "completed") {
          runtime.phase = "done";
          this.completeSession(sessionId);
          this.addTimeline(sessionId, "Session Summary", "Alle Queue-Tasks abgeschlossen.");
          return this.requireSession(sessionId);
        }
        if (next.state === "failed") {
          const taskKey = next.taskId ?? "unknown";
          const retries = (runtime.failedTaskRetriesByTask.get(taskKey) ?? 0) + 1;
          runtime.failedTaskRetriesByTask.set(taskKey, retries);
          if (retries > settings.maxFailedTaskRetries) {
            this.failSession(sessionId, "maxFailedTaskRetries erreicht.");
            return this.requireSession(sessionId);
          }
          this.raiseRepeatError(runtime, next.error ?? "task_failed", sessionId);
          return this.requireSession(sessionId);
        }

        const taskId = next.taskId;
        if (!taskId) {
          this.failSession(sessionId, "Queue lieferte keine Task-ID.");
          return this.requireSession(sessionId);
        }

        this.patchSession(sessionId, (mutable) => {
          mutable.currentTaskId = taskId;
          mutable.status = "running";
        });

        const change = await this.deps.createCoderProposedChange(sessionId, taskId);
        if (runtime.seenChangeFingerprints.has(change.fingerprint)) {
          this.failSession(sessionId, "Identischer ProposedChange erkannt.");
          return this.requireSession(sessionId);
        }

        runtime.seenChangeFingerprints.add(change.fingerprint);
        runtime.lastChangeFingerprint = change.fingerprint;
        runtime.phase = "await_diff";
        this.addTimeline(sessionId, "Aenderung vorgeschlagen", change.changeId);
        this.createGate(
          sessionId,
          "diff",
          "Diff Approval erforderlich",
          "Coder hat einen ProposedChange erzeugt. Vor Apply ist Freigabe erforderlich.",
          [change.changeId],
          {
            kind: "apply_change",
            changeId: change.changeId,
            nextPhase: "testing"
          }
        );
        return this.requireSession(sessionId);
      }

      if (runtime.phase === "testing") {
        const taskId = this.requireSession(sessionId).currentTaskId;
        if (!taskId) {
          this.failSession(sessionId, "Task-Kontext fehlt fuer Tests.");
          return this.requireSession(sessionId);
        }

        this.patchSession(sessionId, (mutable) => {
          mutable.status = "testing";
        });
        const testResult = await this.deps.runTests(sessionId, taskId);
        this.patchSession(sessionId, (mutable) => {
          mutable.testRunIds = [...mutable.testRunIds, testResult.runId];
        });
        this.addTimeline(sessionId, "Tests gelaufen", `${testResult.runId} (${testResult.success ? "ok" : "failed"})`);

        if (!testResult.success) {
          runtime.phase = "await_test_failure";
          this.createGate(
            sessionId,
            "test_failure",
            "Test Failure Approval",
            testResult.reason ?? "Tests sind fehlgeschlagen. Debug Flow startet erst nach Approval.",
            [testResult.runId],
            {
              kind: "allow_debug",
              nextPhase: "debugging"
            }
          );
          return this.requireSession(sessionId);
        }

        runtime.phase = "reviewing";
        this.patchSession(sessionId, (mutable) => {
          mutable.status = "running";
        });
        return this.requireSession(sessionId);
      }

      if (runtime.phase === "debugging") {
        const taskId = this.requireSession(sessionId).currentTaskId;
        if (!taskId) {
          this.failSession(sessionId, "Task-Kontext fehlt fuer Debugging.");
          return this.requireSession(sessionId);
        }

        const retries = (runtime.debugRetriesByTask.get(taskId) ?? 0) + 1;
        runtime.debugRetriesByTask.set(taskId, retries);
        if (retries > settings.maxDebugRetries) {
          this.failSession(sessionId, "maxDebugRetries erreicht.");
          return this.requireSession(sessionId);
        }

        this.patchSession(sessionId, (mutable) => {
          mutable.status = "debugging";
        });
        const debug = await this.deps.runDebug(sessionId, taskId);
        this.patchSession(sessionId, (mutable) => {
          mutable.debugAnalysisIds = [...mutable.debugAnalysisIds, debug.analysisId];
        });
        this.addTimeline(sessionId, "Debug Analyse", debug.analysisId);

        if (runtime.seenChangeFingerprints.has(debug.fingerprint)) {
          this.failSession(sessionId, "Identischer ProposedChange im Debug-Flow erkannt.");
          return this.requireSession(sessionId);
        }

        runtime.seenChangeFingerprints.add(debug.fingerprint);
        runtime.phase = "await_debug_diff";
        this.createGate(
          sessionId,
          "diff",
          "Debug Diff Approval erforderlich",
          "Debug-Agent hat einen Fix-Vorschlag erzeugt. Vor Apply ist Freigabe erforderlich.",
          [debug.proposedChangeId, debug.analysisId],
          {
            kind: "apply_change",
            changeId: debug.proposedChangeId,
            nextPhase: "reviewing"
          }
        );
        return this.requireSession(sessionId);
      }

      if (runtime.phase === "reviewing") {
        const taskId = this.requireSession(sessionId).currentTaskId;
        if (!taskId) {
          this.failSession(sessionId, "Task-Kontext fehlt fuer Review.");
          return this.requireSession(sessionId);
        }

        this.patchSession(sessionId, (mutable) => {
          mutable.status = "reviewing";
        });
        const review = await this.deps.runReview(sessionId, taskId);
        this.patchSession(sessionId, (mutable) => {
          mutable.reviewReportIds = [...mutable.reviewReportIds, review.reportId];
        });
        this.addTimeline(sessionId, "Review Report", review.reportId);

        if (review.highRisk) {
          runtime.phase = "await_review_error";
          this.createGate(
            sessionId,
            "high_risk",
            "High Risk Approval",
            "Review stuft die Aenderung als high risk ein. Explizite Freigabe erforderlich.",
            [review.reportId],
            {
              kind: "continue",
              nextPhase: "task_fetch"
            }
          );
          return this.requireSession(sessionId);
        }

        if (review.hasErrors) {
          runtime.phase = "await_review_error";
          this.createGate(
            sessionId,
            "review_error",
            "Review Error Approval",
            "Review enthält Error-Findings. Entscheidung erforderlich.",
            [review.reportId],
            {
              kind: "continue",
              nextPhase: "task_fetch"
            }
          );
          return this.requireSession(sessionId);
        }

        runtime.phase = "task_fetch";
        this.patchSession(sessionId, (mutable) => {
          mutable.status = "running";
        });
        return this.requireSession(sessionId);
      }

      return this.requireSession(sessionId);
    } catch (error) {
      this.raiseRepeatError(runtime, error instanceof Error ? error.message : "unknown_error", sessionId);
      return this.requireSession(sessionId);
    }
  }

  private createGate(
    sessionId: string,
    type: ApprovalGateType,
    title: string,
    description: string,
    relatedIds: string[],
    effect: GateEffect
  ): ApprovalGate {
    const gate: ApprovalGate = {
      id: createId("gate"),
      sessionId,
      type,
      title,
      description,
      relatedIds,
      status: "pending",
      createdAt: nowIso()
    };

    this.data.gates.set(gate.id, gate);
    this.data.gateEffects.set(gate.id, effect);
    this.patchSession(sessionId, (session) => {
      session.pendingApprovalIds = [...session.pendingApprovalIds, gate.id];
      session.status = "waiting_approval";
    });
    this.addTimeline(sessionId, "Approval Gate", `${type}: ${title}`);
    return gate;
  }

  private completeSession(sessionId: string): void {
    this.patchSession(sessionId, (session) => {
      session.status = "completed";
      session.finishedAt = nowIso();
      session.currentTaskId = undefined;
    });
  }

  private failSession(sessionId: string, message: string): void {
    this.patchSession(sessionId, (session) => {
      session.status = "failed";
      session.error = message;
      session.finishedAt = nowIso();
    });
    this.addTimeline(sessionId, "Session fehlgeschlagen", message);
  }

  private raiseRepeatError(runtime: SessionRuntimeState, errorSignature: string, sessionId: string): void {
    if (runtime.lastErrorSignature === errorSignature) {
      runtime.repeatedErrorCount += 1;
    } else {
      runtime.lastErrorSignature = errorSignature;
      runtime.repeatedErrorCount = 1;
    }

    if (runtime.repeatedErrorCount >= 2) {
      this.failSession(sessionId, `Wiederholter Fehler erkannt: ${errorSignature}`);
      return;
    }

    this.failSession(sessionId, errorSignature);
  }

  private addTimeline(sessionId: string, title: string, description: string): void {
    const timeline = this.data.timeline.get(sessionId) ?? [];
    timeline.push({
      id: createId("tl"),
      sessionId,
      title,
      description,
      createdAt: nowIso()
    });
    this.data.timeline.set(sessionId, timeline);
  }

  private patchSession(sessionId: string, mutate: (session: AutonomousSession) => void): void {
    const current = this.requireSession(sessionId);
    const next: AutonomousSession = {
      ...current,
      pendingApprovalIds: [...current.pendingApprovalIds],
      appliedChangeIds: [...current.appliedChangeIds],
      testRunIds: [...current.testRunIds],
      debugAnalysisIds: [...current.debugAnalysisIds],
      reviewReportIds: [...current.reviewReportIds],
      restorePointIds: [...current.restorePointIds]
    };
    mutate(next);
    this.data.sessions.set(sessionId, next);
  }

  private requireSession(sessionId: string): AutonomousSession {
    const session = this.data.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} wurde nicht gefunden.`);
    }

    return session;
  }

  private requireRuntime(sessionId: string): SessionRuntimeState {
    const runtime = this.data.runtime.get(sessionId);
    if (!runtime) {
      throw new Error(`Runtime fuer Session ${sessionId} fehlt.`);
    }

    return runtime;
  }

  private requireGate(gateId: string): ApprovalGate {
    const gate = this.data.gates.get(gateId);
    if (!gate) {
      throw new Error(`Gate ${gateId} wurde nicht gefunden.`);
    }

    return gate;
  }

  private isTerminalStatus(status: AutonomousSessionStatus): boolean {
    return status === "completed" || status === "failed" || status === "cancelled";
  }
}
