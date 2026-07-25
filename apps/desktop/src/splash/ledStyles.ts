import type { BootPhaseState } from "@dbzs/shared";

export interface LedStyle {
  className: string;
  animationClassName?: string;
  icon?: "lock";
  label: string;
}

export const LED_STYLES: Record<BootPhaseState, LedStyle> = {
  pending: { className: "bg-dbzs-muted/40", label: "Ausstehend" },
  waiting: { className: "bg-dbzs-muted/60", animationClassName: "animate-pulse", label: "Wartet" },
  running: { className: "bg-dbzs-cyan", animationClassName: "animate-pulse", label: "Läuft" },
  success: { className: "bg-dbzs-green", label: "Erfolgreich" },
  warning: { className: "bg-dbzs-amber", label: "Warnung" },
  failed: { className: "bg-dbzs-red", label: "Fehlgeschlagen" },
  retrying: { className: "bg-dbzs-amber", animationClassName: "animate-pulse", label: "Wiederholung" },
  blocked: { className: "bg-dbzs-red/70", icon: "lock", label: "Blockiert" },
  skipped: { className: "bg-dbzs-muted/30", label: "Übersprungen" }
};
