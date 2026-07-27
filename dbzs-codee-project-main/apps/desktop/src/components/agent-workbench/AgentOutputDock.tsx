import type { AgentEvent, AgentOutputTab } from "@dbzs/shared";

const OUTPUT_TABS: AgentOutputTab[] = ["agent", "commands", "tests", "problems", "artifacts"];

function filterEvents(events: AgentEvent[], tab: AgentOutputTab): AgentEvent[] {
  switch (tab) {
    case "agent":
      return events.filter(
        (event) =>
          event.eventType.startsWith("run.") ||
          event.eventType.startsWith("step.") ||
          event.eventType.startsWith("followup.") ||
          event.eventType.startsWith("tool.")
      );
    case "commands":
      return events.filter((event) => event.eventType.startsWith("command."));
    case "tests":
      return events.filter(
        (event) =>
          event.eventType.startsWith("diagnostic.") ||
          (typeof event.payload.kind === "string" && event.payload.kind === "test")
      );
    case "problems":
      return events.filter(
        (event) => event.severity === "error" || event.severity === "warning" || event.eventType.endsWith(".failed")
      );
    case "artifacts":
      return events.filter(
        (event) =>
          typeof event.payload.artifact_id === "string" ||
          typeof event.payload.artifact_name === "string"
      );
    default: {
      const unknown: never = tab;
      return events.filter(() => unknown === tab);
    }
  }
}

export type AgentOutputDockProps = {
  events: AgentEvent[];
  activeTab: AgentOutputTab;
  onTabChange: (tab: AgentOutputTab) => void;
};

export function AgentOutputDock({ events, activeTab, onTabChange }: AgentOutputDockProps) {
  const filtered = filterEvents(events, activeTab);

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft">
      <div className="flex flex-wrap gap-1 border-b border-dbzs-border p-2">
        {OUTPUT_TABS.map((tab) => (
          <button
            className={`border px-2 py-1 text-[10px] ${
              activeTab === tab
                ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan"
                : "border-dbzs-border bg-dbzs-bg text-dbzs-muted"
            }`}
            key={tab}
            onClick={() => onTabChange(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="max-h-40 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="text-xs text-dbzs-muted">Keine Ausgabe für diesen Tab.</div>
        ) : (
          <div className="space-y-1">
            {filtered
              .slice()
              .reverse()
              .slice(0, 30)
              .map((event) => (
                <div className="border border-dbzs-border bg-dbzs-bg p-2 text-[10px]" key={event.id}>
                  <div className="text-dbzs-text">{event.summary}</div>
                  <div className="text-dbzs-muted">
                    {event.eventType} · {new Date(event.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}
