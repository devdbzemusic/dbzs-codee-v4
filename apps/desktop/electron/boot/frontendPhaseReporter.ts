/**
 * Bridges phases 12-15 (frontend-bridge, frontend-config-sync,
 * workspace-restore, agents-roles-models) between the main-process
 * orchestrator and the renderer, which is where that work actually
 * happens (App.tsx's existing loaders — see App.tsx's boot-phase
 * reporting calls). The renderer calls `dbzs:boot:report-phase` (wired
 * to `reportFrontendPhase` in bootEventBridge.ts) once it has genuinely
 * completed (or failed) a tracked phase; the corresponding phaseRunner
 * awaits `waitForFrontendPhase` for that same phase id.
 */

interface PendingEntry {
  resolve: (message: string) => void;
  reject: (error: Error) => void;
}

interface BufferedReport {
  outcome: "success" | "failed";
  message: string;
}

const pending = new Map<string, PendingEntry>();
// The renderer mounts (and can complete its own checks) before the
// orchestrator's phase-12..15 runners even start listening — those only
// begin once their own dependencies (e.g. backend-ready) succeed, seconds
// later. Without a mailbox, an early report has nowhere to land and is
// silently lost, leaving `waitForFrontendPhase` waiting forever for a
// report that already happened. Buffer the most recent report per phase so
// a late-arriving waiter can pick it up immediately.
const buffered = new Map<string, BufferedReport>();

export function waitForFrontendPhase(phaseId: string, signal: AbortSignal): Promise<string> {
  const existing = buffered.get(phaseId);
  if (existing) {
    buffered.delete(phaseId);
    return existing.outcome === "success" ? Promise.resolve(existing.message) : Promise.reject(new Error(existing.message));
  }

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => {
      pending.delete(phaseId);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pending.set(phaseId, {
      resolve: (message) => {
        signal.removeEventListener("abort", onAbort);
        resolve(message);
      },
      reject: (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    });
  });
}

export function reportFrontendPhase(phaseId: string, outcome: "success" | "failed", message: string): void {
  const entry = pending.get(phaseId);
  if (!entry) {
    // No one is waiting yet (renderer ran ahead of the orchestrator phase)
    // — buffer it instead of dropping it.
    buffered.set(phaseId, { outcome, message });
    return;
  }
  pending.delete(phaseId);
  if (outcome === "success") {
    entry.resolve(message);
  } else {
    entry.reject(new Error(message));
  }
}
