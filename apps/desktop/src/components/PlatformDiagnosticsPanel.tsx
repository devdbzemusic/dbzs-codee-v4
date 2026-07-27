import type { TrajectoryEvent } from "@dbzs/shared";
import { useCallback, useEffect, useState } from "react";
import {
  collectPlatformDiagnostics,
  type PlatformCheckRow,
  type PlatformDiagnosticsSnapshot
} from "@/services/platformDiagnosticsService";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { TrajectoryMiniPanel } from "@/components/TrajectoryMiniPanel";

interface PlatformDiagnosticsPanelProps {
  detached?: boolean;
  selectedJobId?: string | null;
  onClose?: () => void;
}

function statusTone(status: PlatformCheckRow["status"]): string {
  switch (status) {
    case "ok":
      return "border-dbzs-green/40 bg-dbzs-green/10 text-dbzs-green";
    case "warn":
      return "border-dbzs-amber/40 bg-dbzs-amber/10 text-dbzs-amber";
    case "error":
      return "border-dbzs-red/40 bg-dbzs-red/10 text-dbzs-red";
    default:
      return "border-dbzs-border bg-dbzs-bg text-dbzs-muted";
  }
}

function CheckCard({ row }: { row: PlatformCheckRow }) {
  return (
    <article className={`rounded border px-3 py-2 ${statusTone(row.status)}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide">{row.label}</div>
      <p className="mt-1 text-xs leading-5 text-dbzs-text">{row.detail}</p>
    </article>
  );
}

function formatEventTime(value: string): string {
  return new Date(value).toLocaleString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function RecentTrajectoryList({ events }: { events: TrajectoryEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-dbzs-muted">Keine recent Trajectory-Events.</p>;
  }

  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li key={event.id} className="rounded border border-dbzs-border/70 bg-dbzs-bg/40 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wide text-dbzs-cyan">
              {event.eventType.replaceAll("_", " ")}
            </span>
            <span className="text-[10px] text-dbzs-muted">{formatEventTime(event.createdAt)}</span>
          </div>
          <p className="mt-1 text-xs text-dbzs-text">{event.summary}</p>
          <p className="mt-0.5 text-[10px] text-dbzs-muted">Job: {event.jobId}</p>
        </li>
      ))}
    </ul>
  );
}

export function PlatformDiagnosticsPanel({
  detached = false,
  selectedJobId = null,
  onClose
}: PlatformDiagnosticsPanelProps) {
  const workspaceRoot = useWorkspaceStore((state) => state.state.projectPath);
  const workspaceName = useWorkspaceStore((state) => state.state.projectName);
  const workspaceFileCount = useWorkspaceStore((state) => state.files.length);
  const scanFiles = useWorkspaceStore((state) => state.scanFiles);
  const loadWorkspaceState = useWorkspaceStore((state) => state.loadWorkspaceState);
  const lastActivity = useRuntimeChatStore((state) => state.lastActivity);
  const [snapshot, setSnapshot] = useState<PlatformDiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await collectPlatformDiagnostics({
        workspaceRoot,
        workspaceFileCount
      });
      setSnapshot(next);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Diagnose fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }, [workspaceFileCount, workspaceRoot]);

  useEffect(() => {
    void loadWorkspaceState();
  }, [loadWorkspaceState]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const workspaceStep = lastActivity?.steps.find((step) => step.id === "workspace-context");

  return (
    <div className={`mx-auto flex w-full flex-col gap-4 ${detached ? "max-w-5xl" : ""}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-dbzs-border pb-3">
        <div>
          <h1 className="text-sm font-medium text-dbzs-text">Plattform-Diagnose</h1>
          <p className="mt-0.5 text-xs text-dbzs-muted">
            Backend, IPC, Workspace Sync, Runtime-Chat-Kontext und ATIF-light Trajectory
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded border border-dbzs-border px-2 py-1 text-[11px] text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-cyan"
            onClick={() => void scanFiles().then(() => refresh())}
            type="button"
          >
            Workspace scannen
          </button>
          <button
            className="rounded border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-2 py-1 text-[11px] text-dbzs-cyan"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            {loading ? "Prüfe …" : "Aktualisieren"}
          </button>
          {detached && onClose ? (
            <button
              className="rounded border border-dbzs-border px-2 py-1 text-[11px] text-dbzs-muted"
              onClick={() => onClose()}
              type="button"
            >
              Schließen
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className="text-xs text-dbzs-red">{error}</p> : null}

      {snapshot ? (
        <>
          <p className="text-[10px] text-dbzs-muted">
            Zuletzt geprüft: {new Date(snapshot.checkedAt).toLocaleString("de-DE")}
            {workspaceName ? ` · ${workspaceName}` : ""}
          </p>

          <section className="grid gap-2 md:grid-cols-2">
            <CheckCard row={snapshot.backendHealth} />
            <CheckCard row={snapshot.workspaceScan} />
            <CheckCard row={snapshot.chatContextIpc} />
            <CheckCard row={snapshot.trajectoryIpc} />
          </section>

          <section className="rounded border border-dbzs-border bg-dbzs-panelSoft p-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-dbzs-muted">Runtime Chat · letzter Lauf</h2>
            {workspaceStep ? (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-5 text-dbzs-text">
                {workspaceStep.label}: {workspaceStep.detail ?? "—"}
              </pre>
            ) : (
              <p className="mt-2 text-xs text-dbzs-muted">Noch kein Chat-Lauf in dieser Session.</p>
            )}
          </section>

          <section className="rounded border border-dbzs-border bg-dbzs-panelSoft p-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-dbzs-muted">ATIF-light · Recent Events</h2>
            <div className="mt-2">
              <RecentTrajectoryList events={snapshot.recentEvents} />
            </div>
          </section>

          {selectedJobId ? (
            <section className="rounded border border-dbzs-border bg-dbzs-panelSoft p-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-dbzs-muted">Job Trajectory</h2>
              <TrajectoryMiniPanel jobId={selectedJobId} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
