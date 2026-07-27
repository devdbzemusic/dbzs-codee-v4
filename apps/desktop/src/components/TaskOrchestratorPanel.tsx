import { useEffect, useMemo, useState } from "react";
import type {
  CommandRunStatus,
  ExecutionPlan,
  OrchestratorApprovalGate,
  PlannerPlan,
  PlannedTaskExecution,
  ProposedChange
} from "@dbzs/shared";
import { ReviewAgentService } from "@/services/reviewAgentService";
import { TaskOrchestratorService } from "@/services/taskOrchestratorService";
import { useGitStore } from "@/stores/gitStore";

const HIGH_RISK_COMMIT_ACK = "RISK_ACCEPTED";

interface TaskOrchestratorPanelProps {
  plannerPlan: PlannerPlan | null;
  pendingChanges: ProposedChange[];
  appliedChanges: ProposedChange[];
  latestTestRun: CommandRunStatus | null;
}

function queueLabel(task: PlannedTaskExecution): string {
  const gate = task.awaitingGate ? ` · gate:${task.awaitingGate}` : "";
  return `${task.assignedAgent.toUpperCase()} · ${task.status}${gate}`;
}

function gateLabel(gate: OrchestratorApprovalGate | undefined): string {
  if (!gate) {
    return "-";
  }

  if (gate === "plan") {
    return "Plan";
  }
  if (gate === "apply") {
    return "Apply";
  }
  if (gate === "commit") {
    return "Commit";
  }
  return "Restore";
}

function progressText(plan: ExecutionPlan | null): string {
  if (!plan) {
    return "0/0";
  }

  const completed = plan.tasks.filter((task) => task.status === "completed" || task.status === "cancelled").length;
  return `${completed}/${plan.tasks.length}`;
}

function statusTone(status: PlannedTaskExecution["status"]): string {
  if (status === "failed") {
    return "text-dbzs-red";
  }
  if (status === "waiting_approval") {
    return "text-dbzs-amber";
  }
  if (status === "completed") {
    return "text-dbzs-cyan";
  }
  return "text-dbzs-muted";
}

function hasFailedTests(latestTestRun: CommandRunStatus | null): boolean {
  if (!latestTestRun) {
    return false;
  }

  if (latestTestRun.status === "failed") {
    return true;
  }

  return typeof latestTestRun.exitCode === "number" && latestTestRun.exitCode > 0;
}

