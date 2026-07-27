import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskBoardStore } from "./taskBoardStore";

beforeEach(() => {
  useTaskBoardStore.setState({
    tasks: [],
    isLoading: false,
    isMutating: false,
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
    listTasks: vi.fn().mockResolvedValue([
      {
        id: "task_1",
        title: "Ship feature",
        description: "",
        status: "todo",
        priority: 3,
        created_at: "2026-05-10T00:00:00Z",
        updated_at: "2026-05-10T00:00:00Z"
      }
    ]),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    analyzeDocs: vi.fn(),
    generateDocs: vi.fn()
  };
});

describe("useTaskBoardStore", () => {
  it("loads tasks", async () => {
    await useTaskBoardStore.getState().loadTasks();

    expect(useTaskBoardStore.getState().tasks).toHaveLength(1);
  });
});
