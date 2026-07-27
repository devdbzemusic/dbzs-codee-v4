import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MissionControlPanel,
  resolveNextAction,
  shouldShowMissionControl,
  type MissionControlPanelProps
} from "./MissionControlPanel";

vi.mock("@/stores/runtimeStore", () => ({
  useRuntimeStore: () => ({
    doctorReport: null,
    doctorLoading: false,
    actionResult: null,
    logs: null,
    status: { state: "stopped" },
    isLoading: false,
    loadDoctorReport: vi.fn(),
    loadLogs: vi.fn(),
    dryRunModel: vi.fn(),
    probeModel: vi.fn(),
    startModel: vi.fn(),
    stopModel: vi.fn()
  })
}));

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const baseProps: MissionControlPanelProps = {
  backendStartupStatus: { state: "failed", message: "uv/python nicht gefunden", port: 8876 },
  backendOnline: false,
  backendError: "uv/python nicht gefunden",
  electronBridgeActive: true,
  workspaceName: null,
  workspacePath: null,
  workspaceFileCount: 0,
  modelIndexLoading: false,
  modelIndexError: null,
  modelTotal: null,
  readyLlamaCount: 0,
  readyOllamaCount: 0,
  readyModelCount: 0,
  runtimeState: "stopped",
  runtimeModelName: null,
  runtimeMessage: null,
  openJobCount: 0,
  runningJobCount: 0,
  failedJobCount: 0,
  onReloadBackend: vi.fn(),
  onOpenWorkspace: vi.fn(),
  onScanWorkspace: vi.fn(),
  onReloadModels: vi.fn(),
  onStopRuntime: vi.fn()
};

describe("shouldShowMissionControl", () => {
  it("shows when backend is not ready", () => {
    expect(
      shouldShowMissionControl({
        activeTab: null,
        workspacePath: "D:/repo",
        backendOnline: false,
        backendStartupStatus: { state: "starting", message: null, port: 8876 },
        modelIndex: { summary: { total: 1 } }
      })
    ).toBe(true);
  });

  it("hides when tab, workspace, backend and model index are ready", () => {
    expect(
      shouldShowMissionControl({
        activeTab: { id: "tab-1" },
        workspacePath: "D:/repo",
        backendOnline: true,
        backendStartupStatus: { state: "ready", message: null, port: 8876 },
        modelIndex: { summary: { total: 3 } }
      })
    ).toBe(false);
  });
});

describe("MissionControlPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders backend errors", () => {
    act(() => {
      root.render(<MissionControlPanel {...baseProps} />);
    });

    expect(container.textContent).toContain("uv/python nicht gefunden");
    expect(container.textContent).toContain("failed");
    expect(resolveNextAction(baseProps)).toContain("Backend-Fehler");
  });

  it("renders open-project action when no workspace is configured", () => {
    act(() => {
      root.render(
        <MissionControlPanel
          {...baseProps}
          backendError={null}
          backendOnline
          backendStartupStatus={{ state: "ready", message: null, port: 8876 }}
        />
      );
    });

    expect(container.textContent).toContain("Projekt öffnen");
    expect(resolveNextAction({
      ...baseProps,
      backendError: null,
      backendOnline: true,
      backendStartupStatus: { state: "ready", message: null, port: 8876 }
    })).toContain("Projekt öffnen");
  });

  it("suggests runtime doctor golden path when workspace and index are ready", () => {
    expect(
      resolveNextAction({
        ...baseProps,
        backendError: null,
        backendOnline: true,
        backendStartupStatus: { state: "ready", message: null, port: 8876 },
        workspacePath: "D:/repo",
        workspaceFileCount: 12,
        modelTotal: 5,
        runtimeState: "stopped"
      })
    ).toContain("Runtime Doctor");
  });
});
