import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export interface ContextMenuItem {
  label: string;
  action: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
}

export interface ContextMenuProps {
  items: Array<ContextMenuItem | null>;
  onClose: () => void;
  x: number;
  y: number;
}

export function ContextMenu({ items, onClose, x, y }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState({ x, y });
  useFocusTrap(ref, true, onClose, firstItemRef);

  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = menu.getBoundingClientRect();
    const nextX = Math.min(x, Math.max(8, viewportWidth - rect.width - 8));
    const nextY = Math.min(y, Math.max(8, viewportHeight - rect.height - 8));
    setPosition({ x: nextX, y: nextY });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [onClose]);

  const menuItems = useMemo(() => items.filter((item): item is ContextMenuItem => item !== null), [items]);

  return (
    <div
      className="fixed z-50 min-w-52 border border-dbzs-border bg-dbzs-panel py-1 text-xs shadow-panel"
      role="menu"
      aria-label="Kontextmenü"
      ref={ref}
      style={{ left: position.x, top: position.y }}
      tabIndex={-1}
    >
      {items.map((item, index) => item === null ? (
        <div className="my-1 border-t border-dbzs-border" key={`separator-${index}`} role="separator" />
      ) : (
        <button
          aria-disabled={item.disabled}
          className={`block w-full px-3 py-1 text-left hover:bg-dbzs-panelSoft disabled:opacity-40 ${item.danger ? "text-dbzs-red" : "text-dbzs-muted hover:text-dbzs-text"}`}
          disabled={item.disabled}
          key={`${item.label}-${index}`}
          ref={index === 0 ? firstItemRef : undefined}
          onClick={() => {
            void item.action();
            onClose();
          }}
          role="menuitem"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
