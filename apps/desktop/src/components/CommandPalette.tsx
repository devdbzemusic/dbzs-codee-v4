import { useEffect, useMemo, useRef, useState } from "react";
import { useJobSpoolerStore } from "@/stores/jobSpoolerStore";
import { useAgentRegistryStore } from "@/stores/agentRegistryStore";
import { useCommandPaletteStore } from "@/stores/commandPaletteStore";
import { runAppMenuAction } from "@/hooks/useAppMenuActions";
import type { AppMenuAction } from "@/types/appMenu";
import { openRuntimeChatWindow } from "@/utils/runtimeChatWindow";
import { openPlatformDiagnosticsWindow } from "@/utils/platformDiagnosticsWindow";

// ---------------------------------------------------------------------------
// Command entries
// ---------------------------------------------------------------------------

interface PaletteEntry {
  id: string;
  label: string;
  category: string;
  detail?: string;
  action: () => void;
}

function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const found = h.indexOf(n[ni], hi);
    if (found === -1) return false;
    hi = found + 1;
  }
  return true;
}

const STATIC_COMMANDS: Array<Omit<PaletteEntry, "action"> & { actionKey: AppMenuAction | "reloadBackend" | "openRuntimeChat" | "openSettings" | "openPlatformDiagnostics" }> = [
  { id: "new-project", label: "Neues Projekt…", category: "Datei", actionKey: "new-project" },
  { id: "open-project", label: "Projekt öffnen…", category: "Datei", actionKey: "open-project" },
  { id: "new-file", label: "Neue Datei…", category: "Datei", actionKey: "new-file" },
  { id: "new-folder", label: "Neuer Ordner…", category: "Datei", actionKey: "new-folder" },
  { id: "open-file", label: "Datei öffnen…", category: "Datei", actionKey: "open-file" },
  { id: "save-file", label: "Speichern", category: "Datei", actionKey: "save-file" },
  { id: "save-file-as", label: "Speichern unter…", category: "Datei", actionKey: "save-file-as" },
  { id: "save-workspace", label: "Workspace speichern", category: "Datei", actionKey: "save-workspace" },
  { id: "reload-backend", label: "Backend neu laden", category: "System", actionKey: "reloadBackend" },
  { id: "open-runtime-chat", label: "Runtime Chat abspalten", category: "Runtime", actionKey: "openRuntimeChat" },
  { id: "open-platform-diagnostics", label: "Plattform-Diagnose öffnen", category: "System", actionKey: "openPlatformDiagnostics" },
  { id: "open-settings", label: "Einstellungen öffnen", category: "System", actionKey: "openSettings" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const { open, query, closePalette, setQuery } = useCommandPaletteStore();
  const jobs = useJobSpoolerStore((s) => s.jobs);
  const selectJob = useJobSpoolerStore((s) => s.selectJob);
  const agents = useAgentRegistryStore((s) => s.agents);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      setActiveIndex(0);
    }
  }, [open]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const all: PaletteEntry[] = [
      ...STATIC_COMMANDS.map((cmd) => ({
        ...cmd,
        action: () => {
          if (cmd.actionKey === "reloadBackend") window.dbzs?.reloadBackend?.();
          else if (cmd.actionKey === "openSettings") window.dbzs?.openSettingsWindow?.();
          else if (cmd.actionKey === "openRuntimeChat") void openRuntimeChatWindow();
          else if (cmd.actionKey === "openPlatformDiagnostics") void openPlatformDiagnosticsWindow();
          else runAppMenuAction(cmd.actionKey);
        },
      })),
      ...jobs.slice(0, 20).map((job) => ({
        id: `job-${job.id}`,
        label: job.title,
        category: "Job",
        detail: `${job.status} · P${job.priority}`,
        action: () => void selectJob(job.id),
      })),
      ...agents.slice(0, 10).map((agent) => ({
        id: `agent-${agent.id}`,
        label: agent.name,
        category: "Agent",
        detail: agent.role,
        action: () => { /* select agent in registry */ },
      })),
    ];
    return all.filter((e) => fuzzyMatch(`${e.label} ${e.category} ${e.detail ?? ""}`, query));
  }, [query, jobs, selectJob, agents]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { closePalette(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, entries.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && entries[activeIndex]) {
      entries[activeIndex].action();
      closePalette();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[8888] flex items-start justify-center pt-[15vh]"
      onClick={closePalette}
      onKeyDown={(e) => { if (e.key === "Escape") closePalette(); }}
      role="presentation"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Panel */}
      <div
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-lg border border-dbzs-border bg-dbzs-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-label="Befehlspalette"
      >
        <div className="flex items-center gap-3 border-b border-dbzs-border px-4 py-3">
          <span className="text-dbzs-muted text-sm">⌕</span>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-dbzs-text placeholder:text-dbzs-muted focus:outline-none"
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Suchen — Jobs, Agents, Aktionen…"
            type="text"
            value={query}
          />
          <kbd className="rounded border border-dbzs-border px-1.5 py-0.5 text-[10px] text-dbzs-muted">Esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {entries.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-dbzs-muted">Keine Treffer für „{query}"</p>
          ) : (
            entries.map((entry, i) => (
              <button
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-xs transition ${
                  i === activeIndex
                    ? "bg-dbzs-cyan/10 text-dbzs-cyan"
                    : "text-dbzs-text hover:bg-dbzs-panelSoft"
                }`}
                key={entry.id}
                onClick={() => { entry.action(); closePalette(); }}
                onMouseEnter={() => setActiveIndex(i)}
                type="button"
              >
                <span className="w-14 shrink-0 text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">{entry.category}</span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.detail && <span className="shrink-0 text-[10px] text-dbzs-muted">{entry.detail}</span>}
              </button>
            ))
          )}
        </div>

        <div className="border-t border-dbzs-border px-4 py-1.5 text-[10px] text-dbzs-muted">
          <span className="mr-3">↑↓ navigieren</span><span className="mr-3">↵ ausführen</span><span>Esc schließen</span>
        </div>
      </div>
    </div>
  );
}
