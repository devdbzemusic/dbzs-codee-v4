import { describe, expect, it } from "vitest";
import type { BootPhase, BootState } from "@dbzs/shared";
import { buildBootDiagnosticExport } from "./bootDiagnosticExport.js";

function phase(partial: Partial<BootPhase> & { id: string }): BootPhase {
  return {
    label: partial.id,
    state: "success",
    progress: 100,
    message: "",
    dependencies: [],
    optional: false,
    blocksWindowRelease: true,
    pollCount: 0,
    retryCount: 0,
    details: [],
    ...partial
  };
}

function bootState(phases: BootPhase[]): BootState {
  return {
    runId: "run-1",
    status: "failed",
    currentPhaseId: null,
    overallProgress: 50,
    phases,
    startedAt: 0,
    finishedAt: 1000,
    backendPid: null,
    backendPort: null,
    activeRuntimeSlot: null,
    residentModelId: null,
    detectedModelCount: null,
    lastErrorMessage: null
  };
}

describe("buildBootDiagnosticExport", () => {
  it("redacts secrets found in phase messages, log details, and error fields", () => {
    const state = bootState([
      phase({
        id: "backend-live",
        state: "failed",
        message: "auth failed with sk-abcdefghijklmnop",
        error: {
          code: "component-failed",
          message: "auth failed with sk-abcdefghijklmnop",
          technicalDetail: "Bearer abcdef123456",
          retryAttempts: 0
        },
        details: [
          {
            timestamp: 1,
            level: "error",
            source: "backend",
            phaseId: "backend-live",
            event: "phase-failed",
            message: "token=super-secret-value rejected"
          }
        ]
      })
    ]);

    const result = buildBootDiagnosticExport({ bootState: state, appVersion: "1.0.0" });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-abcdefghijklmnop");
    expect(serialized).not.toContain("abcdef123456");
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).toContain("[REDACTED]");
  });

  it("still carries non-secret diagnostic fields through untouched", () => {
    const state = bootState([phase({ id: "desktop-process", message: "Desktop-Prozess läuft." })]);

    const result = buildBootDiagnosticExport({ bootState: state, appVersion: "1.0.0" });

    expect(result.runId).toBe("run-1");
    expect(result.phases[0].id).toBe("desktop-process");
    expect(result.phases[0].message).toBe("Desktop-Prozess läuft.");
  });
});
