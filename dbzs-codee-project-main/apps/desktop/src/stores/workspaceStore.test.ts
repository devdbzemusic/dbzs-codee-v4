import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";

beforeEach(() => {
  useWorkspaceStore.setState({
    state: {
      projectPath: null,
      projectName: null,
      lastOpenedAt: null,
      maxFileScanCount: 2500
    },
    files: [],
    isLoading: false,
    error: null
  });

  window.dbzs = {
    getAppInfo: vi.fn(),
    getBackendHealth: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    openFileDialog: vi.fn(),
    saveFile: vi.fn(),
    selectProjectDirectory: vi.fn(),
    createNewProject: vi.fn(),
    createWorkspaceFolder: vi.fn(),
    scanProjectFiles: vi.fn().mockResolvedValue([]),
    readProjectFile: vi.fn(),
    writeProjectFile: vi.fn(),
    getWorkspaceState: vi.fn().mockResolvedValue({
      projectPath: "D:/repo",
      projectName: "repo",
      lastOpenedAt: "2026-05-10T00:00:00Z",
      maxFileScanCount: 2500
    }),
    setWorkspaceState: vi.fn().mockResolvedValue({
      projectPath: null,
      projectName: null,
      lastOpenedAt: null,
      maxFileScanCount: 2500
    }),
    openSettingsWindow: vi.fn(),
    getModelIndex: vi.fn(),
    getRuntimeStatus: vi.fn(),
    startRuntimeModel: vi.fn(),
    stopRuntimeModel: vi.fn(),
    sendRuntimeChat: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getAgent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    deleteAgent: vi.fn(),
    listAgentLogs: vi.fn().mockResolvedValue([]),
    listProjectMemory: vi.fn().mockResolvedValue([]),
    upsertProjectMemory: vi.fn(),
    deleteProjectMemory: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    analyzeDocs: vi.fn(),
    generateDocs: vi.fn()
  };
});

describe("useWorkspaceStore", () => {
  it("resets workspace state and clears files", async () => {
    useWorkspaceStore.setState({
      state: {
        projectPath: "D:/repo",
        projectName: "repo",
        lastOpenedAt: "2026-05-10T00:00:00Z",
        maxFileScanCount: 2500
      },
      files: [
        {
          path: "D:/repo/src/main.ts",
          relativePath: "src/main.ts",
          name: "main.ts",
          language: "typescript"
        }
      ],
      isLoading: false,
      error: null
    });

    await useWorkspaceStore.getState().resetWorkspace();

    expect(window.dbzs.setWorkspaceState).toHaveBeenCalledOnce();
    expect(useWorkspaceStore.getState().state.projectPath).toBeNull();
    expect(useWorkspaceStore.getState().files).toEqual([]);
  });

  it("persists workspace on saveWorkspace", async () => {
    useWorkspaceStore.setState({
      state: {
        projectPath: "D:/repo",
        projectName: "repo",
        lastOpenedAt: "2026-05-10T00:00:00Z",
        maxFileScanCount: 2500
      },
      files: [],
      isLoading: false,
      error: null,
      status: "ready",
      hasLoadedState: true
    });

    window.dbzs.setWorkspaceState = vi.fn().mockResolvedValue({
      projectPath: "D:/repo",
      projectName: "repo",
      lastOpenedAt: "2026-05-11T00:00:00Z",
      maxFileScanCount: 2500
    });

    await useWorkspaceStore.getState().saveWorkspace();

    expect(window.dbzs.setWorkspaceState).toHaveBeenCalledOnce();
    expect(useWorkspaceStore.getState().state.lastOpenedAt).toBe("2026-05-11T00:00:00Z");
  });
});
