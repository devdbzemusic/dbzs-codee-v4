import { useMemo, useState } from "react";
import type { RuntimeChatActivityRun, RuntimeChatActivityStepStatus } from "@/types/runtimeChatActivity";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { agentLabel } from "@/services/runtimeChatActivityHelpers";

function StepIcon({ status }: { status: RuntimeChatActivityStepStatus }) {
  switch (status) {
    case "running":
      return (
        <svg aria-hidden="true" className="h-3 w-3 animate-spin text-dbzs-cyan" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
        </svg>
      );
    case "done":
      return (
        <svg aria-hidden="true" className="h-3 w-3 text-dbzs-green" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "error":
      return (
        <svg aria-hidden="true" className="h-3 w-3 text-dbzs-red" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      );
    case "skipped":
      return (
        <svg aria-hidden="true" className="h-3 w-3 text-dbzs-muted/60" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M5 12h14" strokeLinecap="round" />
        </svg>
      );
    default:
      return <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-dbzs-muted/40" />;
  }
}

function stepClass(status: RuntimeChatActivityStepStatus): string {
  switch (status) {
    case "running":
      return "text-dbzs-cyan";
    case "done":
      return "text-dbzs-green";
    case "error":
      return "text-dbzs-red";
    case "skipped":
      return "text-dbzs-muted";
    default:
      return "text-dbzs-muted";
  }
}

function ActivityRunView({
  run,
  expanded,
  onToggle,
  title
}: {
  run: RuntimeChatActivityRun;
  expanded: boolean;
  onToggle: () => void;
  title: string;
}) {
  const runningStep = run.steps.find((step) => step.status === "running");

  return (
    <div className="rounded border border-dbzs-border bg-dbzs-bg">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={onToggle}
        type="button"
      >
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-dbzs-text">{title}</div>
          <div className="mt-0.5 truncate text-[10px] text-dbzs-muted">
            {runningStep
              ? `${runningStep.label} …`
              : run.summary ?? `${agentLabel(run.targetAgent)} · ${run.steps.length} Schritte`}
          </div>
        </div>
        <span className="shrink-0 text-dbzs-muted">
          <svg
            aria-hidden="true"
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </span>
      </button>

      {expanded ? (
        <div className="space-y-2 border-t border-dbzs-border px-3 py-2">
          <div className="text-[10px] text-dbzs-muted">
            Agent: {agentLabel(run.targetAgent)}
            {run.modelName || run.modelId ? ` · ${run.modelName ?? run.modelId}` : ""}
          </div>
          {run.steps.map((step) => (
            <div className="rounded border border-dbzs-border/60 bg-dbzs-panelSoft px-2 py-1.5" key={step.id}>
              <div className={`flex items-center gap-2 text-[11px] font-medium ${stepClass(step.status)}`}>
                <StepIcon status={step.status} />
                <span className="text-dbzs-text">{step.label}</span>
              </div>
              {step.detail ? (
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-5 text-dbzs-muted">
                  {step.detail}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RuntimeChatActivityPanel() {
  const currentActivity = useRuntimeChatStore((state) => state.currentActivity);
  const lastActivity = useRuntimeChatStore((state) => state.lastActivity);
  const isSending = useRuntimeChatStore((state) => state.isSending);
  const clearActivityHistory = useRuntimeChatStore((state) => state.clearActivityHistory);
  const [lastExpanded, setLastExpanded] = useState(false);

  const showLast = useMemo(() => !isSending && lastActivity !== null, [isSending, lastActivity]);

  if (!currentActivity && !showLast) {
    return null;
  }

  return (
    <section className="border-b border-dbzs-border bg-dbzs-panel p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-dbzs-text">Analyse-Aktivitaet</h4>
        {showLast ? (
          <button
            className="rounded border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[10px] text-dbzs-muted hover:text-dbzs-text"
            onClick={clearActivityHistory}
            type="button"
          >
            Protokoll leeren
          </button>
        ) : null}
      </div>

      <div className="space-y-2">
        {currentActivity ? (
          <ActivityRunView
            expanded
            onToggle={() => undefined}
            run={currentActivity}
            title={isSending ? "Analyse laeuft …" : "Letzte Analyse"}
          />
        ) : null}

        {showLast && lastActivity && (!currentActivity || lastActivity.id !== currentActivity.id) ? (
          <ActivityRunView
            expanded={lastExpanded}
            onToggle={() => setLastExpanded((value) => !value)}
            run={lastActivity}
            title="Letztes Analyse-Protokoll"
          />
        ) : null}
      </div>
    </section>
  );
}
