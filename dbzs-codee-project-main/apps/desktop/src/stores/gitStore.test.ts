import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGitStore } from "./gitStore";
import { useWorkspaceStore } from "./workspaceStore";

beforeEach(() => {
  vi.restoreAllMocks();

  useWorkspaceStore.setState({
    state: {
      projectPath: "D:/repo",
      projectName: "repo",
      lastOpenedAt: null,
      maxFileScanCount: 2500
    }
  });

  useGitStore.setState({
    repositoryStatus: null,
    currentBranch: "",
    changedEntries: [],
    diffSummary: [],
    selectedFilePath: null,
    selectedDiff: "",
    commitSuggestion: null,
    isLoading: false,
    error: null
  });

  globalThis.window = globalThis.window || ({} as Window & typeof globalThis);
  window.dbzs = {
    getAppInfo: vi.fn(),
    getBackendHealth: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    getModelIndex: vi.fn(),
    getRuntimeStatus: vi.fn(),
    startRuntimeModel: vi.fn(),
    stopRuntimeModel: vi.fn(),
    sendRuntimeChat: vi.fn(),
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    deleteAgent: vi.fn(),
    listAgentLogs: vi.fn(),
    listProjectMemory: vi.fn(),
    upsertProjectMemory: vi.fn(),
    deleteProjectMemory: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    analyzeDocs: vi.fn(),
    generateDocs: vi.fn(),
    getGitRepositoryStatus: vi.fn().mockResolvedValue({
      isRepository: true,
      workspaceRoot: "D:/repo",
      currentBranch: "feature/git-intelligence",
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      hasUncommittedChanges: true,
      entries: [
        {
          filePath: "src/App.tsx",
          status: "modified"
        }
      ],
      updatedAt: new Date().toISOString()
    }),
    getGitCurrentBranch: vi.fn().mockResolvedValue("feature/git-intelligence"),
    getGitChangedFiles: vi.fn().mockResolvedValue([
      {
        filePath: "src/App.tsx",
        status: "modified"
      }
    ]),
    getGitDiff: vi.fn().mockResolvedValue("diff --git a/src/App.tsx b/src/App.tsx"),
    getGitDiffSummary: vi.fn().mockResolvedValue([
      {
        filePath: "src/App.tsx",
        additions: 12,
        deletions: 3,
        summary: "12 additions, 3 deletions"
      }
    ]),
    getGitCommitSuggestion: vi.fn().mockResolvedValue({
      title: "feat: update app shell",
      body: "Add git intelligence panel",
      affectedFiles: ["src/App.tsx"],
      riskLevel: "low"
    }),
    validateGitRepository: vi.fn().mockResolvedValue(true),
    openFileDialog: vi.fn().mockResolvedValue(null),
    saveFile: vi.fn().mockResolvedValue(undefined)
  };
});

describe("useGitStore", () => {
  it("laedt repository-status, diff-summary und commit-vorschlag", async () => {
    await useGitStore.getState().refreshGitStatus();

    const state = useGitStore.getState();
    expect(state.currentBranch).toBe("feature/git-intelligence");
    expect(state.changedEntries).toHaveLength(1);
    expect(state.diffSummary).toHaveLength(1);
    expect(state.repositoryStatus?.aheadCount).toBe(2);
    expect(state.repositoryStatus?.behindCount).toBe(1);
    expect(state.commitSuggestion?.title).toBe("feat: update app shell");
    expect(window.dbzs.getGitDiff).toHaveBeenCalledWith("D:/repo", "src/App.tsx");
  });

  it("laedt full diff wenn keine datei ausgewaehlt wird", async () => {
    window.dbzs.getGitDiff = vi.fn().mockResolvedValue("full diff");

    await useGitStore.getState().selectDiffFile(null);

    const state = useGitStore.getState();
    expect(state.selectedFilePath).toBeNull();
    expect(state.selectedDiff).toBe("full diff");
    expect(window.dbzs.getGitDiff).toHaveBeenCalledWith("D:/repo", undefined);
  });

  it("laedt datei diff bei datei-auswahl", async () => {
    window.dbzs.getGitDiff = vi.fn().mockResolvedValue("file diff");

    await useGitStore.getState().selectDiffFile("src/App.tsx");

    const state = useGitStore.getState();
    expect(state.selectedFilePath).toBe("src/App.tsx");
    expect(state.selectedDiff).toBe("file diff");
    expect(window.dbzs.getGitDiff).toHaveBeenCalledWith("D:/repo", "src/App.tsx");
  });

  it("setzt fehler wenn workspace fehlt", async () => {
    useWorkspaceStore.setState({
      state: {
        projectPath: null,
        projectName: null,
        lastOpenedAt: null,
        maxFileScanCount: 2500
      }
    });

    await useGitStore.getState().refreshGitStatus();

    expect(useGitStore.getState().error).toContain("Kein Workspace aktiv");
  });
});
