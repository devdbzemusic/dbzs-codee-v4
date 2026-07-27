import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectMemoryStore } from "./projectMemoryStore";

beforeEach(() => {
  useProjectMemoryStore.setState({
    workspace: "default",
    entries: [],
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
    listProjectMemory: vi.fn().mockResolvedValue([
      {
        id: 1,
        workspace: "default",
        memory_key: "context",
        content: "phase 4",
        tags: ["phase4"],
        created_at: "2026-05-10T00:00:00Z",
        updated_at: "2026-05-10T00:00:00Z"
      }
    ]),
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

describe("useProjectMemoryStore", () => {
  it("loads project memory entries", async () => {
    await useProjectMemoryStore.getState().loadEntries();

    expect(useProjectMemoryStore.getState().entries).toHaveLength(1);
  });
});
