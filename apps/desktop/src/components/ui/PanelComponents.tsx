import { type PointerEvent } from "react";

interface PanelHeaderProps {
  description: string;
  onCollapse: () => void;
  title: string;
}

/**
 * DBZS – Division By Zeros
 * Datei: PanelHeader.tsx
 * Bereich: UI Components
 *
 * Zweck:
 *   Standardisierte Panel-Überschrift mit Titel, Beschreibung und Einklapp-Button.
 *
 * Warum:
 *   Vermeidet Duplizierung von Header-Logik in verschiedenen Panels.
 *
 * Wozu:
 *   Konsistente UI für alle Panels (Agents, Runtime, Settings, etc.).
 *
 * Input:
 *   - title: Panel-Titel (string)
 *   - description: optionale Beschreibung (string)
 *   - onCollapse: Callback zum Einklappen (function)
 *
 * Output:
 *   - React Element mit Header-Layout
 *
 * Eltern:
 *   - Alle Panel-Komponenten (AgentRegistryPanel, RuntimeControlPanel, etc.)
 *
 * Kinder:
 *   - Keine (Leaf Component)
 *
 * Hinweise:
 *   - Titel wird bei Überlauf gekürzt (truncate)
 *   - Einklapp-Button immer sichtbar für konsistente Interaktion
 */
export function PanelHeader({ description, onCollapse, title }: PanelHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-4">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-normal">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-dbzs-muted">{description}</p> : null}
      </div>
      <button
        className="grid h-7 w-7 shrink-0 place-items-center border border-dbzs-border bg-dbzs-bg text-xs text-dbzs-muted hover:border-dbzs-cyan/50 hover:text-dbzs-cyan"
        onClick={onCollapse}
        title={`${title} einklappen`}
        type="button"
      >
        -
      </button>
    </div>
  );
}

interface PanelTitleProps {
  description: string;
  title: string;
}

/**
 * DBZS – Division By Zeros
 * Datei: PanelTitle.tsx
 * Bereich: UI Components
 *
 * Zweck:
 *   Einfache Panel-Überschrift ohne Einklapp-Button.
 *
 * Warum:
 *   Für Panels, die nicht einklappbar sein sollen.
 *
 * Wozu:
 *   Konsistente Typografie für statische Panel-Titel.
 */
export function PanelTitle({ description, title }: PanelTitleProps) {
  return (
    <div className="px-4 py-4">
      <h2 className="text-sm font-semibold tracking-normal">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-dbzs-muted">{description}</p>
    </div>
  );
}

interface CollapsedPanelButtonProps {
  label: string;
  onClick: () => void;
  side: "left" | "right";
}

/**
 * DBZS – Division By Zeros
 * Datei: CollapsedPanelButton.tsx
 * Bereich: UI Components
 *
 * Zweck:
 *   Vertikaler Button für eingeklappte Panels.
 *
 * Warum:
 *   Ermöglicht Wieder-Einblenden von Panels mit minimalem Platzverbrauch.
 *
 * Wozu:
 *   Platzsparende UI-Navigation für Workspace und AI/Agents Panels.
 */
export function CollapsedPanelButton({ label, onClick, side }: CollapsedPanelButtonProps) {
  return (
    <button
      className="flex h-full w-full items-start justify-center border-0 bg-dbzs-panel px-0 py-4 text-xs font-medium text-dbzs-muted hover:text-dbzs-cyan"
      onClick={onClick}
      title={label}
      type="button"
    >
      <span className="[writing-mode:vertical-rl]">
        {side === "left" ? "Workspace" : "AI / Agents"} +
      </span>
    </button>
  );
}

interface ResizeHandleProps {
  label: string;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  side: "left" | "right" | "top";
}

/**
 * DBZS – Division By Zeros
 * Datei: ResizeHandle.tsx
 * Bereich: UI Components
 *
 * Zweck:
 *   Resize-Handle für Panel-Größenanpassung.
 *
 * Warum:
 *   Ermöglicht benutzerdefinierte Panel-Breiten/Höhen.
 *
 * Wozu:
 *   Flexible UI-Anpassung für verschiedene Bildschirmgrößen.
 *
 * Hinweise:
 *   - Position wird über side-Prop gesteuert (left, right, top)
 *   - Cursor ändert sich je nach Richtung (col-resize, row-resize)
 */
export function ResizeHandle({ label, onPointerDown, side }: ResizeHandleProps) {
  const positionClass = {
    left: "left-0 top-0 h-full w-2 cursor-col-resize",
    right: "right-0 top-0 h-full w-2 cursor-col-resize",
    top: "left-0 top-0 h-2 w-full cursor-row-resize"
  }[side];

  return (
    <button
      aria-label={label}
      className={`absolute z-20 border-0 bg-transparent transition-colors hover:bg-dbzs-cyan/20 ${positionClass}`}
      onPointerDown={onPointerDown}
      title={label}
      type="button"
    />
  );
}

interface StatusPillProps {
  label: string;
  tone: "green" | "amber" | "red";
  value: string;
}

/**
 * DBZS – Division By Zeros
 * Datei: StatusPill.tsx
 * Bereich: UI Components
 *
 * Zweck:
 *   Farbiger Status-Indicator (Pill-Design).
 *
 * Warum:
 *   Visuelle Hervorhebung von Status-Werten (Health, Runtime, etc.).
 *
 * Wozu:
 *   Schnelle Erfassung von Systemzuständen.
 *
 * Input:
 *   - tone: Farbschema (green=ok, amber=warning, red=error)
 *   - label: Beschriftung (z.B. "Backend", "Runtime")
 *   - value: Status-Wert (z.B. "running", "stopped")
 */
export function StatusPill({ label, tone, value }: StatusPillProps) {
  const toneClass = {
    amber: "border-dbzs-amber/50 text-dbzs-amber bg-dbzs-amber/10",
    green: "border-dbzs-green/50 text-dbzs-green bg-dbzs-green/10",
    red: "border-dbzs-red/50 text-dbzs-red bg-dbzs-red/10"
  }[tone];

  return (
    <div className={`border px-3 py-1.5 ${toneClass}`}>
      <span className="text-dbzs-muted">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
}

/**
 * DBZS – Division By Zeros
 * Datei: InfoRow.tsx
 * Bereich: UI Components
 *
 * Zweck:
 *   Label-Value Zeile für Settings und Info-Panels.
 *
 * Warum:
 *   Konsistente Darstellung von Key-Value-Paaren.
 *
 * Wozu:
 *   Übersichtliche Auflistungen (Settings, Model-Info, etc.).
 */
export function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="text-dbzs-text">{value}</span>
    </div>
  );
}

interface WorkspaceFileRowProps {
  file: {
    path: string;
    relativePath: string;
    name: string;
  };
  onOpen: (filePath: string) => void;
}

/**
 * DBZS – Division By Zeros
 * Datei: WorkspaceFileRow.tsx
 * Bereich: UI Components
 *
 * Zweck:
 *   Datei-Zeile im Workspace Explorer.
 *
 * Warum:
 *   Kapselt Datei-Button-Logik für wiederverwendbare Datei-Listen.
 *
 * Wozu:
 *   Einheitliche Darstellung von Dateien im Explorer.
 */
export function WorkspaceFileRow({ file, onOpen }: WorkspaceFileRowProps) {
  return (
    <button
      className="w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1.5 text-left text-xs text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-text"
      onClick={() => onOpen(file.path)}
      type="button"
    >
      {file.relativePath}
    </button>
  );
}

