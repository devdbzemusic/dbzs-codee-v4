import { describe, it, expect } from "vitest";
import type { BackendStartupStatus } from "@dbzs/shared";
import { formatBootStateForUi } from "./bootUiFormatter";

describe("formatBootStateForUi", () => {
  it("sollte 'Backend: offline' für einen null-Status zurückgeben", () => {
    expect(formatBootStateForUi(null)).toBe("Backend: offline");
  });

  it("sollte 'Backend: offline' für den Zustand 'stopped' zurückgeben", () => {
    const status: BackendStartupStatus = { state: "stopped", message: "Gestoppt" };
    expect(formatBootStateForUi(status)).toBe("Backend: offline");
  });

  it("sollte 'Backend: startet' für den Zustand 'starting' zurückgeben", () => {
    const status: BackendStartupStatus = { state: "starting", message: "Boot-Phase 1/17" };
    expect(formatBootStateForUi(status)).toBe("Backend: startet");
  });

  it("sollte 'Backend: startet' für den Zustand 'idle' zurückgeben", () => {
    const status: BackendStartupStatus = { state: "idle", message: "Warte auf Start" };
    expect(formatBootStateForUi(status)).toBe("Backend: startet");
  });

  it("sollte 'Backend: online' für den Zustand 'ready' zurückgeben", () => {
    const status: BackendStartupStatus = { state: "ready", message: "Bereit" };
    expect(formatBootStateForUi(status)).toBe("Backend: online");
  });

  it("sollte 'Backend: Fehler' für den Zustand 'failed' zurückgeben", () => {
    const status: BackendStartupSTatus = { state: "failed", message: "Port belegt" };
    expect(formatBootStateForUi(status)).toBe("Backend: Fehler (Port belegt)");
  });

  it("sollte 'Backend: Fehler' ohne Nachricht zurückgeben, wenn keine vorhanden ist", () => {
    const status: BackendStartupStatus = { state: "failed", message: "" };
    expect(formatBootStateForUi(status)).toBe("Backend: Fehler");
  });

  it("sollte 'Backend: beeinträchtigt' für den Zustand 'degraded' zurückgeben", () => {
    // Annahme: 'degraded' wird zum Schema hinzugefügt
    const status: BackendStartupStatus = { state: "degraded", message: "Ein Slot fehlgeschlagen" };
    expect(formatBootStateForUi(status)).toBe("Backend: beeinträchtigt");
  });

  it("sollte 'Backend: startet' für den Zustand 'live' zurückgeben", () => {
    // Annahme: 'live' wird zum Schema hinzugefügt
    const status: BackendStartupStatus = { state: "live", message: "Prozess läuft, aber nicht bereit" };
    expect(formatBootStateForUi(status)).toBe("Backend: startet");
  });
});
