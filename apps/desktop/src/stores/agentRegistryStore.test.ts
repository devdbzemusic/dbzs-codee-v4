import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentRegistryStore } from "./agentRegistryStore";

beforeEach(() => {
  useAgentRegistryStore.setState({
    agents: [],
    logs: [],
    selectedAgentId: null,
    selectedAgent: null,
    isLoading: false,
    isMutating: false,
    isLoadingLogs: false,
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
    listAgents: vi.fn().mockResolvedValue([
      {
        id: "agent-one",
        name: "Agent One",
        role: "coder",
        description: "demo",
        command: "node",
        args: ["--version"],
        cwd: null,
        enabled: true,
        created_at: "2026-05-09T00:00:00Z",
        updated_at: "2026-05-09T00:00:00Z",
        status: {
          state: "stopped",
          pid: null,
          message: "",
          updated_at: "2026-05-09T00:00:00Z"
        }
      }
    ]),
    getAgent: vi.fn(),
    createAgent: vi.fn().mockResolvedValue({
      id: "agent-two",
      name: "Agent Two",
      role: "coder",
      description: "new",
      command: "node",
      args: ["--version"],
      cwd: null,
      enabled: true,
      created_at: "2026-05-09T00:00:00Z",
      updated_at: "2026-05-09T00:00:00Z",
      status: {
        state: "stopped",
        pid: null,
        message: "",
        updated_at: "2026-05-09T00:00:00Z"
      }
    }),
    updateAgent: vi.fn().mockResolvedValue({
      id: "agent-one",
      name: "Agent One Updated",
      role: "coder",
      description: "demo",
      command: "node",
      args: ["--version"],
      cwd: null,
      enabled: true,
      created_at: "2026-05-09T00:00:00Z",
      updated_at: "2026-05-09T00:00:00Z",
      status: {
        state: "stopped",
        pid: null,
        message: "",
        updated_at: "2026-05-09T00:00:00Z"
      }
    }),
    startAgent: vi.fn().mockResolvedValue({
      id: "agent-one",
      name: "Agent One",
      role: "coder",
      description: "demo",
      command: "node",
      args: ["--version"],
      cwd: null,
      enabled: true,
      created_at: "2026-05-09T00:00:00Z",
      updated_at: "2026-05-09T00:00:00Z",
      status: {
        state: "running",
        pid: 42,
        message: "started",
        updated_at: "2026-05-09T00:00:00Z"
      }
    }),
    stopAgent: vi.fn().mockResolvedValue({
      id: "agent-one",
      name: "Agent One",
      role: "coder",
      description: "demo",
      command: "node",
      args: ["--version"],
      cwd: null,
      enabled: true,
      created_at: "2026-05-09T00:00:00Z",
      updated_at: "2026-05-09T00:00:00Z",
      status: {
        state: "stopped",
        pid: null,
        message: "stopped",
        updated_at: "2026-05-09T00:00:00Z"
      }
    }),
    deleteAgent: vi.fn().mockResolvedValue({ status: "deleted", agent_id: "agent-one" }),
    listAgentLogs: vi.fn().mockResolvedValue([
      {
        id: 1,
        agent_id: "agent-one",
        level: "info",
        message: "Agent started",
        created_at: "2026-05-09T00:00:00Z"
      }
    ]),
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

describe("useAgentRegistryStore", () => {
  it("loads agents and selects the first entry", async () => {
    await useAgentRegistryStore.getState().loadAgents();

    expect(useAgentRegistryStore.getState().agents).toHaveLength(1);
    expect(useAgentRegistryStore.getState().selectedAgentId).toBe("agent-one");
  });

  it("creates and selects a new agent", async () => {
    await useAgentRegistryStore.getState().createAgent({
      id: "agent-two",
      name: "Agent Two",
      role: "coder",
      description: "new",
      command: "node",
      args: ["--version"],
      enabled: true
    });

    expect(window.dbzs.createAgent).toHaveBeenCalledOnce();
    expect(useAgentRegistryStore.getState().selectedAgentId).toBe("agent-two");
  });

  it("loads logs for selected agent", async () => {
    await useAgentRegistryStore.getState().loadAgents();
    await useAgentRegistryStore.getState().loadSelectedAgentLogs();

    expect(window.dbzs.listAgentLogs).toHaveBeenCalledWith("agent-one", 100);
    expect(useAgentRegistryStore.getState().logs).toHaveLength(1);
  });

  it("deletes selected agent", async () => {
    await useAgentRegistryStore.getState().loadAgents();
    await useAgentRegistryStore.getState().deleteSelectedAgent();

    expect(window.dbzs.deleteAgent).toHaveBeenCalledWith("agent-one");
    expect(useAgentRegistryStore.getState().agents).toHaveLength(0);
    expect(useAgentRegistryStore.getState().selectedAgentId).toBeNull();
  });
});
