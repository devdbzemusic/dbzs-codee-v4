import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentRegistryStore } from "@/stores/agentRegistryStore";
import { useCommandPaletteStore, type RuntimeChatPresetId } from "@/stores/commandPaletteStore";
import { useJobSpoolerStore } from "@/stores/jobSpoolerStore";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import {
  WORKBENCH_LAYOUT_PRESET_LABELS,
  WORKBENCH_LAYOUT_PRESET_ORDER,
  useWorkbenchLayoutStore
} from "@/stores/workbenchLayoutStore";
import { runAppMenuAction } from "@/hooks/useAppMenuActions";
import type { AppMenuAction } from "@/types/appMenu";
import { openPlatformDiagnosticsWindow } from "@/utils/platformDiagnosticsWindow";
import { openRuntimeChatWindow } from "@/utils/runtimeChatWindow";

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

const RUNTIME_CHAT_PRESET_COMMANDS: Array<{ id: RuntimeChatPresetId; label: string; detail: string }> = [
  { id: "plan", label: "Preset: Implementierungsplan", detail: "Klare Schritte, Risiken und Tests vorschlagen" },
  { id: "refactor", label: "Preset: Sicherer Refactor", detail: "Kleine diff-freundliche Umbauten mit Validierung" },
  { id: "review", label: "Preset: Repository Review", detail: "Risiken, Regressionen und fehlende Tests prüfen" },
  { id: "summarize", label: "Preset: Stand zusammenfassen", detail: "Fortschritt, offene Punkte und nächsten Schritt komprimieren" },
  { id: "next_steps", label: "Preset: Nächste Schritte", detail: "Drei priorisierte Anschlussaktionen vorschlagen" }
];

const STATIC_COMMANDS: Array<
  Omit<PaletteEntry, "action"> & {
    actionKey:
      | AppMenuAction
      | "reloadBackend"
      | "openRuntimeChat"
      | "openSettings"
      | "openPlatformDiagnostics"
      | "openRuntimeChatCapabilities";
  }
> = [
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
  { id: "open-runtime-chat-capabilities", label: "Fähigkeiten-Übersicht öffnen", category: "Runtime", actionKey: "openRuntimeChatCapabilities" },
  { id: "open-platform-diagnostics", label: "Plattform-Diagnose öffnen", category: "System", actionKey: "openPlatformDiagnostics" },
  { id: "open-settings", label: "Einstellungen öffnen", category: "System", actionKey: "openSettings" }
];

export function CommandPalette() {
  const {
    open,
    query,
    closePalette,
    setQuery,
    requestRuntimeChatCapabilities,
    requestRuntimeChatPreset
  } = useCommandPaletteStore();
  const jobs = useJobSpoolerStore((state) => state.jobs);
  const selectJob = useJobSpoolerStore((state) => state.selectJob);
  const agents = useAgentRegistryStore((state) => state.agents);
  const applyWorkbenchPreset = useWorkbenchLayoutStore((state) => state.applyPreset);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, open, closePalette, inputRef);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      setActiveIndex(0);
    }
  }, [open]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const all: PaletteEntry[] = [
      ...STATIC_COMMANDS.map((command) => ({
        ...command,
        action: () => {
          if (command.actionKey === "reloadBackend") {
            window.dbzs?.reloadBackend?.();
          } else if (command.actionKey === "openSettings") {
            window.dbzs?.openSettingsWindow?.();
          } else if (command.actionKey === "openRuntimeChat") {
            void openRuntimeChatWindow();
          } else if (command.actionKey === "openRuntimeChatCapabilities") {
            requestRuntimeChatCapabilities();
          } else if (command.actionKey === "openPlatformDiagnostics") {
            void openPlatformDiagnosticsWindow();
          } else {
            runAppMenuAction(command.actionKey);
          }
        }
      })),
      ...RUNTIME_CHAT_PRESET_COMMANDS.map((preset) => ({
        id: `runtime-preset-${preset.id}`,
        label: preset.label,
        category: "Runtime",
        detail: preset.detail,
        action: () => requestRuntimeChatPreset(preset.id)
      })),
      ...WORKBENCH_LAYOUT_PRESET_ORDER.map((presetId) => ({
        id: `layout-preset-${presetId}`,
        label: `Layout: ${WORKBENCH_LAYOUT_PRESET_LABELS[presetId]}`,
        category: "Layout",
        detail: "Responsive Fokusmodus anwenden",
        action: () => applyWorkbenchPreset(presetId)
      })),
      ...jobs.slice(0, 20).map((job) => ({
        id: `job-${job.id}`,
        label: job.title,
        category: "Job",
        detail: `${job.status} · P${job.priority}`,
        action: () => void selectJob(job.id)
      })),
      ...agents.slice(0, 10).map((agent) => ({
        id: `agent-${agent.id}`,
        label: agent.name,
        category: "Agent",
        detail: agent.role,
        action: () => {}
      }))
    ];
    return all.filter((entry) => fuzzyMatch(`${entry.label} ${entry.category} ${entry.detail ?? ""}`, query));
  }, [agents, applyWorkbenchPreset, jobs, query, requestRuntimeChatCapabilities, requestRuntimeChatPreset, selectJob]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      closePalette();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, entries.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && entries[activeIndex]) {
      entries[activeIndex].action();
      closePalette();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[8888] flex items-start justify-center pt-[15vh]"
      onClick={closePalette}
      onKeyDown={(event) => {
        if (event.key === "Escape") closePalette();
      }}
      role="presentation"
    >
      <div className="absolute inset-0 bg-black/60" />

      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-lg border border-dbzs-border bg-dbzs-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-label="Befehlspalette"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 border-b border-dbzs-border px-4 py-3">
          <span className="text-sm text-dbzs-muted">⌕</span>
          <input
            ref={inputRef}
            aria-autocomplete="list"
            aria-controls="command-palette-results"
            aria-label="Befehle, Jobs und Agenten durchsuchen"
            className="flex-1 bg-transparent text-sm text-dbzs-text placeholder:text-dbzs-muted focus:outline-none"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Suchen — Jobs, Agents, Aktionen…"
            type="text"
            value={query}
          />
          <kbd className="rounded border border-dbzs-border px-1.5 py-0.5 text-[10px] text-dbzs-muted">Esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1" id="command-palette-results" role="listbox" aria-label="Suchtreffer">
          {entries.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-dbzs-muted">Keine Treffer für „{query}“</p>
          ) : (
            entries.map((entry, index) => (
              <button
                aria-selected={index === activeIndex}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-xs transition ${
                  index === activeIndex
                    ? "bg-dbzs-cyan/10 text-dbzs-cyan"
                    : "text-dbzs-text hover:bg-dbzs-panelSoft"
                }`}
                id={`command-palette-entry-${entry.id}`}
                key={entry.id}
                onClick={() => {
                  entry.action();
                  closePalette();
                }}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <span className="w-16 shrink-0 text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">{entry.category}</span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.detail ? <span className="shrink-0 text-[10px] text-dbzs-muted">{entry.detail}</span> : null}
              </button>
            ))
          )}
        </div>

        <div className="border-t border-dbzs-border px-4 py-1.5 text-[10px] text-dbzs-muted">
          <span className="mr-3">↑↓ navigieren</span>
          <span className="mr-3">↵ ausführen</span>
          <span>Esc schließen</span>
        </div>
      </div>
    </div>
  );
}
