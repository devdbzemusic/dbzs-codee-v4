import { useEffect } from "react";
import { useGitStore } from "@/stores/gitStore";

export function GitPanel() {
  const repositoryStatus = useGitStore((state) => state.repositoryStatus);
  const currentBranch = useGitStore((state) => state.currentBranch);
  const changedEntries = useGitStore((state) => state.changedEntries);
  const diffSummary = useGitStore((state) => state.diffSummary);
  const selectedFilePath = useGitStore((state) => state.selectedFilePath);
  const selectedDiff = useGitStore((state) => state.selectedDiff);
  const commitSuggestion = useGitStore((state) => state.commitSuggestion);
  const commitSuggestions = useGitStore((state) => state.commitSuggestions);
  const selectedCommitSuggestionId = useGitStore((state) => state.selectedCommitSuggestionId);
  const draftCommitTitle = useGitStore((state) => state.draftCommitTitle);
  const draftCommitBody = useGitStore((state) => state.draftCommitBody);
  const selectedCommitFiles = useGitStore((state) => state.selectedCommitFiles);
  const commitWarnings = useGitStore((state) => state.commitWarnings);
  const lastCommitHash = useGitStore((state) => state.lastCommitHash);
  const isCommitting = useGitStore((state) => state.isCommitting);
  const restorePoints = useGitStore((state) => state.restorePoints);
  const isRestorePointsLoading = useGitStore((state) => state.isRestorePointsLoading);
  const restorePointsError = useGitStore((state) => state.restorePointsError);
  const busyRestorePointId = useGitStore((state) => state.busyRestorePointId);
  const isLoading = useGitStore((state) => state.isLoading);
  const error = useGitStore((state) => state.error);
  const refreshGitStatus = useGitStore((state) => state.refreshGitStatus);
  const selectDiffFile = useGitStore((state) => state.selectDiffFile);
  const generateCommitSuggestions = useGitStore((state) => state.generateCommitSuggestions);
  const selectCommitSuggestion = useGitStore((state) => state.selectCommitSuggestion);
  const setDraftCommitTitle = useGitStore((state) => state.setDraftCommitTitle);
  const setDraftCommitBody = useGitStore((state) => state.setDraftCommitBody);
  const toggleCommitFile = useGitStore((state) => state.toggleCommitFile);
  const selectAllCommitFiles = useGitStore((state) => state.selectAllCommitFiles);
  const createCommit = useGitStore((state) => state.createCommit);
  const refreshRestorePoints = useGitStore((state) => state.refreshRestorePoints);
  const createManualRestorePoint = useGitStore((state) => state.createManualRestorePoint);
  const restoreFromPoint = useGitStore((state) => state.restoreFromPoint);
  const deleteRestorePoint = useGitStore((state) => state.deleteRestorePoint);
  const cleanupRestorePoints = useGitStore((state) => state.cleanupRestorePoints);

  useEffect(() => {
    void refreshGitStatus();
    void generateCommitSuggestions();
    void refreshRestorePoints();
  }, [generateCommitSuggestions, refreshGitStatus, refreshRestorePoints]);

  const handleRestorePoint = async (restorePointId: string) => {
    const approved = typeof window.confirm === "function"
      ? window.confirm("Restore Point jetzt anwenden? Aktuelle Dateien werden auf den gespeicherten Zustand zurueckgesetzt.")
      : true;
    if (!approved) {
      return;
    }

    await restoreFromPoint(restorePointId);
  };

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Git Intelligence</h3>
          <p className="text-[11px] text-dbzs-muted">Branch, Status, Diffs und Commit-Kontext ohne automatische Git-Aktionen.</p>
        </div>
        <button
          className="rounded border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text disabled:opacity-40"
          disabled={isLoading}
          onClick={() => void refreshGitStatus()}
          type="button"
        >
          Git Status aktualisieren
        </button>
      </div>

      <div className="mt-3 space-y-1 text-[11px] text-dbzs-muted">
        <div>Repository: {repositoryStatus ? (repositoryStatus.isRepository ? "ja" : "nein") : "-"}</div>
        <div>Branch: {currentBranch || "-"}</div>
        <div>
          Upstream: {repositoryStatus?.hasUpstream === false ? "nein" : repositoryStatus?.hasUpstream === true ? "ja" : "-"}
        </div>
        <div>
          Divergence: ↑{repositoryStatus?.aheadCount ?? 0} / ↓{repositoryStatus?.behindCount ?? 0}
        </div>
        <div>Uncommitted: {repositoryStatus?.hasUncommittedChanges ? "ja" : "nein"}</div>
        <div>Changed Files: {changedEntries.length}</div>
      </div>

      {error ? <p className="mt-2 text-xs text-dbzs-red">{error}</p> : null}

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <button
          className={`rounded border px-2 py-1 ${selectedFilePath === null ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan" : "border-dbzs-border bg-dbzs-bg text-dbzs-text"}`}
          onClick={() => void selectDiffFile(null)}
          type="button"
        >
          Gesamt-Diff
        </button>
        {diffSummary.slice(0, 8).map((entry) => (
          <button
            className={`truncate rounded border px-2 py-1 text-left ${selectedFilePath === entry.filePath ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan" : "border-dbzs-border bg-dbzs-bg text-dbzs-text"}`}
            key={entry.filePath}
            onClick={() => void selectDiffFile(entry.filePath)}
            type="button"
          >
            {entry.filePath} (+{entry.additions}/-{entry.deletions})
          </button>
        ))}
      </div>

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Geaenderte Dateien</div>
        <div className="mt-1 space-y-1">
          {changedEntries.length === 0 ? (
            <p className="text-[11px] text-dbzs-muted">Keine lokalen Aenderungen erkannt.</p>
          ) : (
            changedEntries.map((entry) => (
              <div className="truncate border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text" key={`${entry.filePath}:${entry.status}`}>
                [{entry.status}] {entry.filePath}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Diff</div>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words border border-dbzs-border bg-dbzs-bg p-2 text-[10px] text-dbzs-muted">
          {selectedDiff || "-"}
        </pre>
      </div>

      <div className="mt-3 border border-dbzs-border bg-dbzs-bg p-2 text-[11px]">
        <div className="text-dbzs-muted">Commit-Vorschlag</div>
        <div className="mt-1 text-dbzs-text">{commitSuggestion?.title ?? "-"}</div>
        {commitSuggestion?.body ? <div className="mt-1 text-dbzs-muted">{commitSuggestion.body}</div> : null}
        {commitSuggestion ? (
          <div className="mt-1 text-dbzs-muted">
            Risk: {commitSuggestion.riskLevel} · Files: {commitSuggestion.affectedFiles.length}
          </div>
        ) : null}
      </div>

      <div className="mt-3 border border-dbzs-border bg-dbzs-bg p-2 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <div className="text-dbzs-muted">Commit Assistant</div>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-muted"
              onClick={() => selectAllCommitFiles()}
              type="button"
            >
              Alle Dateien
            </button>
            <button
              className="rounded border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-muted"
              disabled={isLoading}
              onClick={() => void generateCommitSuggestions()}
              type="button"
            >
              Vorschlaege aktualisieren
            </button>
          </div>
        </div>

        <div className="mt-2 space-y-1">
          {changedEntries.length === 0 ? (
            <div className="text-dbzs-muted">Keine Dateien fuer Commit verfuegbar.</div>
          ) : (
            changedEntries.map((entry) => {
              const selected = selectedCommitFiles.includes(entry.filePath);
              return (
                <label className="flex items-center gap-2 border border-dbzs-border bg-dbzs-panel px-2 py-1" key={`commit-file-${entry.filePath}`}>
                  <input
                    checked={selected}
                    onChange={() => toggleCommitFile(entry.filePath)}
                    type="checkbox"
                  />
                  <span className="text-dbzs-muted">[{entry.status}]</span>
                  <span className="truncate text-dbzs-text">{entry.filePath}</span>
                </label>
              );
            })
          )}
        </div>

        <div className="mt-2 grid grid-cols-1 gap-1">
          {commitSuggestions.map((suggestion) => {
            const selected = selectedCommitSuggestionId === suggestion.id;
            return (
              <button
                className={`rounded border px-2 py-1 text-left ${selected ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan" : "border-dbzs-border bg-dbzs-panel text-dbzs-text"}`}
                key={suggestion.id}
                onClick={() => selectCommitSuggestion(suggestion.id)}
                type="button"
              >
                {suggestion.title}
              </button>
            );
          })}
          {commitSuggestions.length === 0 ? <div className="text-dbzs-muted">Keine Commit-Vorschlaege vorhanden.</div> : null}
        </div>

        <label className="mt-2 block text-dbzs-muted">Titel</label>
        <input
          className="mt-1 w-full border border-dbzs-border bg-dbzs-panel px-2 py-1 text-dbzs-text"
          onChange={(event) => setDraftCommitTitle(event.currentTarget.value)}
          placeholder="type(scope): short summary"
          value={draftCommitTitle}
        />

        <label className="mt-2 block text-dbzs-muted">Body</label>
        <textarea
          className="mt-1 h-20 w-full resize-none border border-dbzs-border bg-dbzs-panel px-2 py-1 text-dbzs-text"
          onChange={(event) => setDraftCommitBody(event.currentTarget.value)}
          placeholder="Optional details"
          value={draftCommitBody}
        />

        <div className="mt-2 space-y-1">
          {commitWarnings.map((warning) => (
            <div className="border border-dbzs-amber/60 bg-dbzs-amber/10 px-2 py-1 text-dbzs-amber" key={warning}>{warning}</div>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            className="rounded border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
            disabled={isCommitting || selectedCommitFiles.length === 0 || draftCommitTitle.trim().length === 0}
            onClick={() => void createCommit()}
            type="button"
          >
            Commit erstellen
          </button>
          {lastCommitHash ? <div className="text-dbzs-cyan">Commit: {lastCommitHash}</div> : null}
        </div>
      </div>

      <div className="mt-3 border border-dbzs-border bg-dbzs-bg p-2 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <div className="text-dbzs-muted">Restore / Safety</div>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-muted"
              disabled={isRestorePointsLoading}
              onClick={() => void createManualRestorePoint()}
              type="button"
            >
              Restore Point erstellen
            </button>
            <button
              className="rounded border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-muted"
              disabled={isRestorePointsLoading}
              onClick={() => void refreshRestorePoints()}
              type="button"
            >
              Aktualisieren
            </button>
            <button
              className="rounded border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-muted"
              disabled={isRestorePointsLoading}
              onClick={() => void cleanupRestorePoints()}
              type="button"
            >
              Aufraeumen
            </button>
          </div>
        </div>

        {restorePointsError ? <div className="mt-2 border border-dbzs-red/60 bg-dbzs-red/10 px-2 py-1 text-dbzs-red">{restorePointsError}</div> : null}

        <div className="mt-2 space-y-2">
          {isRestorePointsLoading ? (
            <div className="text-dbzs-muted">Restore Points werden geladen...</div>
          ) : restorePoints.length === 0 ? (
            <div className="text-dbzs-muted">Keine Restore Points vorhanden.</div>
          ) : (
            restorePoints.map((point) => {
              const isBusy = busyRestorePointId === point.id;
              return (
                <div className="border border-dbzs-border bg-dbzs-panel p-2" key={point.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-dbzs-text">{point.label}</div>
                      <div className="text-[10px] text-dbzs-muted">
                        {new Date(point.createdAt).toLocaleString()} · Grund: {point.reason}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[10px] text-dbzs-cyan disabled:opacity-40"
                        disabled={isBusy}
                        onClick={() => {
                          void handleRestorePoint(point.id);
                        }}
                        type="button"
                      >
                        Wiederherstellen
                      </button>
                      <button
                        className="rounded border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-text disabled:opacity-40"
                        disabled={isBusy}
                        onClick={() => {
                          void deleteRestorePoint(point.id);
                        }}
                        type="button"
                      >
                        Loeschen
                      </button>
                    </div>
                  </div>

                  <div className="mt-1 text-[10px] text-dbzs-muted">
                    Dateien: {point.files.map((file) => file.filePath).join(", ") || "-"}
                  </div>
                  <div className="mt-1 text-[10px] text-dbzs-muted">
                    Git: {point.gitHead ?? "-"} {point.gitBranch ? `(${point.gitBranch})` : ""}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
