import type { BootPhase } from "@dbzs/shared";
import { LED_STYLES } from "./ledStyles";

function formatElapsed(phase: BootPhase, now: number): string | null {
  if (phase.durationMs != null) {
    return `${(phase.durationMs / 1000).toFixed(1)}s`;
  }
  if (phase.startedAt != null && phase.state === "running") {
    return `${((now - phase.startedAt) / 1000).toFixed(1)}s`;
  }
  return null;
}

export function BootPhaseRow({ phase, now }: { phase: BootPhase; now: number }) {
  const led = LED_STYLES[phase.state];
  const elapsed = formatElapsed(phase, now);

  return (
    <div className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-dbzs-panelSoft/60">
      <span
        className={`relative inline-block h-2.5 w-2.5 shrink-0 rounded-full ${led.className} ${led.animationClassName ?? ""}`}
        title={led.label}
        aria-label={led.label}
      />
      <span className="w-64 shrink-0 truncate text-sm text-dbzs-text">{phase.label}</span>
      <span className="flex-1 truncate text-xs text-dbzs-muted">
        {phase.message || led.label}
        {phase.pollCount > 0 ? ` (Poll ${phase.pollCount})` : ""}
        {phase.retryCount > 0 ? ` (Retry ${phase.retryCount})` : ""}
      </span>
      {(phase.state === "running" || phase.state === "waiting") && phase.progress > 0 ? (
        <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-dbzs-panelSoft">
          <div className="h-full bg-dbzs-cyan transition-[width]" style={{ width: `${Math.min(100, phase.progress)}%` }} />
        </div>
      ) : null}
      {elapsed ? <span className="w-12 shrink-0 text-right text-xs text-dbzs-muted">{elapsed}</span> : <span className="w-12 shrink-0" />}
    </div>
  );
}
