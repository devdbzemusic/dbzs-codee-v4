import { useEffect, useMemo, useRef, useState } from "react";

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
  const [position, setPosition] = useState({ x, y });

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
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    });

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [onClose]);

  const menuItems = useMemo(() => items.filter((item): item is ContextMenuItem => item !== null), [items]);

  return (
    <div
      className="fixed z-50 min-w-52 border border-dbzs-border bg-dbzs-panel py-1 text-xs shadow-panel"
      ref={ref}
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, index) => item === null ? (
        <div className="my-1 border-t border-dbzs-border" key={`separator-${index}`} />
      ) : (
        <button
          className={`block w-full px-3 py-1 text-left hover:bg-dbzs-panelSoft disabled:opacity-40 ${item.danger ? "text-dbzs-red" : "text-dbzs-muted hover:text-dbzs-text"}`}
          disabled={item.disabled}
          key={`${item.label}-${index}`}
          onClick={() => {
            void item.action();
            onClose();
          }}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
