import type { BootPhasePolicy } from "@dbzs/shared";

export interface BootPhaseDefinition {
  id: string;
  label: string;
  description?: string;
  dependencies: string[];
  optional: boolean;
  /** If false, this phase is skipped when the application is started in safe mode. Defaults to true. */
  safeMode?: boolean;
  /** Whether the main window's release must wait for this phase to reach a terminal state. */
  blocksWindowRelease: boolean;
  timeouts: BootPhasePolicy;
}

/**
 * The 17 boot phases, in dependency order (boot-repair spec §7). Two roles
 * that used to be conflated under a single early "backend-ready" phase are
 * now split:
 *
 * - "backend-startup-api" (06): the readiness *subsystem* is reachable
 *   (GET /health/startup responds) -- not that anything is actually ready.
 * - "backend-ready" (11): the real aggregate -- GET /health/ready reports
 *   `ready:true`, which only happens once database/modelRegistry/
 *   runtimeManager have all succeeded and resident-model has reached some
 *   terminal state.
 *
 * "resident-model" (10) is optional, but `blocksWindowRelease: true`: since
 * "backend-ready" now depends on it, the splash waits for it to reach ANY
 * terminal state (success/warning/skipped/failed) before continuing --
 * failure alone does not cascade-block, only a genuinely stuck (blocked)
 * optional dependency does (see BootOrchestrator.dependenciesSatisfied/
 * applyBlocking). A failed resident-model still degrades the overall run
 * status to "degraded", it just no longer bypasses this wait entirely.
 *
 * Phases 07-11 (database-init, model-index, runtime-manager-init,
 * resident-model, backend-ready) poll a backend component that may still be
 * initializing. Their runners (phaseRunners.ts) report this via
 * outcome:"pending", tracked via pollCount and rescheduled via
 * pollIntervalMs -- bounded purely by hardTimeoutMs, never by maxRetries.
 * maxRetries/retryDelayMs are reserved for genuine failures only.
 */
export const BOOT_PHASE_DEFINITIONS: BootPhaseDefinition[] = [
  {
    id: "desktop-process",
    label: "Desktop-Prozess gestartet",
    dependencies: [],
    optional: false,
    safeMode: true,
    blocksWindowRelease: true,
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
    safeMode: true,
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
    safeMode: true,
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
    id: "backend-spawn",
    label: "Backend-Prozess gestartet",
    description: "Spawnt den Backend-Prozess (oder erkennt einen bereits laufenden) und bestätigt dessen PID.",
    dependencies: ["filesystem-check"],
    optional: false,
    safeMode: true,
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
    id: "backend-live",
    label: "Backend-Health-Endpunkt erreichbar",
    dependencies: ["backend-spawn"],
    safeMode: true,
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
    id: "backend-startup-api",
    label: "Backend-Readiness-Subsystem erreichbar",
    description: "Prüft nur, dass GET /health/startup antwortet -- nicht, dass etwas bereits bereit ist.",
    dependencies: ["backend-live"],
    safeMode: true,
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
    dependencies: ["backend-startup-api"],
    safeMode: true,
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
    dependencies: ["database-init"],
    safeMode: true,
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
    dependencies: ["model-index"],
    safeMode: true,
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
    safeMode: false, // Dies ist die entscheidende Änderung für den Safe-Mode
    optional: true,
    // Semantic reversal from the pre-repair version: the splash now waits
    // for this phase to reach ANY terminal state before releasing the main
    // window (see module docstring above), rather than silently excluding
    // it from the release-gating chain entirely.
    blocksWindowRelease: true,
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
    id: "backend-ready",
    label: "Backend vollständig ready",
    description: "Pollt das echte GET /health/ready -- ready:true erst wenn alle Pflichtkomponenten erfolgreich sind.",
    dependencies: ["runtime-manager-init", "resident-model"],
    safeMode: true,
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
    id: "frontend-bridge",
    label: "Frontend-Backend-Bridge verbunden",
    dependencies: ["backend-ready"],
    safeMode: true,
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
    safeMode: true,
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
    safeMode: true,
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
    safeMode: false, // Kann im Safe-Mode ebenfalls übersprungen werden
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
    id: "main-window-rendered",
    label: "Hauptfenster vollständig gerendert",
    description: "Wartet auf den Renderer-Paint-Ack (doppeltes requestAnimationFrame) statt nur auf Electrons ready-to-show.",
    dependencies: ["agents-roles-models"],
    safeMode: true,
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
    id: "main-app-released",
    label: "Hauptanwendung freigegeben",
    dependencies: ["main-window-rendered"],
    safeMode: true,
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

/**
 * Weighted contribution of each phase toward the splash's overall progress
 * bar (repair spec §19) -- a flat per-phase average would make trivial
 * instant phases (desktop-process) count as much as genuinely slow ones
 * (model-index, resident-model), making the bar jump unevenly. Any phase id
 * not listed here defaults to weight 1 in computeOverallProgress() (should
 * not happen once validateBootGraph has run, but never crashes if it does).
 */
export const PHASE_WEIGHTS: Record<string, number> = {
  "desktop-process": 1,
  "local-config": 2,
  "filesystem-check": 4,
  "backend-spawn": 5,
  "backend-live": 5,
  "backend-startup-api": 3,
  "database-init": 7,
  "model-index": 20,
  "runtime-manager-init": 10,
  "resident-model": 20,
  "backend-ready": 5,
  "frontend-bridge": 4,
  "frontend-config-sync": 3,
  "workspace-restore": 5,
  "agents-roles-models": 3,
  "main-window-rendered": 2,
  "main-app-released": 1
};
