import type { AgentRun, AgentRunStatus } from "@dbzs/shared";

const STATUS_COLORS: Record<AgentRunStatus, string> = {
  created: "text-dbzs-muted",
  planning: "text-dbzs-cyan",
  waiting_plan_review: "text-dbzs-amber",
  ready: "text-dbzs-cyan",
  running: "text-dbzs-green",
  waiting_review: "text-dbzs-amber",
  paused: "text-dbzs-amber",
  paused_recovery: "text-dbzs-amber",
  migration_review_required: "text-dbzs-amber",
  workspace_review_required: "text-dbzs-amber",
  cancelled: "text-dbzs-muted",
  failed: "text-dbzs-red",
  retrying: "text-dbzs-amber",
  completed: "text-dbzs-green"
};

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) {
    return "-";
  }
  const start = Date.parse(startedAt);
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "-";
  }
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${seconds}s`;
}

export type AgentRunHeaderProps = {
  run: AgentRun | null;
  currentStepTitle: string | null;
  isMutating: boolean;
  onPause: () => void;
  onResume: () => void;
  onAcceptResumeBaseline: () => void;
  onAcceptWorkspaceChanges: () => void;
  onStop: () => void;
  onOpenEditor: () => void;
  workspaceChangeFiles: string[];
};

export function AgentRunHeader({
  run,
  currentStepTitle,
  isMutating,
  onPause,
  onResume,
  onAcceptResumeBaseline,
  onAcceptWorkspaceChanges,
  onStop,
  onOpenEditor,
  workspaceChangeFiles
}: AgentRunHeaderProps) {
  if (!run) {
    return (
      <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
        <h2 className="text-sm font-medium text-dbzs-text">Agent Run</h2>
        <p className="mt-2 text-xs text-dbzs-muted">Kein Run ausgewählt.</p>
      </section>
    );
  }

  // Extend run model definition to read backend runtime details if available
  const castRun = run as any;
  const activeBackend = castRun.execution_backend;
  const isLocalRuntime = activeBackend === "local_runtime";
  const modelInfo = isLocalRuntime
    ? `${castRun.runtime_model_name ?? castRun.modelId} (${castRun.runtime_provider ?? "local"})`
    : `${castRun.modelId ?? castRun.provider ?? "-"}`;

  const canPause = run.status === "running" || run.status === "waiting_review";
  const canResume = run.status === "paused";
  const requiresMigrationReview = run.status === "migration_review_required";
  const requiresWorkspaceReview = run.status === "workspace_review_required";
  const canStop = !["completed", "cancelled", "failed"].includes(run.status);
  const visibleWorkspaceChanges = workspaceChangeFiles.slice(0, 5);

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-dbzs-text">{run.goal}</h2>
          <div className="mt-2 grid gap-1 text-[11px] text-dbzs-muted sm:grid-cols-2">
            <div>Workspace: {run.workspaceName || run.workspaceRoot}</div>
            <div>Modell: {modelInfo}</div>
            <div className={STATUS_COLORS[run.status]}>Status: {run.status}</div>
            <div>Laufzeit: {formatDuration(run.startedAt, run.finishedAt)}</div>
            {isLocalRuntime && (
              <div className="sm:col-span-2 text-dbzs-cyan">
                Laufzeit-Endpoint: <span className="font-mono">{castRun.runtime_endpoint || "-"}</span> (PID: {castRun.runtime_pid || "-"} · {castRun.runtime_health_state || "unknown"})
              </div>
            )}
            <div className="sm:col-span-2">Step: {currentStepTitle ?? "-"}</div>
          </div>
          {run.errorMessage ? (
            <p className="mt-2 text-xs text-dbzs-red">{run.errorMessage}</p>
          ) : null}
          {requiresMigrationReview ? (
            <div className="mt-3 border border-dbzs-amber/40 bg-dbzs-amber/10 p-3 text-xs text-dbzs-amber">
              <div className="font-medium">Resume-Baseline fehlt.</div>
              <p className="mt-1 text-dbzs-muted">
                Der Run wurde vor der portablen Manifest-Baseline angelegt. Fortsetzen ist erst nach
                expliziter Bestätigung der aktuellen Workspace-Baseline möglich.
              </p>
            </div>
          ) : null}
          {requiresWorkspaceReview ? (
            <div className="mt-3 border border-dbzs-amber/40 bg-dbzs-amber/10 p-3 text-xs text-dbzs-amber">
              <div className="font-medium">Workspace-Änderungen prüfen.</div>
              <p className="mt-1 text-dbzs-muted">
                Seit der bestätigten Resume-Baseline wurden {workspaceChangeFiles.length} Datei(en)
                geändert. Akzeptieren schreibt eine neue Baseline; danach bleibt der Run pausiert.
              </p>
              {visibleWorkspaceChanges.length > 0 ? (
                <ul className="mt-2 max-h-24 overflow-auto font-mono text-[11px] text-dbzs-text">
                  {visibleWorkspaceChanges.map((filePath) => (
                    <li key={filePath}>{filePath}</li>
                  ))}
                  {workspaceChangeFiles.length > visibleWorkspaceChanges.length ? (
                    <li>+{workspaceChangeFiles.length - visibleWorkspaceChanges.length} weitere</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text hover:border-dbzs-cyan/40 disabled:opacity-40"
            disabled={isMutating}
            onClick={onOpenEditor}
            type="button"
          >
            Open in Editor
          </button>
          <button
            className="border border-dbzs-amber/40 bg-dbzs-amber/10 px-2 py-1 text-xs text-dbzs-amber disabled:opacity-40"
            disabled={!canPause || isMutating}
            onClick={onPause}
            type="button"
          >
            Pause
          </button>
          <button
            className="border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
            disabled={!canResume || isMutating}
            onClick={onResume}
            type="button"
          >
            Resume
          </button>
          {requiresMigrationReview ? (
            <button
              className="border border-dbzs-amber/40 bg-dbzs-amber/10 px-2 py-1 text-xs text-dbzs-amber disabled:opacity-40"
              disabled={isMutating}
              onClick={onAcceptResumeBaseline}
              type="button"
            >
              Baseline akzeptieren
            </button>
          ) : null}
          {requiresWorkspaceReview ? (
            <button
              className="border border-dbzs-amber/40 bg-dbzs-amber/10 px-2 py-1 text-xs text-dbzs-amber disabled:opacity-40"
              disabled={isMutating}
              onClick={onAcceptWorkspaceChanges}
              type="button"
            >
              Workspace-Änderungen akzeptieren
            </button>
          ) : null}
          <button
            className="border border-dbzs-red/40 bg-dbzs-red/10 px-2 py-1 text-xs text-dbzs-red disabled:opacity-40"
            disabled={!canStop || isMutating}
            onClick={onStop}
            type="button"
          >
            Stop
          </button>
        </div>
      </div>
    </section>
  );
}
