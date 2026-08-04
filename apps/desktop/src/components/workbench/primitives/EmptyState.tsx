import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

/** Centered empty/placeholder state for panels and workspaces. */
export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      {icon ? (
        <div className="grid h-10 w-10 place-items-center rounded border border-dbzs-border bg-dbzs-panelSoft text-dbzs-muted">
          {icon}
        </div>
      ) : null}
      <div>
        <p className="text-sm font-medium text-dbzs-text">{title}</p>
        {description ? <p className="mt-1 text-xs text-dbzs-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
