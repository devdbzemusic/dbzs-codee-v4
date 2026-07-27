import { ipcMain, type BrowserWindow } from "electron";
import type { BootState } from "@dbzs/shared";
import type { BootOrchestrator } from "./bootOrchestrator.js";
import { reportFrontendPhase } from "./frontendPhaseReporter.js";

export interface BootEventBridgeDeps {
  orchestrator: BootOrchestrator;
  getWindows: () => BrowserWindow[];
  backendPort: number;
  restartBackendProcess: () => Promise<void>;
  /** Stops the current backend (if any we own) and flags the next spawn to carry DBZS_SAFE_MODE=1. */
  enterSafeModeAndRestartBackend: () => Promise<void>;
  exportDiagnostics: () => Promise<string>;
  requestSafeMode: () => void;
  quitApp: () => void;
}

/**
 * Every phase from backend-spawn through main-app-released -- reset as a
 * group by "restart backend"/"safe mode" (spec §20), since those actions
 * must re-run phases that had already succeeded, not just retry a failed
 * one (that's retryPhase()'s narrower job).
 */
const BACKEND_RESTART_PHASE_GROUP = [
  "backend-spawn",
  "backend-live",
  "backend-startup-api",
  "database-init",
  "model-index",
  "runtime-manager-init",
  "resident-model",
  "backend-ready",
  "frontend-bridge",
  "frontend-config-sync",
  "workspace-restore",
  "agents-roles-models",
  "main-window-rendered",
  "main-app-released"
];

export function collectRetryAllPhaseIds(state: BootState): string[] {
  return state.phases
    .filter((phase) => phase.state === "failed" || phase.state === "blocked")
    .map((phase) => phase.id);
}

function broadcast(deps: BootEventBridgeDeps, channel: string, payload: unknown): void {
  for (const win of deps.getWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

/** Registers the dbzs:boot:* IPC handlers and wires the orchestrator's
 * state changes + the backend's /boot/stream SSE log feed to every window.
 * Returns an unsubscribe function (used by tests / hot-reload teardown). */
export function registerBootEventBridge(deps: BootEventBridgeDeps): () => void {
  const unsubscribeState = deps.orchestrator.onStateChange((state: BootState) => {
    broadcast(deps, "dbzs:boot:state", state);
  });

  ipcMain.handle("dbzs:boot:get-state", () => deps.orchestrator.getState());

  ipcMain.handle(
    "dbzs:boot:report-phase",
    (
      _event,
      phaseId: string,
      state: "success" | "failed",
      message: string,
      progress?: number,
      metadata?: Record<string, unknown>
    ) => {
      reportFrontendPhase(phaseId, state, message ?? "", progress, metadata);
    }
  );

  ipcMain.handle("dbzs:boot:retry-phase", async (_event, phaseId: string | null) => {
    if (phaseId) {
      await deps.orchestrator.retryPhase(phaseId);
      return;
    }
    const retryPhaseIds = collectRetryAllPhaseIds(deps.orchestrator.getState());
    if (retryPhaseIds.length > 0) {
      await deps.orchestrator.resetPhaseGroup(retryPhaseIds);
    }
  });

  ipcMain.handle("dbzs:boot:restart-backend", async () => {
    await deps.restartBackendProcess();
    await deps.orchestrator.resetPhaseGroup(BACKEND_RESTART_PHASE_GROUP);
  });

  ipcMain.handle("dbzs:boot:use-fallback-model", async () => {
    await deps.orchestrator.retryPhase("resident-model");
  });

  ipcMain.handle("dbzs:boot:export-diagnostics", async () => deps.exportDiagnostics());

  ipcMain.handle("dbzs:boot:safe-mode", async () => {
    deps.requestSafeMode();
    await deps.enterSafeModeAndRestartBackend();
    await deps.orchestrator.resetPhaseGroup(BACKEND_RESTART_PHASE_GROUP);
  });

  ipcMain.handle("dbzs:boot:quit", () => {
    deps.quitApp();
  });

  let sseStarted = false;
  let sseAbort: AbortController | null = null;
  const unsubscribeSse = deps.orchestrator.onStateChange((state: BootState) => {
    if (sseStarted) return;
    const healthPhase = state.phases.find((p) => p.id === "backend-live");
    if (healthPhase?.state === "success") {
      sseStarted = true;
      sseAbort = new AbortController();
      void streamBootEvents(deps, sseAbort.signal);
    }
  });

  return () => {
    unsubscribeState();
    unsubscribeSse();
    sseAbort?.abort();
    ipcMain.removeHandler("dbzs:boot:get-state");
    ipcMain.removeHandler("dbzs:boot:report-phase");
    ipcMain.removeHandler("dbzs:boot:retry-phase");
    ipcMain.removeHandler("dbzs:boot:restart-backend");
    ipcMain.removeHandler("dbzs:boot:use-fallback-model");
    ipcMain.removeHandler("dbzs:boot:export-diagnostics");
    ipcMain.removeHandler("dbzs:boot:safe-mode");
    ipcMain.removeHandler("dbzs:boot:quit");
  };
}

async function streamBootEvents(deps: BootEventBridgeDeps, signal: AbortSignal): Promise<void> {
  const url = `http://127.0.0.1:${deps.backendPort}/boot/stream`;
  try {
    const response = await fetch(url, { signal });
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        try {
          const entry = JSON.parse(dataLine.slice("data: ".length));
          deps.orchestrator.ingestExternalLog(entry);
        } catch {
          // malformed SSE payload — skip, not fatal to boot
        }
      }
    }
  } catch {
    // Stream dropped or backend restarted — the splash simply loses live
    // backend log lines, which doesn't affect boot correctness.
  }
}
