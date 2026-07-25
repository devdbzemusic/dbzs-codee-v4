import type { BootPhasePolicy } from "@dbzs/shared";

export interface BootPhaseDefinition {
  id: string;
  label: string;
  description?: string;
  dependencies: string[];
  optional: boolean;
  /** Whether the main window's release must wait for this phase to reach a terminal state. */
  blocksWindowRelease: boolean;
  timeouts: BootPhasePolicy;
}

/**
 * The 16 boot phases, in dependency order. Phase 16 ("main-app-released")
 * intentionally omits "resident-model" (11) from its dependencies — that
 * phase is optional, so its failure degrades the boot instead of blocking
 * the main window (confirmed decision: resident-model is optional/degraded,
 * degraded boots auto-continue to the main window).
 *
 * Phases 6-11 (backend-health-live, backend-ready, database-init,
 * model-index, runtime-manager-init, resident-model) poll a backend
 * component that may still be initializing. Their runners (phaseRunners.ts)
 * report this via outcome:"pending", which the orchestrator tracks with its
 * own `pollCount` and reschedules via `pollIntervalMs` — bounded purely by
 * `hardTimeoutMs`, never by `maxRetries`. `maxRetries`/`retryDelayMs` here
 * are reserved for genuine failures only (a real exception, an unexpected
 * component "failed" state) and are deliberately small, unlike an earlier
 * version of this file where they had to be inflated to survive a
 * retry-count-doubles-as-poll-count hack (a real bug: backend-health-live
 * failed at exactly 40*500ms=20s despite a 60s hardTimeoutMs, because the
 * retry ceiling — not the intended deadline — silently ended the phase).
 */
