/**
 * DBZS – Division By Zeros
 * Datei: usePanelResize.ts
 * Bereich: Custom Hooks
 *
 * Zweck:
 *   Hook für Panel-Größenanpassung (Resize-Logic).
 *
 * Warum:
 *   Vermeidet Duplizierung von Resize-Logik in App.tsx.
 *
 * Wozu:
 *   Wiederverwendbare Resize-Funktionalität für alle Panels.
 */

import { useCallback, useEffect, useState } from "react";

interface UsePanelResizeOptions {
  initialValue: number;
  min: number;
  max: number;
  direction: "horizontal" | "vertical";
}

interface UsePanelResizeReturn {
  currentSize: number;
  handlePointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  isResizing: boolean;
}

export function usePanelResize({
  initialValue,
  min,
  max,
  direction
}: UsePanelResizeOptions): UsePanelResizeReturn {
  const [currentSize, setCurrentSize] = useState(initialValue);
  const [isResizing, setIsResizing] = useState(false);
  const [startPos, setStartPos] = useState(0);
  const [startSize, setStartSize] = useState(0);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    event.preventDefault();
    
    const delta = direction === "horizontal"
      ? event.clientX - startPos
      : startPos - event.clientY;
    
    const newSize = startSize + delta;
    const clampedSize = Math.min(Math.max(newSize, min), max);
    setCurrentSize(clampedSize);
  }, [direction, max, min, startSize, startPos]);

  const handlePointerUp = useCallback(() => {
    setIsResizing(false);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsResizing(true);
    setStartPos(direction === "horizontal" ? event.clientX : event.clientY);
    setStartSize(currentSize);
    
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [currentSize, direction, handlePointerMove, handlePointerUp]);

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  return {
    currentSize,
    handlePointerDown,
    isResizing
  };
}

/**
 * DBZS – Division By Zeros
 * Datei: useClamp.ts
 * Bereich: Custom Hooks
 *
 * Zweck:
 *   Utility-Hook für Wertebereichs-Begrenzung.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

