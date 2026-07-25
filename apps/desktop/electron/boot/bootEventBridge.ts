import { ipcMain, type BrowserWindow } from "electron";
import type { BootState } from "@dbzs/shared";
import type { BootOrchestrator } from "./bootOrchestrator.js";
import { reportFrontendPhase } from "./frontendPhaseReporter.js";

export interface BootEventBridgeDeps {
  orchestrator: BootOrchestrator;
  getWindows: () => BrowserWindow[];
  backendPort: number;
  restartBackendProcess: () => Promise<void>;
  exportDiagnostics: () => Promise<string>;
  requestSafeMode: () => void;
  quitApp: () => void;
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
    (_event, phaseId: string, outcome: "success" | "failed", message: string) => {
      reportFrontendPhase(phaseId, outcome, message ?? "");
    }
  );

  ipcMain.handle("dbzs:boot:retry-phase", async (_event, phaseId: string | null) => {
    if (phaseId) {
      await deps.orchestrator.retryPhase(phaseId);
      return;
    }
    const state = deps.orchestrator.getState();
    for (const phase of state.phases) {
      if (phase.state === "failed" || phase.state === "blocked") {
        await deps.orchestrator.retryPhase(phase.id);
      }
    }
  });

  ipcMain.handle("dbzs:boot:restart-backend", async () => {
    await deps.restartBackendProcess();
    await deps.orchestrator.retryPhase("backend-process-started");
  });

  ipcMain.handle("dbzs:boot:use-fallback-model", async () => {
    await deps.orchestrator.retryPhase("resident-model");
  });

  ipcMain.handle("dbzs:boot:export-diagnostics", async () => deps.exportDiagnostics());

  ipcMain.handle("dbzs:boot:safe-mode", () => {
    deps.requestSafeMode();
  });

  ipcMain.handle("dbzs:boot:quit", () => {
    deps.quitApp();
  });

  let sseStarted = false;
  let sseAbort: AbortController | null = null;
  const unsubscribeSse = deps.orchestrator.onStateChange((state: BootState) => {
    if (sseStarted) return;
    const healthPhase = state.phases.find((p) => p.id === "backend-health-live");
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
