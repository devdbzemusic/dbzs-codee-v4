import { useEffect } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useGitStore } from "@/stores/gitStore";

export function FileToolsPanel() {
  const { activeTab, hasWorkspacePatchUndo, undoLastSavedWorkspacePatch, isBusy: editorBusy } = useEditorStore();
  const {
    restorePoints,
    isRestorePointsLoading,
    restorePointsError,
    restorePointsRepairStatus,
    busyRestorePointId,
    refreshRestorePoints,
    createManualRestorePoint,
    restoreFromPoint,
    deleteRestorePoint,
    cleanupRestorePoints,
    repairRestorePointIndex
  } = useGitStore();

  useEffect(() => {
    void refreshRestorePoints();
  }, [refreshRestorePoints]);

  const activeFileName =
    activeTab?.type === "file" ? activeTab.name : null;

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <h3 className="text-sm font-medium">File Tools</h3>

      <div className="mt-3 space-y-4">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Aktive Datei</div>
          {activeFileName && hasWorkspacePatchUndo ? (
            <div className="flex items-center justify-between gap-2 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px]">
              <span className="min-w-0 truncate text-dbzs-muted">{activeFileName}</span>
              <button
                className="shrink-0 border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[10px] text-dbzs-text hover:bg-dbzs-panel disabled:opacity-50"
                disabled={editorBusy}
                onClick={() => void undoLastSavedWorkspacePatch()}
                type="button"
              >
                Schreiben rückgängig
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-dbzs-muted">
              {activeFileName ? "Kein Undo verfügbar." : "Keine Datei geöffnet."}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">
              Restore Points ({restorePoints.length})
            </div>
            <div className="flex items-center gap-1">
              <button
                className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[10px] text-dbzs-text hover:bg-dbzs-panel disabled:opacity-50"
                disabled={isRestorePointsLoading}
                onClick={() => void refreshRestorePoints()}
                type="button"
              >
                Aktualisieren
              </button>
              <button
                className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-0.5 text-[10px] text-dbzs-cyan hover:bg-dbzs-cyan/20 disabled:opacity-50"
                disabled={isRestorePointsLoading}
                onClick={() => void createManualRestorePoint()}
                type="button"
              >
                + Neu
              </button>
              <button
                className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[10px] text-dbzs-muted hover:text-dbzs-text disabled:opacity-50"
                disabled={isRestorePointsLoading}
                onClick={() => void repairRestorePointIndex()}
                title="Restore-Point-Index aus den vorhandenen Dateien auf der Festplatte neu aufbauen — hilft, wenn der Index beschaedigt ist und Punkte fehlen, die eigentlich noch existieren."
                type="button"
              >
                🔧 Reparieren
              </button>
            </div>
          </div>

          {restorePointsError ? (
            <div className="border border-dbzs-red/30 bg-dbzs-red/5 px-2 py-1 text-[11px] text-dbzs-red">
              {restorePointsError}
            </div>
          ) : null}

          {restorePointsRepairStatus ? (
            <div className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-muted">
              {restorePointsRepairStatus}
            </div>
          ) : null}

          {isRestorePointsLoading ? (
            <p className="text-[11px] text-dbzs-muted">Lade Restore Points...</p>
          ) : restorePoints.length === 0 ? (
            <p className="text-[11px] text-dbzs-muted">Keine Restore Points vorhanden.</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-auto">
              {restorePoints.map((point) => (
                <div
                  className="border border-dbzs-border bg-dbzs-bg p-2 text-[11px]"
                  key={point.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-dbzs-text">{point.label}</div>
                      <div className="mt-0.5 text-[10px] text-dbzs-muted">
                        {new Date(point.createdAt).toLocaleString("de-DE")} · {point.files.length} Datei
                        {point.files.length !== 1 ? "en" : ""}
                        {point.gitBranch ? ` · ${point.gitBranch}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        className="border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[10px] text-dbzs-text hover:bg-dbzs-panel disabled:opacity-50"
                        disabled={busyRestorePointId === point.id}
                        onClick={() => void restoreFromPoint(point.id)}
                        title="Wiederherstellen"
                        type="button"
                      >
                        {busyRestorePointId === point.id ? "..." : "↩"}
                      </button>
                      <button
                        className="border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[10px] text-dbzs-red hover:bg-dbzs-red/10 disabled:opacity-50"
                        disabled={busyRestorePointId === point.id}
                        onClick={() => void deleteRestorePoint(point.id)}
                        title="Löschen"
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] capitalize text-dbzs-muted">{point.reason.replace(/_/g, " ")}</div>
                </div>
              ))}
            </div>
          )}

          {restorePoints.length >= 10 ? (
            <button
              className="w-full border border-dbzs-border bg-dbzs-bg py-1 text-[11px] text-dbzs-muted hover:text-dbzs-text disabled:opacity-50"
              disabled={isRestorePointsLoading}
              onClick={() => void cleanupRestorePoints()}
              type="button"
            >
              Alte Punkte bereinigen
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
