import { describe, it, expect } from "vitest";
import type { BackendStartupStatus } from "@dbzs/shared";
import { backendUiStatus, formatBootStateForUi } from "./bootUiFormatter";

describe("formatBootStateForUi", () => {
  const makeStatus = (overrides: Partial<BackendStartupStatus>): BackendStartupStatus => ({
    state: "stopped",
    message: null,
    port: 8876,
    ownership: "unknown",
    instanceId: null,
    ...overrides
  });

  it("sollte 'Backend: offline' für einen null-Status zurückgeben", () => {
    expect(formatBootStateForUi(null)).toBe("Backend: offline");
  });

  it("sollte 'Backend: offline' für den Zustand 'stopped' zurückgeben", () => {
    const status = makeStatus({ state: "stopped", message: "Gestoppt" });
    expect(formatBootStateForUi(status)).toBe("Backend: offline");
  });

  it("sollte 'Backend: startet' für den Zustand 'starting' zurückgeben", () => {
    const status = makeStatus({ state: "starting", message: "Boot-Phase 1/17" });
    expect(formatBootStateForUi(status)).toBe("Backend: startet");
  });

  it("sollte 'Backend: startet' für den Zustand 'idle' zurückgeben", () => {
    const status = makeStatus({ state: "idle", message: "Warte auf Start" });
    expect(formatBootStateForUi(status)).toBe("Backend: startet");
  });

  it("sollte 'Backend: startet' für den Zustand 'live' zurückgeben", () => {
    const status = makeStatus({ state: "live", message: "Endpoint erreichbar" });
    expect(formatBootStateForUi(status)).toBe("Backend: startet");
  });

  it("sollte 'Backend: online' für den Zustand 'ready' zurückgeben", () => {
    const status = makeStatus({ state: "ready", message: "Bereit" });
    expect(formatBootStateForUi(status)).toBe("Backend: online");
  });

  it("sollte 'Backend: beeinträchtigt' für den Zustand 'degraded' zurückgeben", () => {
    const status = makeStatus({ state: "degraded", message: "Fallback aktiv" });
    expect(formatBootStateForUi(status)).toBe("Backend: beeinträchtigt");
    expect(backendUiStatus(status)).toBe("degraded");
  });

  it("sollte 'Backend: Fehler' für den Zustand 'failed' zurückgeben", () => {
    const status = makeStatus({ state: "failed", message: "Port belegt" });
    expect(formatBootStateForUi(status)).toBe("Backend: Fehler (Port belegt)");
  });

  it("sollte 'Backend: Fehler' ohne Nachricht zurückgeben, wenn keine vorhanden ist", () => {
    const status = makeStatus({ state: "failed", message: "" });
    expect(formatBootStateForUi(status)).toBe("Backend: Fehler");
  });
});
