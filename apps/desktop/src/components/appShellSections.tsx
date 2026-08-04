/*
 * DBZS – Division By Zeros
 * Datei: appShellSections.tsx
 * Bereich: Desktop / App Shell
 *
 * Zweck:
 *   Wiederverwendbare Layout-Sektionen fuer die App-Shell.
 *
 * Warum:
 *   Haelt App.tsx als Root-Composition kompakter und trennt statische
 *   Shell-Bereiche von fachlicher Seitenlogik.
 *
 * Wozu:
 *   Reduziert Godfile-Druck in App.tsx ohne Aenderung des UI-Verhaltens.
 */

import type { ReactNode } from "react";
import {
  CollapsedPanelButton,
  PanelHeader,
  PanelTitle,
  ResizeHandle
} from "@/components/appShellPrimitives";
import { DOCK_TABS, DOCK_TAB_LABELS, type DockTabId } from "@/stores/dockStore";

export function AppShellRightSidebar({
  collapsed,
  onCollapse,
  onExpand,
  onResize,
  modeToggle,
  fillBody = false,
  children
}: {
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onResize: (event: React.PointerEvent<HTMLButtonElement>) => void;
  /** Optional mode switcher rendered below the header, outside the scrollable body. */
  modeToggle?: ReactNode;
  /**
   * When true, the body becomes a non-padded flex-1 column instead of the
   * default scrollable card stack — for content (e.g. a live log) that
   * manages its own internal scrolling instead of a vertical list of cards.
   */
  fillBody?: boolean;
  children: ReactNode;
}) {
  return (
    <aside className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-dbzs-border bg-dbzs-panel">
      {collapsed ? (
        <CollapsedPanelButton
          label="AI / Agents oeffnen"
          onClick={onExpand}
          side="right"
        />
      ) : (
        <>
          <PanelHeader
            description="Lokale Modelle aus D:\\Models werden verifiziert."
            onCollapse={onCollapse}
            title="AI / Agents"
          />
          {modeToggle ? <div className="shrink-0 px-4 pb-3">{modeToggle}</div> : null}
          {fillBody ? (
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          ) : (
            <div className="panel-scroll space-y-4 px-4 pb-4">{children}</div>
          )}
        </>
      )}
      {!collapsed ? (
        <ResizeHandle
          label="AI-Panel-Breite anpassen"
          onPointerDown={onResize}
          side="left"
        />
      ) : null}
    </aside>
  );
}

export function AppShellFooter({
  rightPanelCollapsed,
  terminalCollapsed,
  dockMode,
  dockMaximized,
  onSetDockMode,
  onToggleDockMaximized,
  terminalPane,
  debugConsolePane,
  outputPane,
  gitPane,
  systemLoading,
  onResize,
  onToggleTerminal
}: {
  rightPanelCollapsed: boolean;
  terminalCollapsed: boolean;
  dockMode: DockTabId;
  dockMaximized: boolean;
  onSetDockMode: (tab: DockTabId) => void;
  onToggleDockMaximized: () => void;
  terminalPane: ReactNode;
  debugConsolePane: ReactNode;
  outputPane: ReactNode;
  gitPane: ReactNode;
  systemLoading: boolean;
  onResize: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onToggleTerminal: () => void;
}) {
  return (
    <footer className="app-footer-grid relative grid min-h-0 overflow-hidden border-t border-dbzs-border bg-dbzs-panel">
      <ResizeHandle
        label="Terminal-Hoehe anpassen"
        onPointerDown={onResize}
        side="top"
      />
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-dbzs-border">
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-dbzs-border px-2">
          {DOCK_TABS.map((tabId) => (
            <button
              className={`shrink-0 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                dockMode === tabId
                  ? "bg-dbzs-cyan/10 text-dbzs-cyan"
                  : "text-dbzs-muted hover:text-dbzs-text"
              }`}
              key={tabId}
              onClick={() => onSetDockMode(tabId)}
              type="button"
            >
              {DOCK_TAB_LABELS[tabId]}
            </button>
          ))}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              aria-pressed={dockMaximized}
              className="rounded p-1 text-dbzs-muted hover:text-dbzs-text"
              onClick={onToggleDockMaximized}
              title={dockMaximized ? "Dock verkleinern" : "Dock maximieren"}
              type="button"
            >
              <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                {dockMaximized ? (
                  <path d="M9 15l-6 6M9 15v5m0-5H4M15 9l6-6M15 9V4m0 5h5" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>
            <button
              className="rounded p-1 text-dbzs-muted hover:text-dbzs-text"
              onClick={onToggleTerminal}
              title={terminalCollapsed ? "Dock einblenden" : "Dock einklappen"}
              type="button"
            >
              <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d={terminalCollapsed ? "M6 9l6-6 6 6M6 15l6 6 6-6" : "M6 15l6-6 6 6"} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        {terminalCollapsed ? null : (
          <>
            <div className={`min-h-0 flex-1 overflow-hidden ${dockMode === "terminal" ? "flex flex-col" : "hidden"}`}>
              {terminalPane}
            </div>
            <div className={`min-h-0 flex-1 overflow-hidden ${dockMode === "debug-console" ? "flex flex-col" : "hidden"}`}>
              {debugConsolePane}
            </div>
            <div className={`min-h-0 flex-1 overflow-hidden ${dockMode === "output" ? "flex flex-col" : "hidden"}`}>
              {outputPane}
            </div>
            <div className={`min-h-0 flex-1 overflow-hidden ${dockMode === "git" ? "flex flex-col" : "hidden"}`}>
              {gitPane}
            </div>
          </>
        )}
      </section>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {rightPanelCollapsed ? null : (
          <>
            <PanelTitle title="System" description="Lokale App-Einstellungen" />
            <div className="panel-scroll px-4 pb-4 text-xs text-dbzs-muted">
              {systemLoading ? "Synchronisiere Settings ..." : "Settings lokal synchronisiert"}
            </div>
          </>
        )}
      </section>
    </footer>
  );
}

