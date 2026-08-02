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
  terminalContent,
  systemLoading,
  onResize,
  onToggleTerminal
}: {
  rightPanelCollapsed: boolean;
  terminalCollapsed: boolean;
  terminalContent: ReactNode;
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
        <PanelHeader
          description={terminalCollapsed ? "" : "Ausfuehrung wird erst mit Sicherheitspruefung aktiviert."}
          onCollapse={onToggleTerminal}
          title="Terminal / Logs / Git"
        />
        {terminalCollapsed ? null : terminalContent}
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
