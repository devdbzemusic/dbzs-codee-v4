import type { ReactNode } from "react";

interface SectionCardProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Standard bordered card frame for RuntimeChat panels. Replaces the many
 * individually-styled `<section>`/`<article>` blocks (and, in the case of
 * RuntimeChatResearchPanel, inline `style={{...}}` objects with a completely
 * different color palette) that previously each rolled their own border/
 * background/padding.
 */
export function SectionCard({ title, description, actions, children }: SectionCardProps) {
  return (
    <section className="rounded border border-dbzs-border bg-dbzs-panel/60 p-2">
      {title || actions ? (
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? <h3 className="truncate text-[11px] font-medium text-dbzs-text">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-[10px] text-dbzs-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
