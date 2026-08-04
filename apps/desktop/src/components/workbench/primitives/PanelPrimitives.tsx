import type { ReactNode, ButtonHTMLAttributes } from "react";

interface PanelHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  onCollapse?: () => void;
}

/** Standardized header bar for workbench panels. */
export function PanelHeader({ title, description, actions, onCollapse }: PanelHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-dbzs-border bg-dbzs-panelSoft px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold uppercase tracking-wider text-dbzs-muted">{title}</p>
        {description ? <p className="truncate text-[10px] text-dbzs-muted/60">{description}</p> : null}
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-1">
        {actions}
        {onCollapse ? (
          <button
            aria-label={`${title} einklappen`}
            className="grid h-5 w-5 place-items-center text-dbzs-muted hover:text-dbzs-text"
            onClick={onCollapse}
            type="button"
          >
            <svg fill="none" height="12" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="12">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
      </div>
    </header>
  );
}

interface PanelToolbarProps {
  children: ReactNode;
  className?: string;
}

/** Thin toolbar strip below a PanelHeader. */
export function PanelToolbar({ children, className = "" }: PanelToolbarProps) {
  return (
    <div className={`flex shrink-0 items-center gap-1 border-b border-dbzs-border bg-dbzs-panelSoft px-2 py-1 ${className}`}>
      {children}
    </div>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  active?: boolean;
  badge?: number;
}

/** Small icon-only action button used in panel toolbars and rails. */
export function IconButton({ active = false, badge, children, className = "", ...props }: IconButtonProps) {
  return (
    <button
      className={`relative grid h-7 w-7 place-items-center rounded text-dbzs-muted transition-colors hover:bg-dbzs-cyan/10 hover:text-dbzs-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-dbzs-cyan ${
        active ? "bg-dbzs-cyan/10 text-dbzs-cyan" : ""
      } ${className}`}
      type="button"
      {...props}
    >
      {children}
      {badge != null && badge > 0 ? (
        <span
          aria-label={`${badge} Einträge`}
          className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-dbzs-cyan px-0.5 text-[9px] font-bold text-dbzs-bg"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}
