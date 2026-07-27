import type { BootState } from "@dbzs/shared";

function formatElapsed(startedAt: number, finishedAt: number | undefined, now: number): string {
  const ms = (finishedAt ?? now) - startedAt;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function BootProgress({ state, now }: { state: BootState; now: number }) {
  const currentPhase =
    state.phases.find((phase) => ["running", "waiting", "retrying"].includes(phase.state)) ??
    state.phases.find((phase) => phase.id === state.currentPhaseId) ??
    null;
  const retryTotal = state.phases.reduce((sum, p) => sum + p.retryCount, 0);

  return (
    <div className="space-y-2 border-b border-dbzs-border pb-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold text-dbzs-text">DBZS Code Assistant</span>
        <span className="text-sm text-dbzs-cyan">{state.overallProgress}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-dbzs-panelSoft">
        <div
          className="h-full bg-dbzs-cyan transition-[width]"
          style={{ width: `${Math.min(100, state.overallProgress)}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-dbzs-muted">
        <span>Phase: {currentPhase?.label ?? "—"}</span>
        <span>Laufzeit: {formatElapsed(state.startedAt, state.finishedAt, now)}</span>
        {state.backendPid != null ? <span>Backend PID: {state.backendPid}</span> : null}
        {state.backendPort != null ? <span>Port: {state.backendPort}</span> : null}
        {state.activeRuntimeSlot ? <span>Runtime: {state.activeRuntimeSlot}</span> : null}
        {state.residentModelId ? <span>Modell: {state.residentModelId}</span> : null}
        {state.detectedModelCount != null ? <span>Modelle erkannt: {state.detectedModelCount}</span> : null}
        {retryTotal > 0 ? <span>Retries: {retryTotal}</span> : null}
      </div>
      {state.lastErrorMessage ? (
        <div className="text-xs text-dbzs-red">{state.lastErrorMessage}</div>
      ) : null}
    </div>
  );
}
