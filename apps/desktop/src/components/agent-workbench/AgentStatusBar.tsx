import type { AgentRun, AgentStep } from "@dbzs/shared";
import type { HostExecutorStatus } from "@/services/agentHostExecutor";

export type AgentStatusBarProps = {
  workspaceName: string | null;
  run: AgentRun | null;
  steps: AgentStep[];
  modelLabel: string | null;
  hostExecutorStatus: HostExecutorStatus;
  sseConnected: boolean;
  lastCommandSummary: string | null;
  warningCount: number;
  errorCount: number;
};

export function AgentStatusBar({
  workspaceName,
  run,
  steps,
  modelLabel,
  hostExecutorStatus,
  sseConnected,
  lastCommandSummary,
  warningCount,
  errorCount
}: AgentStatusBarProps) {
  const completedSteps = steps.filter((step) => step.status === "completed").length;
  const currentOrdinal =
    steps.find((step) => step.id === run?.currentStepId)?.ordinal ??
    steps.find((step) => step.status === "active")?.ordinal ??
    completedSteps;

  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dbzs-border bg-dbzs-panel px-3 py-2 text-[10px] text-dbzs-muted">
      <span>Workspace: {workspaceName ?? "-"}</span>
      <span>Run: {run?.status ?? "none"}</span>
      <span>
        Step: {steps.length > 0 ? `${currentOrdinal}/${steps.length}` : "-"}
      </span>
      <span>Modell: {modelLabel ?? run?.modelId ?? "-"}</span>
      <span>
        Host: {hostExecutorStatus.state}
        {hostExecutorStatus.lastActionType ? ` · ${hostExecutorStatus.lastActionType}` : ""}
      </span>
      <span>SSE: {sseConnected ? "connected" : "offline"}</span>
      <span>Command: {lastCommandSummary ?? "-"}</span>
      {(warningCount > 0 || errorCount > 0) && (
        <span className="text-dbzs-amber">
          {warningCount} warn · {errorCount} err
        </span>
      )}
    </footer>
  );
}
