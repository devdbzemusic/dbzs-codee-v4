import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import type { BootReadinessComponent } from "@dbzs/shared";
import type { BackendStartupService } from "../backendStartupService.js";
import type { BackendReadinessProbe } from "./backendReadinessProbe.js";
import type { PhaseRunner, PhaseRunnerResult } from "./bootOrchestrator.js";
import { waitForFrontendPhase } from "./frontendPhaseReporter.js";

export interface PhaseRunnerDeps {
  backendStartup: BackendStartupService;
  probe: BackendReadinessProbe;
  userDataDir: string;
  /** Wraps the existing loadWorkspaceState() call (main.ts) as a tracked boot phase. */
  loadLocalConfig: () => Promise<void>;
  onBackendPid: (pid: number | null) => void;
  onDetectedModelCount: (count: number | null) => void;
  onResidentModelId: (id: string | null) => void;
}

/** Normalizes a component's progress/total pair (or bare progress) to 0-100. */
function normalizeProgress(progress?: number | null, total?: number | null): number {
  if (
    typeof progress === "number" &&
    typeof total === "number" &&
    Number.isFinite(progress) &&
    Number.isFinite(total) &&
    total > 0
  ) {
    return Math.min(100, Math.max(0, Math.round((progress / total) * 100)));
  }
  if (typeof progress === "number" && Number.isFinite(progress)) {
    return Math.min(100, Math.max(0, progress));
  }
  return 0;
}

/**
 * Maps a backend readiness component onto a PhaseRunnerResult. Non-terminal
 * component states (pending/waiting/running) map to outcome:"pending" — not
 * "failed" — so the orchestrator's pollCount (not retryCount) advances while
 * waiting for a component to finish initializing. Treating "still working"
 * as a failure was the root cause of a real production bug (see
 * bootPhaseDefinitions.ts's history): the retry-count ceiling, not the
 * intended hard timeout, silently ended phases early.
 */
function componentResult(
  component: BootReadinessComponent | undefined,
  reportProgress: (progress: number, message?: string) => void,
  readyLabel: string
): PhaseRunnerResult {
  if (!component) {
    return { outcome: "pending", message: "Backend hat noch keinen Komponentenstatus gemeldet.", pollAfterMs: 500 };
  }

  const progress = normalizeProgress(component.progress, component.total);
  reportProgress(progress, component.message);

  switch (component.state) {
    case "success":
      return { outcome: "success", message: component.message ?? readyLabel, metadata: component.data };

    case "warning":
      return { outcome: "warning", message: component.message ?? readyLabel, metadata: component.data };

    case "skipped":
      return { outcome: "skipped", message: component.message ?? "Übersprungen.", metadata: component.data };

    case "failed":
      return {
        outcome: "failed",
        message: component.message ?? "Komponente fehlgeschlagen.",
        error: {
          code: component.error?.code ?? "component-failed",
          message: component.message ?? "Komponente fehlgeschlagen.",
          technicalDetail: component.error?.technicalDetail,
          exitCode: component.error?.exitCode,
          stderrTail: component.error?.stderrTail
        },
        metadata: component.data
      };

    case "pending":
    case "waiting":
    case "running":
      return {
        outcome: "pending",
        message: component.message ?? "Komponente wird initialisiert.",
        progress,
        pollAfterMs: 500,
        metadata: component.data
      };

    default:
      return {
        outcome: "failed",
        message: `Unbekannter Komponentenstatus: ${String(component.state)}`,
        error: { code: "unknown-component-state", message: `Unbekannter Komponentenstatus: ${String(component.state)}` }
      };
  }
}

async function waitFrontend(phaseId: string, signal: AbortSignal, label: string): Promise<PhaseRunnerResult> {
  try {
    const message = await waitForFrontendPhase(phaseId, signal);
    return { outcome: "success", message: message || label };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: "failed", message, error: { code: "frontend-phase-failed", message } };
  }
}

export function createPhaseRunners(deps: PhaseRunnerDeps): Record<string, PhaseRunner> {
  return {
    "desktop-process": async () => ({ outcome: "success", message: "Desktop-Prozess läuft." }),

    "local-config": async () => {
      await deps.loadLocalConfig();
      return { outcome: "success", message: "Lokale Konfiguration geladen." };
    },

    "filesystem-check": async () => {
      await mkdir(deps.userDataDir, { recursive: true });
      await access(deps.userDataDir, fsConstants.W_OK);
      return { outcome: "success", message: `Schreibrechte bestätigt: ${deps.userDataDir}` };
    },

    "backend-process-started": async () => {
      const status = await deps.backendStartup.ensureStarted({ waitUntilReady: false });
      if (status.state === "failed") {
        return { outcome: "failed", message: status.message ?? "Backend-Start fehlgeschlagen.", error: { code: "spawn-failed", message: status.message ?? "" } };
      }
      return { outcome: "success", message: "Backend-Prozess gestartet." };
    },

    "backend-process-alive": async () => {
      const pid = deps.backendStartup.getPid();
      const status = deps.backendStartup.getStatus();
      if (status.state === "failed") {
        return { outcome: "failed", message: status.message ?? "Backend-Prozess beendet.", error: { code: "process-exited", message: status.message ?? "" } };
      }
      if (pid == null) {
        return { outcome: "pending", message: "Warte auf Backend-Prozess-PID...", pollAfterMs: 500 };
      }
      deps.onBackendPid(pid);
      return { outcome: "success", message: `Backend-Prozess lebt (PID ${pid}).` };
    },

    "backend-health-live": async (ctx) => {
      const result = await deps.probe.probeLive(ctx.signal);
      if (!result.ok) {
        return { outcome: "pending", message: "Backend-Health-Endpunkt noch nicht erreichbar.", pollAfterMs: 500 };
      }
      if (result.pid != null) deps.onBackendPid(result.pid);
      return { outcome: "success", message: "Backend-Health-Endpunkt erreichbar." };
    },

    "backend-ready": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      if (!readiness || typeof readiness.status !== "string") {
        return { outcome: "pending", message: "Backend-Readiness-Endpunkt noch nicht bereit.", pollAfterMs: 500 };
      }
      return { outcome: "success", message: "Backend-Readiness-Subsystem bereit." };
    },

    "database-init": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      return componentResult(readiness?.components.database, ctx.reportProgress, "Datenbank bereit.");
    },

    "model-index": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      const component = readiness?.components.modelRegistry;
      if (component?.total != null) deps.onDetectedModelCount(component.total);
      return componentResult(component, ctx.reportProgress, "Modellkatalog geladen.");
    },

    "runtime-manager-init": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      return componentResult(readiness?.components.runtimeManager, ctx.reportProgress, "Runtime Manager bereit.");
    },

    "resident-model": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      const component = readiness?.components.residentModel;
      if (component?.state === "success" && component.message) {
        deps.onResidentModelId(component.message);
      }
      return componentResult(component, ctx.reportProgress, "Residentes Modell bereit.");
    },

    "frontend-bridge": (ctx) => waitFrontend("frontend-bridge", ctx.signal, "Frontend-Bridge verbunden."),
    "frontend-config-sync": (ctx) => waitFrontend("frontend-config-sync", ctx.signal, "Frontend-Konfiguration synchronisiert."),
    "workspace-restore": (ctx) => waitFrontend("workspace-restore", ctx.signal, "Workspace wiederhergestellt."),
    "agents-roles-models": (ctx) => waitFrontend("agents-roles-models", ctx.signal, "Agenten und Modelle geladen."),

    "main-app-released": async () => ({ outcome: "success", message: "Hauptanwendung freigegeben." })
  };
}
