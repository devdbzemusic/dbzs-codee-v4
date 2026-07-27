import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocsAnalysisStore } from "./docsAnalysisStore";

beforeEach(() => {
  useDocsAnalysisStore.setState({
    workspaceRoot: "",
    summary: null,
    markdown: "",
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
    analyzeDocs: vi.fn().mockResolvedValue({
      scanned_at: "2026-05-10T00:00:00Z",
      workspace_root: "D:/repo",
      files_scanned: 10,
      directories_scanned: 2,
      todo_count: 1,
      top_extensions: [],
      largest_files: []
    }),
    generateDocs: vi.fn()
  };
});

describe("useDocsAnalysisStore", () => {
  it("analyzes workspace", async () => {
    useDocsAnalysisStore.getState().setWorkspaceRoot("D:/repo");
    await useDocsAnalysisStore.getState().analyze();

    expect(useDocsAnalysisStore.getState().summary?.files_scanned).toBe(10);
  });
});
