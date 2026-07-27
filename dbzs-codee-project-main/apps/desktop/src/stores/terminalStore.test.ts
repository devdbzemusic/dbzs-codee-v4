import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalStore } from "./terminalStore";

function ensureLocalStorage(): void {
  if (typeof globalThis.localStorage !== "undefined") {
    return;
  }

  let store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      clear: () => {
        store = {};
      },
      getItem: (key: string) => store[key] ?? null,
      key: (index: number) => Object.keys(store)[index] ?? null,
      removeItem: (key: string) => {
        delete store[key];
      },
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      get length() {
        return Object.keys(store).length;
      }
    }
  });
}

beforeEach(() => {
  ensureLocalStorage();
  globalThis.window = globalThis.window || ({} as Window & typeof globalThis);
  localStorage.clear();
  const session = {
    id: "terminal-test",
    name: "Terminal 1",
    cwd: "",
    output: "",
    error: "",
    isRunning: false,
    commandHistory: []
  };
  useTerminalStore.setState({
    sessions: [session],
    activeSessionId: session.id,
    activeView: "terminal"
  });
});

describe("useTerminalStore", () => {
  it("uses workspace root as active terminal cwd", () => {
    useTerminalStore.getState().useWorkspaceRoot("D:/repo");

    expect(useTerminalStore.getState().sessions[0].cwd).toBe("D:/repo");
  });

  it("runs commands with the workspace cwd", async () => {
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
      analyzeDocs: vi.fn(),
      generateDocs: vi.fn(),
      terminalStop: vi.fn().mockResolvedValue({ stopped: true }),
      terminalExec: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", code: 0 })
    };
    useTerminalStore.getState().useWorkspaceRoot("D:/repo");

    await useTerminalStore.getState().runCommand("dir");

    expect(window.dbzs.terminalExec).toHaveBeenCalledWith({
      command: "dir",
      args: [],
      cwd: "D:/repo",
      timeoutMs: 30_000
    });
  });

  it("stops an active running session", async () => {
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
      analyzeDocs: vi.fn(),
      generateDocs: vi.fn(),
      terminalExec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 }),
      terminalStop: vi.fn().mockResolvedValue({ stopped: true })
    };

    useTerminalStore.setState((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === "terminal-test"
          ? { ...session, isRunning: true, output: "> npm test\n" }
          : session
      )
    }));

    await useTerminalStore.getState().stopActive();

    expect(window.dbzs.terminalStop).toHaveBeenCalledWith("terminal-test");
    expect(useTerminalStore.getState().sessions[0].isRunning).toBe(false);
  });
});