export function TaskOrchestratorPanel({ plannerPlan, pendingChanges, appliedChanges, latestTestRun }: TaskOrchestratorPanelProps) {
  const orchestrator = useMemo(() => new TaskOrchestratorService(), []);
  const reviewService = useMemo(() => new ReviewAgentService(), []);
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [message, setMessage] = useState("Noch kein Execution Plan erstellt.");
  const [error, setError] = useState<string | null>(null);
  const [requirePlanApproval, setRequirePlanApproval] = useState(true);
  const [requireApplyApproval, setRequireApplyApproval] = useState(true);
  const [requireCommitApproval, setRequireCommitApproval] = useState(true);
  const [requireRestoreApproval, setRequireRestoreApproval] = useState(true);
  const [rejectReason, setRejectReason] = useState("");
  const [commitGateConfirmArmed, setCommitGateConfirmArmed] = useState(false);
  const [commitRiskAckText, setCommitRiskAckText] = useState("");

  const runningTask = plan?.tasks.find((task) => task.status === "running") ?? null;
  const waitingTask = plan?.tasks.find((task) => task.status === "waiting_approval") ?? null;
  const queue = plan?.tasks.filter((task) => task.status === "queued" || task.status === "pending" || task.status === "waiting_approval") ?? [];
  const reviewHasErrors = reviewService
    .reviewAppliedChanges(appliedChanges)
    .findings
    .some((finding) => finding.severity === "error");
  const commitRiskLevel = useGitStore((state) => state.commitSuggestion?.riskLevel ?? "low");

  const runContext = {
    hasOpenDiffs: pendingChanges.length > 0,
    hasReviewErrors: reviewHasErrors,
    hasFailedTests: hasFailedTests(latestTestRun),
    requirePlanApproval,
    requireApplyApproval,
    requireCommitApproval,
    requireRestoreApproval
  };

  useEffect(() => {
    if (waitingTask?.awaitingGate !== "commit") {
      setCommitGateConfirmArmed(false);
      setCommitRiskAckText("");
    }
  }, [waitingTask?.awaitingGate]);

  const createPlan = () => {
    if (!plannerPlan) {
      setError("Kein Planner-Plan verfuegbar. Bitte zuerst im Planner Agent einen Plan erstellen.");
      return;
    }

    const next = orchestrator.createExecutionPlan(plannerPlan);
    setPlan(next);
    setMessage("Execution Plan erstellt.");
    setError(null);
  };

  const start = () => {
    if (!plan) {
      return;
    }

    try {
      const result = orchestrator.startExecution(plan.id, runContext);
      setPlan(result.plan);
      setMessage(result.message);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Execution konnte nicht gestartet werden.");
    }
  };

  const runNext = () => {
    if (!plan) {
      return;
    }

    try {
      const result = orchestrator.runNextTask(plan.id, runContext);
      setPlan(result.plan);
      setMessage(result.message);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Naechste Task konnte nicht ausgefuehrt werden.");
    }
  };

  const cancel = () => {
    if (!plan) {
      return;
    }

    try {
      const next = orchestrator.cancelExecution(plan.id);
      setPlan(next);
      setMessage("Execution wurde abgebrochen.");
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Execution konnte nicht abgebrochen werden.");
    }
  };

  const retry = (taskId: string) => {
    if (!plan) {
      return;
    }

    try {
      const result = orchestrator.retryTask(taskId);
      setPlan(result.plan);
      setMessage(result.message);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Retry nicht moeglich.");
    }
  };

  const approveGate = () => {
    if (!plan) {
      return;
    }

    const commitGateNeedsExtraConfirm =
      waitingTask?.awaitingGate === "commit" && (commitRiskLevel === "high" || reviewHasErrors);

    const commitGateNeedsRiskAck = waitingTask?.awaitingGate === "commit" && commitRiskLevel === "high";
    const commitRiskAckValid = commitRiskAckText.trim().toUpperCase() === HIGH_RISK_COMMIT_ACK;

    if (commitGateNeedsRiskAck && !commitRiskAckValid) {
      setError(`High-Risk Commit blockiert. Bitte exakt ${HIGH_RISK_COMMIT_ACK} eingeben.`);
      return;
    }

    if (commitGateNeedsExtraConfirm && !commitGateConfirmArmed) {
      setCommitGateConfirmArmed(true);
      setError(null);
      setMessage(
        "Commit-Gate mit erhoehtem Risiko erkannt. Bitte Freigabe erneut bestaetigen, um fortzufahren."
      );
      return;
    }

    try {
      const result = orchestrator.approveCurrentGate(plan.id);
      setPlan(result.plan);
      setMessage(result.message);
      setError(null);
      setCommitGateConfirmArmed(false);
      setCommitRiskAckText("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Gate konnte nicht freigegeben werden.");
    }
  };

  const rejectGate = () => {
    if (!plan) {
      return;
    }

    try {
      const result = orchestrator.rejectCurrentGate(plan.id, rejectReason.trim() || undefined);
      setPlan(result.plan);
      setMessage(result.message);
      setError(null);
      setCommitGateConfirmArmed(false);
      setCommitRiskAckText("");
      setRejectReason("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Gate konnte nicht abgelehnt werden.");
    }
  };

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Task Orchestrator</h3>
          <p className="mt-1 text-[11px] text-dbzs-muted">
            Queue-basierte Agent-Steuerung mit Approval Gates und sequentieller Ausfuehrung.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
            disabled={!plannerPlan}
            onClick={createPlan}
            type="button"
          >
            Plan → Queue
          </button>
          <button
            className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text disabled:opacity-40"
            disabled={!plan || plan.status !== "idle"}
            onClick={start}
            type="button"
          >
            Start
          </button>
          <button
            className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text disabled:opacity-40"
            disabled={!plan || plan.status === "completed" || plan.status === "failed"}
            onClick={runNext}
            type="button"
          >
            Naechste Task
          </button>
          <button
            className="border border-dbzs-red/40 bg-dbzs-red/10 px-2 py-1 text-xs text-dbzs-red disabled:opacity-40"
            disabled={!plan || plan.status === "completed"}
            onClick={cancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-[11px] text-dbzs-muted">
        <div>Status: {plan?.status ?? "idle"}</div>
        <div>Fortschritt: {progressText(plan)}</div>
        <div>Queue: {queue.length}</div>
        <div>Laufende Task: {runningTask ? `${runningTask.taskId} · ${runningTask.assignedAgent}` : "-"}</div>
        <div>Offenes Gate: {waitingTask ? `${gateLabel(waitingTask.awaitingGate)} (${waitingTask.taskId})` : "-"}</div>
        <div>Gates: Diffs {pendingChanges.length > 0 ? "offen" : "frei"} · Tests {runContext.hasFailedTests ? "failed" : "ok"} · Review {reviewHasErrors ? "error" : "ok"}</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-dbzs-muted">
        <label className="flex items-center gap-2 border border-dbzs-border bg-dbzs-bg px-2 py-1">
          <input checked={requirePlanApproval} onChange={(event) => setRequirePlanApproval(event.currentTarget.checked)} type="checkbox" />
          Plan Gate
        </label>
        <label className="flex items-center gap-2 border border-dbzs-border bg-dbzs-bg px-2 py-1">
          <input checked={requireApplyApproval} onChange={(event) => setRequireApplyApproval(event.currentTarget.checked)} type="checkbox" />
          Apply Gate
        </label>
        <label className="flex items-center gap-2 border border-dbzs-border bg-dbzs-bg px-2 py-1">
          <input checked={requireCommitApproval} onChange={(event) => setRequireCommitApproval(event.currentTarget.checked)} type="checkbox" />
          Commit Gate
        </label>
        <label className="flex items-center gap-2 border border-dbzs-border bg-dbzs-bg px-2 py-1">
          <input checked={requireRestoreApproval} onChange={(event) => setRequireRestoreApproval(event.currentTarget.checked)} type="checkbox" />
          Restore Gate
        </label>
      </div>

      {waitingTask ? (
        <div className="mt-3 border border-dbzs-amber/60 bg-dbzs-amber/10 p-2 text-[11px]">
          <div className="text-dbzs-amber">Approval erforderlich: {gateLabel(waitingTask.awaitingGate)}</div>
          <div className="mt-1 text-dbzs-muted">{waitingTask.gateMessage ?? waitingTask.error ?? "Gate wartet auf Freigabe."}</div>
          <input
            className="mt-2 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
            onChange={(event) => setRejectReason(event.currentTarget.value)}
            placeholder="Ablehnungsgrund (optional)"
            value={rejectReason}
          />
          {waitingTask.awaitingGate === "commit" && commitRiskLevel === "high" ? (
            <>
              <div className="mt-2 text-dbzs-amber">
                High-Risk Commit erkannt. Zur Freigabe exakt {HIGH_RISK_COMMIT_ACK} eingeben.
              </div>
              <input
                className="mt-1 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
                onChange={(event) => setCommitRiskAckText(event.currentTarget.value)}
                placeholder={`Bestaetigung: ${HIGH_RISK_COMMIT_ACK}`}
                value={commitRiskAckText}
              />
            </>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <button
              className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
              disabled={waitingTask.awaitingGate === "commit" && commitRiskLevel === "high" && commitRiskAckText.trim().toUpperCase() !== HIGH_RISK_COMMIT_ACK}
              onClick={approveGate}
              type="button"
            >
              {waitingTask.awaitingGate === "commit" && (commitRiskLevel === "high" || reviewHasErrors) && !commitGateConfirmArmed
                ? "Gate freigeben (1/2)"
                : "Gate freigeben"}
            </button>
            <button
              className="border border-dbzs-red/40 bg-dbzs-red/10 px-2 py-1 text-xs text-dbzs-red"
              onClick={rejectGate}
              type="button"
            >
              Gate ablehnen
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-2 text-[11px] text-dbzs-muted">{message}</div>
      {error ? <p className="mt-2 text-xs text-dbzs-red">{error}</p> : null}

      <div className="mt-3 space-y-2">
        {(plan?.tasks ?? []).map((task) => (
          <div className="border border-dbzs-border bg-dbzs-bg p-2 text-[11px]" key={task.id}>
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-dbzs-text">
                {task.taskId} · {queueLabel(task)}
              </div>
              <div className={statusTone(task.status)}>{task.status}</div>
            </div>
            {task.error ? <div className="mt-1 text-dbzs-red">{task.error}</div> : null}
            {task.status === "failed" || task.status === "waiting_approval" ? (
              <button
                className="mt-2 border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan"
                onClick={() => retry(task.id)}
                type="button"
              >
                Retry
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
