import type { CommandRunStatus, ProposedChange, DebugAnalysis } from "@dbzs/shared";

interface DebugAgentPanelProps {
  analyses: DebugAnalysis[];
  affectedFiles: string[];
  error: string | null;
  generatedProposedChanges: ProposedChange[];
  isAnalyzing: boolean;
  lastRun: CommandRunStatus | null;
  onGenerateFixSuggestions: () => void;
  onApplyProposedChange: (filePath: string) => void;
  onRejectProposedChange: (proposedChangeId: string) => void;
  onShowProposedDiff: (filePath: string) => void;
  rawLogs: string;
  stdout: string;
  stderr: string;
  summary: string;
}

export function DebugAgentPanel({
  analyses,
  affectedFiles,
  error,
  generatedProposedChanges,
  isAnalyzing,
  lastRun,
  onGenerateFixSuggestions,
  onApplyProposedChange,
  onRejectProposedChange,
  onShowProposedDiff,
  rawLogs,
  stdout,
  stderr,
  summary
}: DebugAgentPanelProps) {
  const hasAnalyses = analyses.length > 0;

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Debug Agent</h3>
          <p className="mt-1 text-[11px] text-dbzs-muted">
            Analysiert fehlgeschlagene Runs und bereitet nur sichere ProposedChanges vor.
          </p>
        </div>
        <button
          className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
          disabled={!hasAnalyses || isAnalyzing}
          onClick={onGenerateFixSuggestions}
          type="button"
        >
          {isAnalyzing ? "Analysiere ..." : "Fix-Vorschlag anzeigen"}
        </button>
      </div>

      <div className="mt-3 text-[11px] text-dbzs-muted">
        <div>Status: {lastRun ? `${lastRun.label} · ${lastRun.status}` : "keine Laufdaten"}</div>
        <div className="mt-1">Debug Summary: {summary || "keine Analyse"}</div>
      </div>

      <div className="mt-3 space-y-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Betroffene Dateien</div>
          {affectedFiles.length === 0 ? (
            <p className="text-[11px] text-dbzs-muted">Keine Dateien erkannt.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-[11px] text-dbzs-text">
              {affectedFiles.map((filePath) => (
                <li className="truncate border border-dbzs-border bg-dbzs-bg px-2 py-1" key={filePath}>
                  {filePath}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Letzte Fehler</div>
          <div className="mt-1 space-y-2">
            <pre className="max-h-28 overflow-auto border border-dbzs-border bg-dbzs-bg p-2 text-[10px] text-dbzs-muted">{stdout || "-"}</pre>
            <pre className="max-h-28 overflow-auto border border-dbzs-border bg-dbzs-bg p-2 text-[10px] text-dbzs-muted">{stderr || "-"}</pre>
            {rawLogs ? <pre className="max-h-28 overflow-auto border border-dbzs-border bg-dbzs-bg p-2 text-[10px] text-dbzs-muted">{rawLogs}</pre> : null}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Analysen</div>
          {analyses.length === 0 ? (
            <p className="text-[11px] text-dbzs-muted">Noch keine auswertbaren Fehlerlogs.</p>
          ) : (
            <div className="mt-1 space-y-2">
              {analyses.map((analysis) => (
                <div className="border border-dbzs-border bg-dbzs-bg p-2 text-[11px] text-dbzs-text" key={analysis.id}>
                  <div className="font-medium">{analysis.summary}</div>
                  <div className="mt-1 text-dbzs-muted">Ursache: {analysis.probableCause}</div>
                  <div className="mt-1 text-dbzs-muted">Fixes: {analysis.suggestedFixes.join(" | ")}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Fix-Vorschlaege</div>
          {generatedProposedChanges.length === 0 ? (
            <p className="text-[11px] text-dbzs-muted">Noch kein vorgeschlagener Fix.</p>
          ) : (
            <div className="mt-1 space-y-2">
              {generatedProposedChanges.map((change) => (
                <div className="space-y-1 border border-dbzs-border bg-dbzs-panel p-2" key={change.id}>
                  <div className="truncate text-[11px] font-medium text-dbzs-text">{change.filePath}</div>
                  <div className="text-[11px] text-dbzs-muted">Grund: {change.reason}</div>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text"
                      onClick={() => onShowProposedDiff(change.filePath)}
                      type="button"
                    >
                      Diff anzeigen
                    </button>
                    <button
                      className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[11px] text-dbzs-cyan"
                      onClick={() => onApplyProposedChange(change.filePath)}
                      type="button"
                    >
                      Anwenden
                    </button>
                    <button
                      className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text"
                      onClick={() => onRejectProposedChange(change.id)}
                      type="button"
                    >
                      Verwerfen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}