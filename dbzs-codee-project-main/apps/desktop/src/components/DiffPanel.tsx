import { useEditorStore } from "@/stores/editorStore";

function renderColoredDiff(diff: string) {
  if (!diff.trim()) {
    return <p className="text-dbzs-muted">Kein Diff vorhanden.</p>;
  }

  return (
    <div className="font-mono text-[10px] leading-relaxed">
      {diff.split("\n").map((line, index) => {
        let className = "text-dbzs-muted";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          className = "text-dbzs-green bg-dbzs-green/5";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          className = "text-dbzs-red bg-dbzs-red/5";
        } else if (line.startsWith("@@")) {
          className = "text-dbzs-cyan";
        } else if (line.startsWith("+++") || line.startsWith("---")) {
          className = "text-dbzs-text font-semibold";
        }
        return (
          <div className={`whitespace-pre-wrap break-words px-2 ${className}`} key={index}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

export function DiffPanel() {
  const { activePendingChange, appliedChanges, applyPendingChange, discardPendingChange, isBusy, restoreSnapshot } =
    useEditorStore();

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <h3 className="text-sm font-medium">Diff-Vorschau</h3>

      {activePendingChange ? (
        <div className="mt-3 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs text-dbzs-text">{activePendingChange.label}</div>
              <div className="text-[11px] text-dbzs-muted">
                {activePendingChange.source === "agent"
                  ? `Agent: ${activePendingChange.agentId ?? "unbekannt"}`
                  : "Manuell"}
              </div>
              {activePendingChange.reason ? (
                <div className="truncate text-[11px] text-dbzs-muted">{activePendingChange.reason}</div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button
                className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[11px] text-dbzs-cyan disabled:opacity-40"
                disabled={isBusy}
                onClick={() => void applyPendingChange(activePendingChange.filePath)}
                type="button"
              >
                Anwenden
              </button>
              <button
                className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text disabled:opacity-40"
                disabled={isBusy}
                onClick={() => discardPendingChange(activePendingChange.filePath)}
                type="button"
              >
                Verwerfen
              </button>
              <button
                className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text disabled:opacity-40"
                disabled={isBusy}
                onClick={() => void restoreSnapshot(activePendingChange.snapshotId)}
                type="button"
              >
                Zurücksetzen
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-auto border border-dbzs-border bg-dbzs-bg">
            {renderColoredDiff(activePendingChange.diff)}
          </div>
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
