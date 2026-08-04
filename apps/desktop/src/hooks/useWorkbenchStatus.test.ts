import { describe, expect, it } from "vitest";
import type { BackendStartupStatus } from "@dbzs/shared";
import { deriveWorkbenchStatus } from "./useWorkbenchStatus";

function backendStatus(state: BackendStartupStatus["state"], message?: string): BackendStartupStatus {
  return {
    state,
    message: message ?? null,
    port: 8876,
    ownership: "spawned-by-desktop",
    instanceId: null
  };
}

describe("deriveWorkbenchStatus", () => {
  it("maps a ready backend and running runtime into success/running items", () => {
    const result = deriveWorkbenchStatus({
      backendStartupStatus: backendStatus("ready"),
      runtimeState: "running",
      runtimeProvider: "llama.cpp",
      workspaceName: "repo"
    });

    expect(result.workspaceLabel).toBe("repo");
    expect(result.items).toEqual([
      { label: "Desktop", value: "Desktop bereit", tone: "success" },
      { label: "Backend", value: "Backend: online", tone: "success", tooltip: undefined },
      { label: "Runtime", value: "llama.cpp aktiv", tone: "running", tooltip: "Provider: llama.cpp" }
    ]);
  });

  it("shows model readiness counts when no runtime is active", () => {
    const result = deriveWorkbenchStatus({
      backendStartupStatus: backendStatus("starting"),
      runtimeState: "stopped",
      readyLocalModels: 2,
      totalModels: 5
    });

    expect(result.workspaceLabel).toBe("Kein Workspace");
    expect(result.items[1]).toMatchObject({ label: "Backend", tone: "warning", value: "Backend: startet" });
    expect(result.items[2]).toMatchObject({ label: "Runtime", tone: "warning", value: "2/5 bereit" });
    expect(result.items[2]?.tooltip).toBeUndefined();
  });

  it("falls back to indexing and offline states when nothing is ready", () => {
    const indexing = deriveWorkbenchStatus({
      backendStartupStatus: backendStatus("stopped"),
      modelIndexLoading: true
    });
    expect(indexing.items[1]).toMatchObject({ tone: "danger", value: "Backend: offline" });
    expect(indexing.items[2]).toMatchObject({ tone: "neutral", value: "indexiere…" });

    const idle = deriveWorkbenchStatus({
      backendStartupStatus: backendStatus("failed", "Port belegt"),
      modelIndexLoading: false
    });
    expect(idle.items[1]).toMatchObject({
      tone: "danger",
      value: "Backend: Fehler (Port belegt)",
      tooltip: "Port belegt"
    });
    expect(idle.items[2]).toMatchObject({ tone: "neutral", value: "Kein Modell aktiv" });
  });
});
