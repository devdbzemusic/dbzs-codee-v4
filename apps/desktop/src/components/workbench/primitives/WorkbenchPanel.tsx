import type { ReactNode, HTMLAttributes } from "react";

interface WorkbenchPanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  className?: string;
  as?: "section" | "aside" | "div" | "article";
}

/**
 * Base panel container for workbench sections.
 * Provides the standard surface background and border.
 */
export function WorkbenchPanel({ children, className = "", as: Tag = "div", ...props }: WorkbenchPanelProps) {
  return (
    <Tag
      className={`dbzs-workbench__panel flex min-h-0 flex-col overflow-hidden border border-dbzs-border bg-dbzs-panel ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}
