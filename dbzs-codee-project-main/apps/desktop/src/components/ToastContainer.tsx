import { useToastStore, type ToastKind } from "@/stores/toastStore";

function kindClass(kind: ToastKind): string {
  switch (kind) {
    case "success": return "border-green-400/40 bg-green-400/10 text-green-400";
    case "error":   return "border-red-400/40 bg-red-400/10 text-red-400";
    case "warning": return "border-amber-400/40 bg-amber-400/10 text-amber-400";
    default:        return "border-dbzs-cyan/40 bg-dbzs-cyan/10 text-dbzs-cyan";
  }
}

function kindIcon(kind: ToastKind): string {
  switch (kind) {
    case "success": return "✓";
    case "error":   return "✕";
    case "warning": return "⚠";
    default:        return "ℹ";
  }
}

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          className={`pointer-events-auto flex items-start gap-3 rounded border px-4 py-3 shadow-lg ${kindClass(toast.kind)}`}
          key={toast.id}
          role="alert"
        >
          <span className="shrink-0 text-sm font-bold" aria-hidden="true">{kindIcon(toast.kind)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">{toast.title}</p>
            {toast.body && <p className="mt-0.5 text-[11px] opacity-80">{toast.body}</p>}
          </div>
          <button
            aria-label="Toast schließen"
            className="shrink-0 text-[11px] opacity-60 hover:opacity-100"
            onClick={() => dismiss(toast.id)}
            type="button"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
