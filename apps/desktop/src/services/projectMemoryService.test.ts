import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMemoryService } from "./projectMemoryService";

const workspaceRoot = "D:/Dev/repo/dbzs-codee";

describe("ProjectMemoryService", () => {
  let filesByPath: Record<string, string>;
  let scannedFiles: Array<{ path: string; relativePath: string; name: string; language: string }>;

  beforeEach(() => {
    filesByPath = {};
    scannedFiles = [
      {
        path: `${workspaceRoot}/package.json`,
        relativePath: "package.json",
        name: "package.json",
        language: "json"
      },
      {
        path: `${workspaceRoot}/apps/desktop/electron.vite.config.ts`,
        relativePath: "apps/desktop/electron.vite.config.ts",
        name: "electron.vite.config.ts",
        language: "typescript"
      },
      {
        path: `${workspaceRoot}/apps/desktop/src/App.tsx`,
        relativePath: "apps/desktop/src/App.tsx",
        name: "App.tsx",
        language: "typescript"
      },
      {
        path: `${workspaceRoot}/backend/pyproject.toml`,
        relativePath: "backend/pyproject.toml",
        name: "pyproject.toml",
        language: "toml"
      }
    ];

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
      }),
      scanProjectFiles: vi.fn().mockImplementation(async () => scannedFiles)
    };
  });

  it("erkennt Frameworks beim ersten Laden", async () => {
    const service = new ProjectMemoryService();
    const memory = await service.loadProjectMemory(workspaceRoot);

    expect(memory.frameworks).toEqual(expect.arrayContaining(["node", "typescript", "electron", "react", "python"]));
    expect(memory.languages).toEqual(expect.arrayContaining(["json", "typescript", "toml"]));
  });

  it("speichert und laedt Memory aus .codee/project-memory.json", async () => {
    const service = new ProjectMemoryService();
    const first = await service.loadProjectMemory(workspaceRoot);

    const updated = await service.updateProjectMemory({
      ...first,
      architectureNotes: [...first.architectureNotes, "Custom architecture note"]
    });

    expect(updated.architectureNotes).toContain("Custom architecture note");

    const reloaded = await service.loadProjectMemory(workspaceRoot);
    expect(reloaded.architectureNotes).toContain("Custom architecture note");
  });

  it("fuegt KnownIssue hinzu", async () => {
    const service = new ProjectMemoryService();
    await service.loadProjectMemory(workspaceRoot);

    const next = await service.addKnownIssue({
      id: "issue-1",
      title: "Race condition",
      description: "Task queue status kann doppelt gesetzt werden.",
      severity: "high"
    });

    expect(next.knownIssues).toHaveLength(1);
    expect(next.knownIssues[0]?.title).toContain("Race condition");
  });

  it("markiert wichtige Dateien", async () => {
    const service = new ProjectMemoryService();
    await service.loadProjectMemory(workspaceRoot);

    const next = await service.markImportantFile("apps/desktop/src/components/WorkspaceExplorer.tsx", "Zentrale Navigation");

    expect(next.importantFiles.some((entry) => entry.path.includes("WorkspaceExplorer.tsx"))).toBe(true);
  });

  it("behandelt leere Projekte", async () => {
    scannedFiles = [];
    const service = new ProjectMemoryService();
    const memory = await service.loadProjectMemory(workspaceRoot);

    expect(memory.frameworks).toHaveLength(0);
    expect(memory.languages).toHaveLength(0);
    expect(memory.importantFiles).toHaveLength(0);
  });
});
