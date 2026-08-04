import type { ReactNode } from "react";

export function WorkbenchHeader({
  commandLabel = "Quick Open",
  onOpenCommandPalette,
  actions,
  onToggleShell
}: {
  commandLabel?: string;
  onOpenCommandPalette: () => void;
  actions: ReactNode;
  onToggleShell: () => void;
}) {
  return (
    <header className="dbzs-workbench__header">
      <div className="dbzs-workbench__brand">
        <div className="dbzs-workbench__mark" aria-hidden="true">D</div>
        <div className="min-w-0">
          <div className="dbzs-workbench__eyebrow">DBZS local-first workbench</div>
          <p className="dbzs-workbench__title">Codee <span>Code Assistant</span></p>
        </div>
      </div>
      <button className="dbzs-workbench__command" onClick={onOpenCommandPalette} type="button">
        <span>{commandLabel}</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="dbzs-workbench__header-actions">
        {actions}
        <button
          className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-[10px] text-dbzs-muted hover:border-dbzs-cyan/50 hover:text-dbzs-cyan"
          onClick={onToggleShell}
          type="button"
        >
          Classic
        </button>
      </div>
    </header>
  );
}
