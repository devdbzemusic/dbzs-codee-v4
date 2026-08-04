import type { ReactNode } from "react";

interface PrimaryWorkspaceProps {
  /** Main content area: Chat, Editor, Review, etc. */
  children: ReactNode;
  /** Optional CSS class name for layout variants */
  className?: string;
}

/**
 * Central work surface of the Neural Workbench.
 * Fills all remaining horizontal space between the sidebars.
 */
export function PrimaryWorkspace({ children, className = "" }: PrimaryWorkspaceProps) {
  return (
    <section
      aria-label="Hauptarbeitsbereich"
      className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${className}`}
    >
      {children}
    </section>
  );
}
