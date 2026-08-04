import type { PointerEvent as ReactPointerEvent } from "react";

type SplitDirection = "horizontal" | "vertical";

interface SplitHandleProps {
  direction: SplitDirection;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  "aria-label"?: string;
  className?: string;
}

/**
 * Drag handle between two resizable panels.
 * Calls onResizeStart on pointerdown so the parent can attach move/up listeners.
 */
export function SplitHandle({
  direction,
  onResizeStart,
  "aria-label": ariaLabel,
  className = ""
}: SplitHandleProps) {
  const isHorizontal = direction === "horizontal";

  return (
    <button
      aria-label={ariaLabel ?? (isHorizontal ? "Breite anpassen" : "Höhe anpassen")}
      className={`dbzs-split-handle shrink-0 bg-dbzs-border transition-colors hover:bg-dbzs-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-dbzs-cyan ${
        isHorizontal ? "h-full w-1 cursor-col-resize" : "h-1 w-full cursor-row-resize"
      } ${className}`}
      onPointerDown={onResizeStart}
      type="button"
    />
  );
}
