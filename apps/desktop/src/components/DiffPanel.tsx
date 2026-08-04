import { useEditorStore } from "@/stores/editorStore";
import { DiffChangeView } from "@/components/runtime-chat/DiffChangeView";

export function DiffPanel() {
  const { activePendingChange, appliedChanges, applyPendingChange, discardPendingChange, isBusy, restoreSnapshot } =
    useEditorStore();

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <svg aria-hidden="true" className="h-3.5 w-3.5 text-dbzs-cyan" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M9 12h6M9 16h6M9 8h1" strokeLinecap="round" />
          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h9l7 7v9a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Diff-Vorschau
      </h3>

      {activePendingChange ? (
        <div className="mt-3">
          <DiffChangeView
            fileLabel={activePendingChange.label}
            diff={activePendingChange.diff}
            source={
              activePendingChange.source === "agent"
                ? `Agent: ${activePendingChange.agentId ?? "unbekannt"}`
                : "Manuell"
            }
            reason={activePendingChange.reason}
            busy={isBusy}
            onApply={() => void applyPendingChange(activePendingChange.filePath)}
            onReject={() => discardPendingChange(activePendingChange.filePath)}
            onReset={() => void restoreSnapshot(activePendingChange.snapshotId)}
          />
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-dbzs-muted">Kein aktiver Pending-Change.</p>
          {appliedChanges.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Zuletzt angewendet</div>
              {appliedChanges
                .slice(-5)
                .reverse()
                .map((change) => (
                  <div
                    className="flex items-center justify-between gap-2 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px]"
                    key={change.snapshotId}
                  >
                    <span className="min-w-0 truncate text-dbzs-muted">{change.filePath.split(/[\\/]/).at(-1)}</span>
                    <span className="flex shrink-0 items-center gap-1 text-[10px] text-dbzs-muted">
                      {change.action === "apply" ? (
                        <svg aria-hidden="true" className="h-2.5 w-2.5 text-dbzs-green" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg aria-hidden="true" className="h-2.5 w-2.5 text-dbzs-cyan" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {change.action === "apply" ? "angewendet" : "wiederhergestellt"}
                    </span>
                  </div>
                ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
