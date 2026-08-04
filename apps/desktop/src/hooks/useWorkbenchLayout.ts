import { useCallback, type PointerEvent } from "react";
import { useWorkbenchLayoutStore } from "@/stores/workbenchLayoutStore";

const MIN_LEFT_WIDTH   = 220;
const MAX_LEFT_WIDTH   = 520;
const MIN_INSPECTOR_WIDTH = 220;
const MAX_INSPECTOR_WIDTH = 600;
const MIN_DOCK_HEIGHT  = 128;
const MAX_DOCK_HEIGHT  = 480;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Encapsulates all resize/collapse logic for the Neural Workbench layout.
 * Components call these handlers instead of managing raw pointer events themselves.
 */
export function useWorkbenchLayout() {
  const {
    leftSidebarWidth,
    setLeftSidebarWidth,
    inspectorWidth,
    setInspectorWidth,
    bottomDockHeight,
    setBottomDockHeight,
    leftSidebarOpen,
    toggleLeftSidebar,
    inspectorOpen,
    toggleInspector,
    bottomDockOpen,
    toggleBottomDock,
    applyPreset,
    activePresetId
  } = useWorkbenchLayoutStore();

  const startLeftResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = leftSidebarWidth;

      const handleMove = (e: globalThis.PointerEvent) => {
        setLeftSidebarWidth(clamp(startWidth + (e.clientX - startX), MIN_LEFT_WIDTH, MAX_LEFT_WIDTH));
      };
      const stop = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", stop);
    },
    [leftSidebarWidth, setLeftSidebarWidth]
  );

  const startInspectorResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = inspectorWidth;

      const handleMove = (e: globalThis.PointerEvent) => {
        // Inspector is on the right → dragging left increases its width
        setInspectorWidth(clamp(startWidth - (e.clientX - startX), MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH));
      };
      const stop = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", stop);
    },
    [inspectorWidth, setInspectorWidth]
  );

  const startDockResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = bottomDockHeight;

      const handleMove = (e: globalThis.PointerEvent) => {
        setBottomDockHeight(clamp(startHeight - (e.clientY - startY), MIN_DOCK_HEIGHT, MAX_DOCK_HEIGHT));
      };
      const stop = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", stop);
    },
    [bottomDockHeight, setBottomDockHeight]
  );

  return {
    leftSidebarWidth,
    inspectorWidth,
    bottomDockHeight,
    leftSidebarOpen,
    inspectorOpen,
    bottomDockOpen,
    activePresetId,
    toggleLeftSidebar,
    toggleInspector,
    toggleBottomDock,
    startLeftResize,
    startInspectorResize,
    startDockResize,
    applyPreset
  };
}
