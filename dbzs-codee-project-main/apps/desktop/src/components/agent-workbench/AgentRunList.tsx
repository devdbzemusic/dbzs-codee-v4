import type { AgentRun } from "@dbzs/shared";

export type AgentRunListProps = {
  runs: AgentRun[];
  selectedRunId: string | null;
  isLoading: boolean;
  newRunGoal: string;
  isMutating: boolean;
  onSelectRun: (runId: string) => void;
  onNewRunGoalChange: (goal: string) => void;
  onCreateRun: () => void;
  onRefresh: () => void;
};

export function AgentRunList({
  runs,
  selectedRunId,
  isLoading,
  newRunGoal,
  isMutating,
  onSelectRun,
  onNewRunGoalChange,
  onCreateRun,
  onRefresh
}: AgentRunListProps) {
  return (
    <section className="flex h-full min-h-0 flex-col border border-dbzs-border bg-dbzs-panelSoft">
      <div className="border-b border-dbzs-border p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-dbzs-text">Runs</h3>
          <button
            className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-muted hover:text-dbzs-text"
            onClick={onRefresh}
            type="button"
          >
            Refresh
          </button>
        </div>
        <textarea
          className="mt-2 h-16 w-full resize-y border border-dbzs-border bg-dbzs-bg p-2 text-xs text-dbzs-text"
          onChange={(event) => onNewRunGoalChange(event.currentTarget.value)}
          placeholder="Neues Run-Ziel…"
          value={newRunGoal}
        />
        <button
          className="mt-2 w-full border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-2 py-1 text-xs font-medium text-dbzs-cyan disabled:opacity-40"
          disabled={!newRunGoal.trim() || isMutating}
          onClick={onCreateRun}
          type="button"
        >
          Run erstellen
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? <div className="text-xs text-dbzs-muted">Lädt Runs…</div> : null}
        {!isLoading && runs.length === 0 ? (
          <div className="rounded border border-dashed border-dbzs-border p-3 text-center text-xs text-dbzs-muted">
            Noch keine Agent Runs.
          </div>
        ) : null}
        <div className="space-y-2">
          {runs.map((run) => {
            const isActive = run.id === selectedRunId;
            return (
              <button
                className={`w-full border p-2 text-left transition-colors ${
                  isActive
                    ? "border-dbzs-cyan/50 bg-dbzs-cyan/10"
                    : "border-dbzs-border bg-dbzs-bg hover:border-dbzs-cyan/30"
                }`}
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                type="button"
              >
                <div className="truncate text-xs font-medium text-dbzs-text">{run.goal}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-dbzs-muted">
                  <span>{run.status}</span>
                  <span>{new Date(run.updatedAt).toLocaleString()}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
