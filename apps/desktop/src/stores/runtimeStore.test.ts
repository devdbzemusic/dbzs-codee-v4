import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRuntimeStore } from "./runtimeStore";

beforeEach(() => {
  useRuntimeStore.setState({
    status: null,
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
    getRuntimeStatus: vi.fn().mockResolvedValue({
      state: "stopped",
      provider: null,
      model_id: null,
      model_name: null,
      port: null,
      pid: null,
      endpoint: null,
      message: ""
    }),
    startRuntimeModel: vi.fn().mockResolvedValue({
      state: "running",
      provider: "llama.cpp",
      model_id: "coder",
      model_name: "Coder",
      port: 8081,
      pid: 42,
      endpoint: "http://127.0.0.1:8081",
      message: "started"
    }),
    stopRuntimeModel: vi.fn().mockResolvedValue({
      state: "stopped",
      provider: null,
      model_id: null,
      model_name: null,
      port: null,
      pid: null,
      endpoint: null,
      message: "stopped"
    }),
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

describe("useRuntimeStore", () => {
  it("starts a selected runtime model", async () => {
    await useRuntimeStore.getState().startModel("coder");

    expect(window.dbzs.startRuntimeModel).toHaveBeenCalledWith("coder", undefined);
    expect(useRuntimeStore.getState().status?.state).toBe("running");
  });

  it("forwards an explicit tuning profile when starting a model", async () => {
    await useRuntimeStore.getState().startModel("coder", "large_context");

    expect(window.dbzs.startRuntimeModel).toHaveBeenCalledWith("coder", "large_context");
  });

  it("stops the runtime", async () => {
    await useRuntimeStore.getState().stopModel();

    expect(window.dbzs.stopRuntimeModel).toHaveBeenCalledOnce();
    expect(useRuntimeStore.getState().status?.state).toBe("stopped");
  });
});
