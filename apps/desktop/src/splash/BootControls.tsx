import { useState } from "react";
import type { BootState } from "@dbzs/shared";

function Button({
  onClick,
  children,
  variant = "default"
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "primary" | "danger";
}) {
  const base = "rounded-md px-3 py-1.5 text-xs font-medium transition-colors";
  const styles =
    variant === "primary"
      ? "bg-dbzs-cyan text-dbzs-bg hover:bg-dbzs-cyan/80"
      : variant === "danger"
        ? "bg-dbzs-red/20 text-dbzs-red hover:bg-dbzs-red/30"
        : "bg-dbzs-panelSoft text-dbzs-text hover:bg-dbzs-border";
  return (
    <button type="button" onClick={onClick} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

export function BootControls({ state }: { state: BootState }) {
  const [busy, setBusy] = useState<string | null>(null);
  const hasFailure = state.phases.some((p) => p.state === "failed" || p.state === "blocked");
  const residentModelFailed = state.phases.find((p) => p.id === "resident-model")?.state === "failed";

  async function run(key: string, action: () => Promise<unknown> | undefined): Promise<void> {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 border-t border-dbzs-border pt-3">
      {hasFailure ? (
        <Button variant="primary" onClick={() => run("retry", () => window.dbzs.retryBootPhase?.(null))}>
          Erneut versuchen
        </Button>
      ) : null}
      <Button onClick={() => run("restart-backend", () => window.dbzs.restartBootBackend?.())}>
        Backend neu starten
      </Button>
      {residentModelFailed ? (
        <Button onClick={() => run("fallback", () => window.dbzs.useFallbackResidentModel?.())}>
          Ersatzmodell verwenden
        </Button>
      ) : null}
      <Button onClick={() => run("export", () => window.dbzs.exportBootDiagnostics?.())}>
        Diagnose exportieren
      </Button>
      <Button onClick={() => run("safe-mode", () => window.dbzs.enterBootSafeMode?.())}>
        Sicherer Modus
      </Button>
      <Button variant="danger" onClick={() => run("quit", () => window.dbzs.quitApp?.())}>
        Beenden
      </Button>
      {busy ? <span className="self-center text-[11px] text-dbzs-muted">Wird ausgeführt…</span> : null}
    </div>
  );
}
