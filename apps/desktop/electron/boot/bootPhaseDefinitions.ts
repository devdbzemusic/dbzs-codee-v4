import type { BootTimeoutPolicy } from "@dbzs/shared";

export interface BootPhaseDefinition {
  id: string;
  label: string;
  description?: string;
  dependencies: string[];
  optional: boolean;
  timeouts: BootTimeoutPolicy;
}

/**
 * The 16 boot phases, in dependency order. Phase 16 ("main-app-released")
 * intentionally omits "resident-model" (11) from its dependencies — that
 * phase is optional, so its failure degrades the boot instead of blocking
 * the main window (confirmed decision: resident-model is optional/degraded,
 * degraded boots auto-continue to the main window).
 *
 * IMPORTANT for phases 6-11 (backend-health-live, backend-ready,
 * database-init, model-index, runtime-manager-init, resident-model): their
 * runners (phaseRunners.ts) return outcome:"failed" simply to mean "not
 * ready yet" so the orchestrator's retry loop doubles as a poll — the
 * runner itself never throws. That means `retryCount` here must be large
 * enough that `retryCount * retryDelayMs` comfortably exceeds
 * `hardTimeoutMs`, otherwise the retry *count* ceiling — not the intended
 * time deadline — silently becomes what ends the phase. This was a real
 * bug (backend-health-live failed at exactly 40*500ms=20s despite a 60s
 * hardTimeoutMs, live-reproduced during implementation): the deadline
 * check in bootOrchestrator.ts's executePhase() only helps once retries
 * are actually available to spend.
 */
export const BOOT_PHASE_DEFINITIONS: BootPhaseDefinition[] = [
  {
    id: "desktop-process",
    label: "Desktop-Prozess gestartet",
    dependencies: [],
    optional: false,
    timeouts: { softTimeoutMs: 1_000, hardTimeoutMs: 3_000, retryCount: 0, retryDelayMs: 0 }
  },
  {
    id: "local-config",
    label: "Lokale Konfiguration geladen",
    dependencies: ["desktop-process"],
    optional: false,
    timeouts: { softTimeoutMs: 2_000, hardTimeoutMs: 5_000, retryCount: 1, retryDelayMs: 500 }
  },
  {
    id: "filesystem-check",
    label: "Verzeichnisse, Modelle und Schreibrechte geprüft",
    dependencies: ["local-config"],
    optional: false,
    timeouts: { softTimeoutMs: 3_000, hardTimeoutMs: 10_000, retryCount: 2, retryDelayMs: 500 }
  },
  {
    id: "backend-process-started",
    label: "Backend-Prozess gestartet",
    dependencies: ["filesystem-check"],
    optional: false,
    timeouts: { softTimeoutMs: 3_000, hardTimeoutMs: 15_000, retryCount: 2, retryDelayMs: 1_000 }
  },
  {
    id: "backend-process-alive",
    label: "Backend-Prozess lebt",
    dependencies: ["backend-process-started"],
    optional: false,
    timeouts: { softTimeoutMs: 3_000, hardTimeoutMs: 15_000, retryCount: 2, retryDelayMs: 1_000 }
  },
  {
    id: "backend-health-live",
    label: "Backend-Health-Endpunkt erreichbar",
    dependencies: ["backend-process-alive"],
    optional: false,
    // Cold start (Python interpreter + importing the full FastAPI app
    // graph, then uvicorn bind) is the dominant cost here and was measured
    // exceeding 20s on this machine — 60s matches the timeout the previous
    // (pre-orchestrator) BackendStartupService.ensureStarted() call already
    // relied on in production (main.ts's old `waitUntilReady` path), so
    // this isn't a new, unproven allowance.
    timeouts: { softTimeoutMs: 10_000, hardTimeoutMs: 60_000, retryCount: 150, retryDelayMs: 500 }
  },
  {
    id: "backend-ready",
    label: "Backend vollständig ready",
    dependencies: ["backend-health-live"],
    optional: false,
    timeouts: { softTimeoutMs: 3_000, hardTimeoutMs: 10_000, retryCount: 30, retryDelayMs: 500 }
  },
  {
    id: "database-init",
    label: "Datenbank initialisiert",
    dependencies: ["backend-ready"],
    optional: false,
    timeouts: { softTimeoutMs: 5_000, hardTimeoutMs: 20_000, retryCount: 30, retryDelayMs: 1_000 }
  },
  {
    id: "model-index",
    label: "Modellkatalog geladen",
    dependencies: ["backend-ready", "database-init"],
    optional: false,
    timeouts: { softTimeoutMs: 10_000, hardTimeoutMs: 60_000, retryCount: 40, retryDelayMs: 2_000 }
  },
  {
    id: "runtime-manager-init",
    label: "Runtime Manager initialisiert",
    dependencies: ["backend-ready", "model-index"],
    optional: false,
    timeouts: { softTimeoutMs: 2_000, hardTimeoutMs: 8_000, retryCount: 25, retryDelayMs: 500 }
  },
  {
    id: "resident-model",
    label: "Residentes Basismodell geprüft oder gestartet",
    dependencies: ["runtime-manager-init"],
    optional: true,
    timeouts: { softTimeoutMs: 15_000, hardTimeoutMs: 90_000, retryCount: 40, retryDelayMs: 3_000 }
  },
  {
    id: "frontend-bridge",
    label: "Frontend-Backend-Bridge verbunden",
    dependencies: ["backend-ready"],
    optional: false,
    // The renderer (App.tsx) runs its own internal ~30s retry loop before
    // ever reporting failure for this phase (it mounts hidden and can race
    // backend cold-start) — the hard timeout here must comfortably outlast
    // that, or the orchestrator gives up before the renderer even finishes
    // trying.
    timeouts: { softTimeoutMs: 10_000, hardTimeoutMs: 40_000, retryCount: 3, retryDelayMs: 500 }
  },
  {
    id: "frontend-config-sync",
    label: "Frontend-Konfiguration synchronisiert",
    dependencies: ["frontend-bridge"],
    optional: false,
    timeouts: { softTimeoutMs: 3_000, hardTimeoutMs: 10_000, retryCount: 2, retryDelayMs: 500 }
  },
  {
    id: "workspace-restore",
    label: "Workspace wiederhergestellt",
    dependencies: ["frontend-bridge", "frontend-config-sync"],
    optional: false,
    // Cost scales with workspace size, not just backend latency — measured
    // against a real ~10k-file multi-repo folder during implementation, a
    // 20s hard timeout was too tight for that (legitimate, if unusual) case.
    timeouts: { softTimeoutMs: 8_000, hardTimeoutMs: 45_000, retryCount: 2, retryDelayMs: 1_000 }
  },
  {
    id: "agents-roles-models",
    label: "Agenten, Rollen und Modellzuweisungen geladen",
    dependencies: ["workspace-restore"],
    optional: false,
    timeouts: { softTimeoutMs: 8_000, hardTimeoutMs: 30_000, retryCount: 2, retryDelayMs: 1_000 }
  },
  {
    id: "main-app-released",
    label: "Hauptanwendung freigegeben",
    dependencies: [
      "desktop-process",
      "local-config",
      "filesystem-check",
      "backend-process-started",
      "backend-process-alive",
      "backend-health-live",
      "backend-ready",
      "database-init",
      "model-index",
      "runtime-manager-init",
      "frontend-bridge",
      "frontend-config-sync",
      "workspace-restore",
      "agents-roles-models"
    ],
    optional: false,
    timeouts: { softTimeoutMs: 1_000, hardTimeoutMs: 5_000, retryCount: 0, retryDelayMs: 0 }
  }
];
