import type { AgentActivityFilter, AgentEvent } from "@dbzs/shared";

const FILTERS: AgentActivityFilter[] = ["all", "tools", "files", "commands", "reviews", "errors"];

function matchesFilter(event: AgentEvent, filter: AgentActivityFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "errors") {
    return event.severity === "error" || event.eventType.endsWith(".failed");
  }
  if (filter === "tools") {
    return event.eventType.startsWith("tool.");
  }
  if (filter === "files") {
    return event.eventType.startsWith("file.");
  }
  if (filter === "commands") {
    return event.eventType.startsWith("command.");
  }
  if (filter === "reviews") {
    return event.eventType.startsWith("review.") || event.eventType === "file.change_proposed";
  }
  return true;
}

export type AgentActivityStreamProps = {
  events: AgentEvent[];
  filter: AgentActivityFilter;
  onFilterChange: (filter: AgentActivityFilter) => void;
  onOpenFile?: (filePath: string) => void;
};

export function AgentActivityStream({
  events,
  filter,
  onFilterChange,
  onOpenFile
}: AgentActivityStreamProps) {
  const filtered = events.filter((event) => matchesFilter(event, filter));

  return (
    <section className="flex min-h-0 flex-1 flex-col border border-dbzs-border bg-dbzs-panelSoft">
      <div className="border-b border-dbzs-border p-3">
        <h3 className="text-sm font-medium text-dbzs-text">Activity Stream</h3>
        <div className="mt-2 flex flex-wrap gap-1">
          {FILTERS.map((entry) => (
            <button
              className={`border px-2 py-0.5 text-[10px] ${
                filter === entry
                  ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan"
                  : "border-dbzs-border bg-dbzs-bg text-dbzs-muted hover:text-dbzs-text"
              }`}
              key={entry}
              onClick={() => onFilterChange(entry)}
              type="button"
            >
              {entry}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="text-xs text-dbzs-muted">Keine Events für diesen Filter.</div>
        ) : (
          <div className="space-y-2">
            {filtered
              .slice()
              .reverse()
              .map((event) => {
                const filePath =
                  typeof event.payload.file_path === "string" ? event.payload.file_path : null;
                return (
                  <details
                    className="border border-dbzs-border bg-dbzs-bg p-2 text-[11px]"
                    key={event.id}
                  >
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-dbzs-text">{event.summary}</div>
                          <div className="mt-1 text-dbzs-muted">
                            {event.eventType}
                            {event.stepId ? ` · step ${event.stepId}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-dbzs-muted">
                          <div>{new Date(event.createdAt).toLocaleTimeString()}</div>
                          <div>#{event.sequence}</div>
                        </div>
                      </div>
                    </summary>
                    <div className="mt-2 space-y-2 border-t border-dbzs-border pt-2">
                      {filePath ? (
                        <button
                          className="text-dbzs-cyan hover:underline"
                          onClick={() => onOpenFile?.(filePath)}
                          type="button"
                        >
                          {filePath}
                        </button>
                      ) : null}
                      <pre className="overflow-x-auto whitespace-pre-wrap text-[10px] text-dbzs-muted">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </div>
                  </details>
                );
              })}
          </div>
        )}
      </div>
    </section>
  );
}