export const BOOT_PHASE_DEFINITIONS: BootPhaseDefinition[] = [
  {
    id: "desktop-process",
    label: "Desktop-Prozess gestartet",
    dependencies: [],
    optional: false,
    blocksWindowRelease: true,
    // maxRetries/retryDelayMs are 0 (this phase never actually retries or
    // polls), but pollIntervalMs must stay > 0 per validateBootGraph's own
    // invariant (check 9) — it's simply never consumed for a phase that
    // completes synchronously.
    timeouts: {
      softTimeoutMs: 1_000,
      hardTimeoutMs: 3_000,
      pollIntervalMs: 100,
      maxRetries: 0,
      retryDelayMs: 0,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "local-config",
    label: "Lokale Konfiguration geladen",
    dependencies: ["desktop-process"],
    optional: false,
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 2_000,
      hardTimeoutMs: 5_000,
      pollIntervalMs: 500,
      maxRetries: 1,
      retryDelayMs: 500,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "filesystem-check",
    label: "Verzeichnisse, Modelle und Schreibrechte geprüft",
    dependencies: ["local-config"],
    optional: false,
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 3_000,
      hardTimeoutMs: 10_000,
      pollIntervalMs: 500,
      maxRetries: 2,
      retryDelayMs: 500,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "backend-process-started",
    label: "Backend-Prozess gestartet",
    dependencies: ["filesystem-check"],
    optional: false,
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 3_000,
      hardTimeoutMs: 15_000,
      pollIntervalMs: 1_000,
      maxRetries: 2,
      retryDelayMs: 1_000,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "backend-process-alive",
    label: "Backend-Prozess lebt",
    dependencies: ["backend-process-started"],
    optional: false,
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 3_000,
      hardTimeoutMs: 15_000,
      pollIntervalMs: 1_000,
      maxRetries: 2,
      retryDelayMs: 1_000,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "backend-health-live",
    label: "Backend-Health-Endpunkt erreichbar",
    dependencies: ["backend-process-alive"],
    optional: false,
    blocksWindowRelease: true,
    // Cold start (Python interpreter + importing the full FastAPI app
    // graph, then uvicorn bind) is the dominant cost here and was measured
    // exceeding 20s on this machine — 60s matches the timeout the previous
    // (pre-orchestrator) BackendStartupService.ensureStarted() call already
    // relied on in production (main.ts's old `waitUntilReady` path), so
    // this isn't a new, unproven allowance.
    timeouts: {
      softTimeoutMs: 10_000,
      hardTimeoutMs: 60_000,
      pollIntervalMs: 500,
      maxRetries: 2,
      retryDelayMs: 500,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "backend-ready",
    label: "Backend vollständig ready",
    dependencies: ["backend-health-live"],
    optional: false,
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 3_000,
      hardTimeoutMs: 10_000,
      pollIntervalMs: 500,
      maxRetries: 2,
      retryDelayMs: 500,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "database-init",
    label: "Datenbank initialisiert",
    dependencies: ["backend-ready"],
    optional: false,
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 5_000,
      hardTimeoutMs: 20_000,
      pollIntervalMs: 1_000,
      maxRetries: 2,
      retryDelayMs: 1_000,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "model-index",
    label: "Modellkatalog geladen",
    dependencies: ["backend-ready", "database-init"],
    optional: false,
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 10_000,
      hardTimeoutMs: 60_000,
      pollIntervalMs: 2_000,
      maxRetries: 2,
      retryDelayMs: 2_000,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "runtime-manager-init",
    label: "Runtime Manager initialisiert",
    dependencies: ["backend-ready", "model-index"],
    optional: false,
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 2_000,
      hardTimeoutMs: 8_000,
      pollIntervalMs: 500,
      maxRetries: 2,
      retryDelayMs: 500,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "resident-model",
    label: "Residentes Basismodell geprüft oder gestartet",
    dependencies: ["runtime-manager-init"],
    optional: true,
    // Kept false in this step for behavioral parity with the current
    // main-app-released dependency list (below), which still omits
    // resident-model. The boot-repair spec's semantic reversal
    // (blocksWindowRelease = true) lands together with the phase
    // reorder/rename step, not here.
    blocksWindowRelease: false,
    timeouts: {
      softTimeoutMs: 15_000,
      hardTimeoutMs: 90_000,
      pollIntervalMs: 3_000,
      maxRetries: 2,
      retryDelayMs: 3_000,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "frontend-bridge",
    label: "Frontend-Backend-Bridge verbunden",
    dependencies: ["backend-ready"],
    optional: false,
    blocksWindowRelease: true,
    // The renderer (App.tsx) runs its own internal ~30s retry loop before
    // ever reporting failure for this phase (it mounts hidden and can race
    // backend cold-start) — the hard timeout here must comfortably outlast
    // that, or the orchestrator gives up before the renderer even finishes
    // trying.
    timeouts: {
      softTimeoutMs: 10_000,
      hardTimeoutMs: 40_000,
      pollIntervalMs: 500,
      maxRetries: 3,
      retryDelayMs: 500,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "frontend-config-sync",
    label: "Frontend-Konfiguration synchronisiert",
    dependencies: ["frontend-bridge"],
    optional: false,
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 3_000,
      hardTimeoutMs: 10_000,
      pollIntervalMs: 500,
      maxRetries: 2,
      retryDelayMs: 500,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "workspace-restore",
    label: "Workspace wiederhergestellt",
    dependencies: ["frontend-bridge", "frontend-config-sync"],
    optional: false,
    blocksWindowRelease: true,
    // Cost scales with workspace size, not just backend latency — measured
    // against a real ~10k-file multi-repo folder during implementation, a
    // 20s hard timeout was too tight for that (legitimate, if unusual) case.
    timeouts: {
      softTimeoutMs: 8_000,
      hardTimeoutMs: 45_000,
      pollIntervalMs: 1_000,
      maxRetries: 2,
      retryDelayMs: 1_000,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  },
  {
    id: "agents-roles-models",
    label: "Agenten, Rollen und Modellzuweisungen geladen",
    dependencies: ["workspace-restore"],
    optional: false,
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 8_000,
      hardTimeoutMs: 30_000,
      pollIntervalMs: 1_000,
      maxRetries: 2,
      retryDelayMs: 1_000,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
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
    blocksWindowRelease: true,
    timeouts: {
      softTimeoutMs: 1_000,
      hardTimeoutMs: 5_000,
      pollIntervalMs: 100,
      maxRetries: 0,
      retryDelayMs: 0,
      extendDeadlineOnProgress: false,
      maxDeadlineExtensionMs: 0
    }
  }
];
