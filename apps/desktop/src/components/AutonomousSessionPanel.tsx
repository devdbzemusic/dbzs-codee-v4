import type {
  ApprovalGate,
  AutonomousSession,
  CommandRunStatus,
  PlannerPlan,
  ProposedChange,
  WorkspaceProjectFile
} from "@dbzs/shared";
import { useEffect, useRef, useState } from "react";
import { PlannerAgentService, createPlannerWorkspaceContext } from "@/services/plannerAgentService";
import { ReviewAgentService } from "@/services/reviewAgentService";
import { AutonomousSessionService } from "@/services/autonomousSessionService";
import { agentRunService } from "@/services/agentRunService";
import { useSettingsStore } from "@/stores/settingsStore";

interface AutonomousSessionPanelProps {
  workspaceRoot: string | null;
  workspaceName: string | null;
  workspaceFiles: WorkspaceProjectFile[];
  plannerPlan: PlannerPlan | null;
  pendingChanges: ProposedChange[];
  appliedChanges: ProposedChange[];
  latestTestRun: CommandRunStatus | null;
}

interface QueueState {
  tasks: string[];
  cursor: number;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function hasFailedRun(run: CommandRunStatus | null): boolean {
  if (!run) {
    return false;
  }
  if (run.status === "failed") {
    return true;
  }
  return typeof run.exitCode === "number" && run.exitCode > 0;
}

export function AutonomousSessionPanel({
  workspaceRoot,
  workspaceName,
  workspaceFiles,
  plannerPlan,
  pendingChanges,
  appliedChanges,
  latestTestRun
}: AutonomousSessionPanelProps) {
  const [goal, setGoal] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<AutonomousSession | null>(null);
  const [gates, setGates] = useState<ApprovalGate[]>([]);
  const [timeline, setTimeline] = useState<Array<{ id: string; title: string; description: string; createdAt: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  // Cache LLM responses between createCoderProposedChange and applyProposedChange
  const pendingLlmChanges = useRef<Map<string, { content: string; taskId: string }>>(new Map());

  // Stable refs for props that change — let callbacks always read the latest value
  // without needing to recreate the service.
  const workspaceRootRef = useRef(workspaceRoot);
  const workspaceNameRef = useRef(workspaceName);
  const workspaceFilesRef = useRef(workspaceFiles);
  const plannerPlanRef = useRef(plannerPlan);
  const appliedChangesRef = useRef(appliedChanges);
  const latestTestRunRef = useRef(latestTestRun);
  useEffect(() => { workspaceRootRef.current = workspaceRoot; }, [workspaceRoot]);
  useEffect(() => { workspaceNameRef.current = workspaceName; }, [workspaceName]);
  useEffect(() => { workspaceFilesRef.current = workspaceFiles; }, [workspaceFiles]);
  useEffect(() => { plannerPlanRef.current = plannerPlan; }, [plannerPlan]);
  useEffect(() => { appliedChangesRef.current = appliedChanges; }, [appliedChanges]);
  useEffect(() => { latestTestRunRef.current = latestTestRun; }, [latestTestRun]);

  // Service is created once and never recreated — all callbacks read from refs.
  const serviceRef = useRef<AutonomousSessionService | null>(null);
  if (!serviceRef.current) {
    const queues = new Map<string, QueueState>();
    const plannerService = new PlannerAgentService();
    const reviewService = new ReviewAgentService();

    serviceRef.current = new AutonomousSessionService({
      getSettings: () => {
        const s = useSettingsStore.getState().settings;
        return {
          maxAgentRuntimeSeconds: s.maxAgentRuntimeSeconds,
          maxAutonomousSteps: s.maxAutonomousSteps,
          maxDebugRetries: s.maxDebugRetries,
          maxFailedTaskRetries: s.maxFailedTaskRetries,
          safeMode: s.safeMode,
          localOnly: s.localOnly
        };
      },
      createRestorePoint: async (rootPath, reason, label) => {
        if (!window.dbzs.createRestorePoint) {
          return createId("rp");
        }

        const targetFiles = workspaceFilesRef.current.slice(0, 4).map((file) => file.path);
        if (targetFiles.length === 0) {
          return createId("rp");
        }

        const point = await window.dbzs.createRestorePoint(rootPath, targetFiles, reason, label);
        return point.id;
      },
      createPlannerPlan: async (sessionGoal, rootPath) => {
        if (plannerPlanRef.current) {
          return plannerPlanRef.current;
        }

        const context = createPlannerWorkspaceContext(
          rootPath,
          workspaceNameRef.current ?? "Workspace",
          workspaceFilesRef.current.map((file) => file.relativePath),
          workspaceFilesRef.current.slice(0, 6).map((file) => ({
            path: file.path,
            relativePath: file.relativePath,
            language: file.language,
            content: ""
          })),
          []
        );

        return plannerService.createPlan(sessionGoal, context);
      },
      createExecutionPlan: async (plan) => {
        const executionPlanId = createId("exec");
        queues.set(executionPlanId, {
          tasks: plan.tasks.map((task) => task.id),
          cursor: 0
        });

        return {
          id: executionPlanId,
          plannerPlanId: plan.id,
          tasks: [],
          status: "running"
        };
      },
      nextTask: async (executionPlanId) => {
        const queue = queues.get(executionPlanId);
        if (!queue) {
          return {
            taskId: null,
            state: "failed",
            error: "Execution queue nicht gefunden."
          } as const;
        }

        if (queue.cursor >= queue.tasks.length) {
          return {
            taskId: null,
            state: "completed"
          } as const;
        }

        const taskId = queue.tasks[queue.cursor] ?? null;
        queue.cursor += 1;
        return {
          taskId,
          state: "task"
        } as const;
      },
      createCoderProposedChange: async (_sessionId, taskId) => {
        const changeId = `coder-${taskId}-${Date.now().toString(36)}`;
        const task = plannerPlanRef.current?.tasks.find((t) => t.id === taskId);
        const taskDesc = task
          ? `Task: ${task.title}\n${task.description}\nBetroffene Dateien: ${task.affectedFiles.join(", ") || "keine Angabe"}`
          : `Task-ID: ${taskId}`;
        const root = workspaceRootRef.current;
        const rootHint = root ? `\nWorkspace-Root: ${root}` : "";
        const prompt = `Du bist ein Code-Agent. Implementiere den folgenden Task und antworte NUR mit validem JSON im Format:\n{"changes":[{"filePath":"<absoluter-pfad>","proposedContent":"<vollstaendiger-dateiinhalt>","reason":"<grund>"}]}\n\n${taskDesc}${rootHint}`;

        try {
          const response = await agentRunService.sendChat("coder", {
            messages: [{ id: `msg-${Date.now().toString(36)}-auto`, role: "user", content: prompt }],
            file_context: null
          });
          const content = response.message.content;
          pendingLlmChanges.current.set(changeId, { content, taskId });
          return { changeId, fingerprint: `fp-${content.slice(0, 32).replace(/\s/g, "")}` };
        } catch {
          const stub = `{"changes":[]}`;
          pendingLlmChanges.current.set(changeId, { content: stub, taskId });
          return { changeId, fingerprint: `fp-err-${changeId}` };
        }
      },
      applyProposedChange: async (changeId) => {
        const cached = pendingLlmChanges.current.get(changeId);
        pendingLlmChanges.current.delete(changeId);
        const blockedMessage =
          "Auto-Apply ist deaktiviert. Bitte Patches im Agent Workbench prüfen und freigeben.";
        console.warn("[AutonomousSession] applyProposedChange blocked:", blockedMessage, {
          changeId,
          hadCachedContent: Boolean(cached)
        });
        throw new Error(blockedMessage);
      },
      runTests: async () => ({
        runId: `test-${Date.now().toString(36)}`,
        success: !hasFailedRun(latestTestRunRef.current),
        reason: hasFailedRun(latestTestRunRef.current) ? "Letzter Teststatus ist failed." : undefined
      }),
      runDebug: async (_sessionId, taskId) => ({
        analysisId: `debug-${taskId}-${Date.now().toString(36)}`,
        proposedChangeId: `debug-change-${taskId}-${Date.now().toString(36)}`,
        fingerprint: `debug-fp-${taskId}-${Date.now().toString(36)}`
      }),
      runReview: async () => {
        const report = reviewService.reviewAppliedChanges(appliedChangesRef.current);
        const hasErrors = report.findings.some((finding) => finding.severity === "error");
        const highRisk = report.findings.some((finding) => finding.severity === "warning");
        return {
          reportId: report.id,
          hasErrors,
          highRisk
        };
      }
    });
  }
  const service = serviceRef.current;

  const refresh = (sessionId: string) => {
    setSession(service.getSessionStatus(sessionId));
    setGates(service.listSessionGates(sessionId));
    setTimeline(service.listSessionTimeline(sessionId));
  };

  const start = async () => {
    if (!workspaceRoot) {
      setError("Kein Workspace aktiv.");
      return;
    }

    const normalizedGoal = goal.trim();
    if (!normalizedGoal) {
      setError("Bitte ein Session-Ziel eingeben.");
      return;
    }

    try {
      const started = await service.startSession(normalizedGoal, workspaceRoot);
      setActiveSessionId(started.id);
      setError(null);
      refresh(started.id);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Session konnte nicht gestartet werden.");
    }
  };

  const pause = () => {
    if (!activeSessionId) {
      return;
    }
    try {
      service.pauseSession(activeSessionId);
      refresh(activeSessionId);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Pause fehlgeschlagen.");
    }
  };

  const resume = () => {
    if (!activeSessionId) {
      return;
    }
    try {
      service.resumeSession(activeSessionId);
      refresh(activeSessionId);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Resume fehlgeschlagen.");
    }
  };

  const cancel = () => {
    if (!activeSessionId) {
      return;
    }
    try {
      service.cancelSession(activeSessionId);
      refresh(activeSessionId);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Cancel fehlgeschlagen.");
    }
  };

  const runNext = async () => {
    if (!activeSessionId) {
      return;
    }
    try {
      await service.runNextSessionStep(activeSessionId);
      refresh(activeSessionId);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Naechster Session-Step fehlgeschlagen.");
    }
  };

  const approve = async (gateId: string) => {
    if (!activeSessionId) {
      return;
    }
    try {
      await service.approveGate(gateId);
      refresh(activeSessionId);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Gate-Freigabe fehlgeschlagen.");
    }
  };

  const reject = (gateId: string) => {
    if (!activeSessionId) {
      return;
    }
    try {
      service.rejectGate(gateId);
      refresh(activeSessionId);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Gate-Ablehnung fehlgeschlagen.");
    }
  };

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Autonomous Session v0 (Legacy)</h3>
          <p className="mt-1 text-[11px] text-dbzs-muted">
            Legacy-Fallback mit harten Approval Gates. Patches werden nicht mehr automatisch angewendet.
          </p>
          <p className="mt-1 text-[11px] text-dbzs-amber">
            Primärer Pfad: Agent Workbench Tab. Autonomous v0 bleibt nur zur Kontrolle sichtbar.
          </p>
        </div>
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text disabled:opacity-40"
          disabled={!activeSessionId || !session || session.status !== "running"}
          onClick={() => {
            void runNext();
          }}
          type="button"
        >
          Naechster Schritt
        </button>
      </div>

      <textarea
        className="mt-3 h-20 w-full resize-y border border-dbzs-border bg-dbzs-bg p-2 text-xs text-dbzs-text"
        onChange={(event) => setGoal(event.currentTarget.value)}
        placeholder="Session-Ziel, z. B. 'Implementiere sichere Runtime-Orchestrierung mit Tests.'"
        value={goal}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
          disabled={!workspaceRoot || goal.trim().length === 0}
          onClick={() => {
            void start();
          }}
          type="button"
        >
          Start
        </button>
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text disabled:opacity-40"
          disabled={!activeSessionId || !session || session.status !== "running"}
          onClick={pause}
          type="button"
        >
          Pause
        </button>
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text disabled:opacity-40"
          disabled={!activeSessionId || !session || session.status !== "idle"}
          onClick={resume}
          type="button"
        >
          Resume
        </button>
        <button
          className="border border-dbzs-red/40 bg-dbzs-red/10 px-2 py-1 text-xs text-dbzs-red disabled:opacity-40"
          disabled={!activeSessionId || !session || session.status === "completed" || session.status === "cancelled"}
          onClick={cancel}
          type="button"
        >
          Cancel
        </button>
      </div>

      <div className="mt-3 space-y-1 text-[11px] text-dbzs-muted">
        <div>Status: {session?.status ?? "idle"}</div>
        <div>Aktuelle Task: {session?.currentTaskId ?? "-"}</div>
        <div>Queue-Progress: applied {session?.appliedChangeIds.length ?? 0} · tests {session?.testRunIds.length ?? 0}</div>
      </div>

      {error ? <p className="mt-2 text-xs text-dbzs-red">{error}</p> : null}

      <div className="mt-3 border border-dbzs-border bg-dbzs-bg p-2 text-[11px]">
        <div className="text-dbzs-muted">Approval Gates</div>
        <div className="mt-2 space-y-2">
          {gates.filter((gate) => gate.status === "pending").length === 0 ? (
            <div className="text-dbzs-muted">Keine offenen Gates.</div>
          ) : (
            gates
              .filter((gate) => gate.status === "pending")
              .map((gate) => (
                <div className="border border-dbzs-border bg-dbzs-panel p-2" key={gate.id}>
                  <div className="text-dbzs-text">{gate.title}</div>
                  <div className="mt-1 text-dbzs-muted">{gate.description}</div>
                  <div className="mt-1 text-dbzs-muted">Type: {gate.type} · Related: {gate.relatedIds.join(", ") || "-"}</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan"
                      onClick={() => {
                        void approve(gate.id);
                      }}
                      type="button"
                    >
                      Approve
                    </button>
                    <button
                      className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
                      onClick={() => reject(gate.id)}
                      type="button"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>
      </div>

      <div className="mt-3 border border-dbzs-border bg-dbzs-bg p-2 text-[11px]">
        <div className="text-dbzs-muted">Session Timeline</div>
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
          {timeline.length === 0 ? (
            <div className="text-dbzs-muted">Noch keine Session-Ereignisse.</div>
          ) : (
            timeline.map((entry) => (
              <div className="border border-dbzs-border bg-dbzs-panel p-2" key={entry.id}>
                <div className="text-dbzs-text">{entry.title}</div>
                <div className="text-dbzs-muted">{entry.description}</div>
                <div className="text-dbzs-muted">{new Date(entry.createdAt).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}


