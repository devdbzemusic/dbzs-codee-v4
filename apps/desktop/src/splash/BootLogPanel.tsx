import { useMemo, useState } from "react";
import type { BootLogEntry, BootLogLevel, BootState } from "@dbzs/shared";

const LEVEL_COLORS: Record<BootLogLevel, string> = {
  trace: "text-dbzs-muted",
  debug: "text-dbzs-muted",
  info: "text-dbzs-text",
  warn: "text-dbzs-amber",
  error: "text-dbzs-red",
  fatal: "text-dbzs-red"
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

export function BootLogPanel({ state }: { state: BootState }) {
  const [open, setOpen] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const entries = useMemo(() => {
    const all: BootLogEntry[] = state.phases.flatMap((phase) => phase.details);
    all.sort((a, b) => a.timestamp - b.timestamp);
    return sourceFilter === "all" ? all : all.filter((entry) => entry.source === sourceFilter);
  }, [state, sourceFilter]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const phase of state.phases) {
      for (const entry of phase.details) set.add(entry.source);
    }
    return Array.from(set).sort();
  }, [state]);

  return (
    <div className="border-t border-dbzs-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-xs text-dbzs-muted hover:text-dbzs-text"
      >
        <span>Diagnose &amp; Logs ({entries.length})</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <div className="flex gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setSourceFilter("all")}
              className={`rounded px-1.5 py-0.5 ${sourceFilter === "all" ? "bg-dbzs-cyan/20 text-dbzs-cyan" : "text-dbzs-muted"}`}
            >
              alle
            </button>
            {sources.map((source) => (
              <button
                key={source}
                type="button"
                onClick={() => setSourceFilter(source)}
                className={`rounded px-1.5 py-0.5 ${sourceFilter === source ? "bg-dbzs-cyan/20 text-dbzs-cyan" : "text-dbzs-muted"}`}
              >
                {source}
              </button>
            ))}
          </div>
          <div className="max-h-40 overflow-y-auto rounded-md bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
            {entries.length === 0 ? (
              <div className="text-dbzs-muted">Noch keine Log-Einträge.</div>
            ) : (
              entries.map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} className={LEVEL_COLORS[entry.level]}>
                  <span className="text-dbzs-muted">[{formatTime(entry.timestamp)}]</span>{" "}
                  <span className="text-dbzs-muted">{entry.source}</span>{" "}
                  <span className="uppercase">{entry.level}</span> {entry.event}: {entry.message}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
