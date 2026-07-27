import { create } from "zustand";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  title: string;
  body?: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: Toast[];
  add: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
  warning: (title: string, body?: string) => void;
}

const AUTO_DISMISS_MS = 4500;

export const useToastStore = create<ToastState>((set, get) => {
  function add(toast: Omit<Toast, "id">) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, AUTO_DISMISS_MS);
  }

  return {
    toasts: [],
    add,
    dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    success: (title, body) => add({ title, body, kind: "success" }),
    error: (title, body) => add({ title, body, kind: "error" }),
    info: (title, body) => add({ title, body, kind: "info" }),
    warning: (title, body) => add({ title, body, kind: "warning" }),
  };
});
