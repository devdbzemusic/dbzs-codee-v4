import type { BootPhase, BootState } from "@dbzs/shared";

function blockedByLabel(phase: BootPhase, state: BootState): string[] {
  return state.phases
    .filter((p) => p.state === "blocked" && p.dependencies.includes(phase.id))
    .map((p) => p.label);
}

function FailedPhaseDetails({ phase, state }: { phase: BootPhase; state: BootState }) {
  const blocked = blockedByLabel(phase, state);
  const timeToFailureMs = phase.startedAt && phase.finishedAt ? phase.finishedAt - phase.startedAt : null;

  return (
    <div className="rounded-md border border-dbzs-red/40 bg-dbzs-red/5 p-3 text-xs">
      <div className="font-semibold text-dbzs-red">{phase.label}</div>
      <div className="mt-1 text-dbzs-text">{phase.error?.message ?? phase.message}</div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-dbzs-muted">
        {phase.error?.technicalDetail ? (
          <>
            <dt>Ursache</dt>
            <dd className="text-dbzs-text">{phase.error.technicalDetail}</dd>
          </>
        ) : null}
        {timeToFailureMs != null ? (
          <>
            <dt>Laufzeit bis Fehler</dt>
            <dd className="text-dbzs-text">{(timeToFailureMs / 1000).toFixed(1)}s</dd>
          </>
        ) : null}
        {phase.error?.exitCode != null ? (
          <>
            <dt>Exit-Code</dt>
            <dd className="text-dbzs-text">{phase.error.exitCode}</dd>
          </>
        ) : null}
        {phase.error?.endpoint ? (
          <>
            <dt>Endpoint</dt>
            <dd className="text-dbzs-text">{phase.error.endpoint}</dd>
          </>
        ) : null}
        {phase.error?.port != null ? (
          <>
            <dt>Port</dt>
            <dd className="text-dbzs-text">{phase.error.port}</dd>
          </>
        ) : null}
        {phase.error?.timeoutMs != null ? (
          <>
            <dt>Timeout</dt>
            <dd className="text-dbzs-text">{phase.error.timeoutMs}ms</dd>
          </>
        ) : null}
        <dt>Retry-Versuche</dt>
        <dd className="text-dbzs-text">{phase.error?.retryAttempts ?? phase.retryCount}</dd>
        {blocked.length > 0 ? (
          <>
            <dt>Blockierte Folgephasen</dt>
            <dd className="text-dbzs-text">{blocked.join(", ")}</dd>
          </>
        ) : null}
      </dl>
      {phase.error?.stderrTail ? (
        <pre className="mt-2 max-h-24 overflow-y-auto rounded bg-black/40 p-2 text-[10px] text-dbzs-muted">
          {phase.error.stderrTail}
        </pre>
      ) : null}
    </div>
  );
}

export function BootErrorPanel({ state }: { state: BootState }) {
  const failedPhases = state.phases.filter((p) => p.state === "failed");
  if (failedPhases.length === 0) return null;

  return (
    <div className="space-y-2">
      {failedPhases.map((phase) => (
        <FailedPhaseDetails key={phase.id} phase={phase} state={state} />
      ))}
    </div>
  );
}
