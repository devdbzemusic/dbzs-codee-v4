import type { BackendStartupStatus } from "@dbzs/shared";

export type BackendUiStatus =
  | "offline"
  | "starting"
  | "live"
  | "ready"
  | "degraded"
  | "failed";

/**
 * Single source of truth for what the backend header/status pill shows.
 *
 * Fed exclusively from the boot orchestrator's own `BackendStartupStatus`
 * (never from a separate health-poll store) so "online" can only ever be
 * displayed once the backend is genuinely ready — see
 * DBZS_CODEE_V4_POST_REPAIR_ANALYSIS.md §4.
 */
export function backendUiStatus(status: BackendStartupStatus | null): BackendUiStatus {
  if (!status) {
    return "offline";
  }
  switch (status.state) {
    case "ready":
      return "ready";
    case "degraded":
      return "degraded";
    case "live":
      return "live";
    case "starting":
    case "idle":
      return "starting";
    case "failed":
      return "failed";
    case "stopped":
    default:
      return "offline";
  }
}

/**
 * Formatiert den Boot-Status des Backends in einen für die UI verständlichen,
 * konsistenten String. `online` wird ausschließlich bei echter Readiness
 * angezeigt (PRIORITÄT 6 / Schritt 6).
 */
export function formatBootStateForUi(status: BackendStartupStatus | null): string {
  switch (backendUiStatus(status)) {
    case "ready":
      return "Backend: online";
    case "starting":
    case "live":
      return "Backend: startet";
    case "degraded":
      return "Backend: beeinträchtigt";
    case "failed":
      return `Backend: Fehler${status?.message ? ` (${status.message})` : ""}`;
    case "offline":
    default:
      return "Backend: offline";
  }
}
