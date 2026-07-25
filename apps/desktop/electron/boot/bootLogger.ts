import type { BootLogLevel } from "@dbzs/shared";
import type { BootOrchestrator } from "./bootOrchestrator.js";

/** Thin helper for desktop-sourced log lines that aren't tied to a specific
 * phase's own runner (e.g. window lifecycle events) — routes into the same
 * merged structured log the splash's BootLogPanel reads from BootState. */
export function createBootLogger(orchestrator: BootOrchestrator) {
  return {
    log(level: BootLogLevel, event: string, message: string, metadata?: Record<string, unknown>): void {
      orchestrator.ingestExternalLog({
        level,
        source: "desktop",
        phaseId: null,
        event,
        message,
        metadata
      });
    }
  };
}

export type BootLogger = ReturnType<typeof createBootLogger>;
