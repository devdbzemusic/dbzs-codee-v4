import { useEditorStore } from "@/stores/editorStore";
import { DiffChangeView } from "@/components/runtime-chat/DiffChangeView";

export function DiffPanel() {
  const { activePendingChange, appliedChanges, applyPendingChange, discardPendingChange, isBusy, restoreSnapshot } =
    useEditorStore();

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <h3 className="text-sm font-medium">Diff-Vorschau</h3>

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
                    <span className="shrink-0 text-[10px] text-dbzs-muted">
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
