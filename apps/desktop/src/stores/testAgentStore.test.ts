import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectRecommendedCommandIds, useTestAgentStore } from "./testAgentStore";

beforeEach(() => {
  useTestAgentStore.setState({
    allowedCommands: [],
    currentRun: null,
    logs: null,
    history: [],
    stage: "idle",
    summary: "",
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
    analyzeDocs: vi.fn(),
    generateDocs: vi.fn(),
    listAllowedCommands: vi.fn().mockResolvedValue([
      { id: "pnpm_typecheck", label: "pnpm typecheck", command: "pnpm", args: ["typecheck"] }
    ]),
    executeSafeCommand: vi.fn().mockResolvedValue({
      runId: "run-1",
      commandId: "pnpm_typecheck",
      label: "pnpm typecheck",
      status: "running",
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      timedOut: false,
      cancelled: false
    }),
    getSafeCommandRunStatus: vi.fn().mockResolvedValue({
      runId: "run-1",
      commandId: "pnpm_typecheck",
      label: "pnpm typecheck",
      status: "completed",
      exitCode: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      timedOut: false,
      cancelled: false
    }),
    streamSafeCommandLogs: vi.fn().mockResolvedValue({ runId: "run-1", stdout: "ok", stderr: "" }),
    cancelSafeCommand: vi.fn().mockResolvedValue({ cancelled: true })
  };
});

describe("testAgentStore", () => {
  it("loads allowlisted commands", async () => {
    await useTestAgentStore.getState().loadAllowedCommands();
    expect(useTestAgentStore.getState().allowedCommands).toHaveLength(1);
  });

  it("runs a command and stores stdout/stderr", async () => {
    const result = await useTestAgentStore.getState().runCommand("D:/workspace", "pnpm_typecheck");
    expect(result?.status).toBe("completed");
    expect(useTestAgentStore.getState().logs?.stdout).toContain("ok");
  });

  it("selects typecheck before test for pnpm workspace", () => {
    const commandIds = selectRecommendedCommandIds([
      {
        path: "D:/workspace/package.json",
        relativePath: "package.json",
        name: "package.json",
        language: "json"
      },
      {
        path: "D:/workspace/pnpm-lock.yaml",
        relativePath: "pnpm-lock.yaml",
        name: "pnpm-lock.yaml",
        language: "yaml"
      }
    ]);

    expect(commandIds).toEqual(["pnpm_typecheck", "pnpm_test"]);
  });
});
