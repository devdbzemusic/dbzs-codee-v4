import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitTelemetryService } from "./gitTelemetryService";

const workspaceRoot = "D:/Dev/repo/dbzs-codee";

describe("GitTelemetryService", () => {
  let filesByPath: Record<string, string>;

  beforeEach(() => {
    filesByPath = {};

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
      readProjectFile: vi.fn().mockImplementation(async (filePath: string) => {
        const content = filesByPath[filePath];
        if (typeof content !== "string") {
          return null;
        }

        const name = filePath.split("/").at(-1) ?? filePath;
        return { path: filePath, name, content, language: "json" };
      }),
      writeProjectFile: vi.fn().mockImplementation(async (filePath: string, content: string) => {
        filesByPath[filePath] = content;
        const name = filePath.split("/").at(-1) ?? filePath;
        return { path: filePath, name, content, language: "json" };
      })
    };
  });

  it("initialisiert leere telemetry wenn keine datei existiert", async () => {
    const service = new GitTelemetryService();
    const telemetry = await service.load(workspaceRoot);

    expect(telemetry.workspaceRoot).toBe(workspaceRoot);
    expect(telemetry.counters.refreshStatus).toBe(0);
    expect(telemetry.counters.createCommit).toBe(0);
  });

  it("zaehlt events hoch und persistiert lokal", async () => {
    const service = new GitTelemetryService();

    await service.increment(workspaceRoot, "refresh_status");
    await service.increment(workspaceRoot, "refresh_status");
    await service.increment(workspaceRoot, "create_commit");

    const telemetry = await service.load(workspaceRoot);
    expect(telemetry.counters.refreshStatus).toBe(2);
    expect(telemetry.counters.createCommit).toBe(1);
    expect(telemetry.counters.selectDiffFile).toBe(0);
  });
});
