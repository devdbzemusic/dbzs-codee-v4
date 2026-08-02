/*
 * DBZS – Division By Zeros
 * Datei: DebugLogPanel.tsx
 * Bereich: Desktop / App Shell / Right Sidebar
 *
 * Zweck:
 *   Live-scrollendes Debug-/Observer-Log — zeigt jedes RuntimeChatEvent des
 *   aktiven Runs und jedes ObservabilityEvent, sobald es passiert.
 *
 * Warum:
 *   Nutzerwunsch: "Hier soll wirklich jeder einzelne Furz zu sehen sein, den
 *   die App macht." ObservabilityService.onEvent() existierte bereits fertig
 *   implementiert, hatte aber null Abonnenten — dieses Panel ist der erste.
 */
import { useEffect, useRef, useState } from "react";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { observabilityService } from "@/runtime/observability/observabilityService";
import type { ObservabilityEvent } from "@/runtime/observability/chatSessionTrace";

const MAX_ENTRIES = 2000;
const BOTTOM_THRESHOLD_PX = 32;

interface LogEntry {
  id: string;
  timestamp: number;
  source: "runtime" | "observability";
  label: string;
  detail?: string;
}

function formatTime(ms: number): string {
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const mmm = String(date.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${mmm}`;
}

function describeObservabilityEvent(event: ObservabilityEvent): { label: string; detail?: string } {
  switch (event.type) {
    case "chat_session_started":
      return { label: `session_started · ${event.trace.targetAgent}`, detail: event.trace.sessionId };
    case "chat_session_finished":
      return { label: `session_finished · ${event.trace.status}`, detail: event.trace.sessionId };
    case "chat_message_sent":
      return { label: `message_sent · ${event.message.role}`, detail: event.message.content?.slice(0, 200) };
    case "context_proof_created":
      return { label: "context_proof_created", detail: event.sessionId };
    case "agent_handoff_initiated":
      return { label: `agent_handoff_initiated · ${event.handoff.toAgent}`, detail: event.sessionId };
    case "agent_handoff_completed":
      return { label: "agent_handoff_completed", detail: event.output?.slice(0, 200) };
    case "tool_execution_started":
      return { label: `tool_execution_started · ${event.toolCall.toolName}`, detail: event.sessionId };
    case "tool_execution_completed":
      return { label: "tool_execution_completed", detail: JSON.stringify(event.output)?.slice(0, 200) };
    default:
      return { label: (event as { type: string }).type };
  }
}

function appendCapped(entries: LogEntry[], next: LogEntry[]): LogEntry[] {
  if (next.length === 0) return entries;
  const merged = [...entries, ...next];
  return merged.length > MAX_ENTRIES ? merged.slice(merged.length - MAX_ENTRIES) : merged;
}

export function DebugLogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [stickToBottom, setStickToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seenRunEventCounts = useRef<Map<string, number>>(new Map());

  const activeRun = useRuntimeChatStore((state) => state.activeRun);
  const historicalRuns = useRuntimeChatStore((state) => state.historicalRuns);

  // Observability events: subscribe once, this is the previously-unwired pub/sub.
  useEffect(() => {
    const unsubscribe = observabilityService.onEvent((event) => {
      const { label, detail } = describeObservabilityEvent(event);
      setEntries((prev) =>
        appendCapped(prev, [
          { id: `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, timestamp: Date.now(), source: "observability", label, detail }
        ])
      );
    });
    return unsubscribe;
  }, []);

  // Runtime chat run events: diff against last-seen count per run so restarts /
  // multiple runs don't re-emit history, and so this stays cheap even with many
  // historical runs (only newly-appended events are appended to the log).
  useEffect(() => {
    const runsToCheck = [...(activeRun ? [activeRun] : []), ...Object.values(historicalRuns)];
    const newEntries: LogEntry[] = [];
    for (const run of runsToCheck) {
      const seenCount = seenRunEventCounts.current.get(run.id) ?? 0;
      if (run.events.length > seenCount) {
        for (const event of run.events.slice(seenCount)) {
          newEntries.push({
            id: `run-${run.id}-${event.id}`,
            timestamp: new Date(event.timestamp).getTime() || Date.now(),
            source: "runtime",
            label: event.type,
            detail: event.message
          });
        }
        seenRunEventCounts.current.set(run.id, run.events.length);
      }
    }
    if (newEntries.length > 0) {
      newEntries.sort((a, b) => a.timestamp - b.timestamp);
      setEntries((prev) => appendCapped(prev, newEntries));
    }
  }, [activeRun, historicalRuns]);

  useEffect(() => {
    if (!stickToBottom) return;
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [entries, stickToBottom]);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setStickToBottom(distanceFromBottom <= BOTTOM_THRESHOLD_PX);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-1">
        <span className="text-[10px] text-dbzs-muted">
          {entries.length} Eintraege{entries.length >= MAX_ENTRIES ? ` (letzte ${MAX_ENTRIES})` : ""}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="border border-dbzs-border px-2 py-1 text-[10px] text-dbzs-muted hover:border-dbzs-cyan/40"
            onClick={() => setEntries([])}
            type="button"
          >
            Leeren
          </button>
          {!stickToBottom ? (
            <button
              className="border border-dbzs-cyan/60 bg-dbzs-cyan/10 px-2 py-1 text-[10px] text-dbzs-cyan"
              onClick={() => setStickToBottom(true)}
              type="button"
            >
              Zum Ende springen
            </button>
          ) : (
            <span className="text-[10px] text-dbzs-cyan">Auto-Scroll aktiv</span>
          )}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto border-t border-dbzs-border/60 px-4 py-2 font-mono text-[10px] leading-4"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {entries.length === 0 ? (
          <p className="text-dbzs-muted">Noch keine Events. Sobald die App etwas tut, erscheint es hier live.</p>
        ) : (
          entries.map((entry) => (
            <div className="border-b border-dbzs-border/20 py-1" key={entry.id}>
              <span className="text-dbzs-muted">{formatTime(entry.timestamp)}</span>{" "}
              <span className={entry.source === "observability" ? "text-dbzs-amber" : "text-dbzs-cyan"}>
                [{entry.source}]
              </span>{" "}
              <span className="text-dbzs-text">{entry.label}</span>
              {entry.detail ? <span className="text-dbzs-muted"> — {entry.detail}</span> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
