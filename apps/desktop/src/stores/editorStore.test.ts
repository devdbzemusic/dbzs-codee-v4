import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "./editorStore";

beforeEach(() => {
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    isBusy: false,
    error: null,
    snapshots: {},
    pendingChanges: {},
    proposedChanges: {},
    appliedChanges: [],
    activePendingChange: null
  });

  window.dbzs = {
    getAppInfo: vi.fn(),
    getBackendHealth: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    openFileDialog: vi.fn(),
    saveFile: vi.fn(),
    createWorkspaceFileSnapshot: vi.fn().mockResolvedValue({
      snapshotId: "snap-1",
      filePath: "D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md",
      existed: true
    }),
    createWorkspaceDiff: vi.fn().mockResolvedValue({
      snapshotId: "snap-1",
      beforeContent: "old",
      afterContent: "new",
      diff: "--- before\n+++ after\n-old\n+new"
    }),
    applyWorkspacePatch: vi.fn().mockResolvedValue({
      snapshotId: "snap-1",
      file: {
        path: "D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md",
        name: "SYSTEM.md",
        content: "new",
        language: "markdown"
      },
      diff: "--- before\n+++ after\n-old\n+new"
    }),
    restoreWorkspaceSnapshot: vi.fn().mockResolvedValue({
      restored: true,
      snapshotId: "snap-1",
      file: {
        path: "D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md",
        name: "SYSTEM.md",
        content: "old",
        language: "markdown"
      }
    }),
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
    generateDocs: vi.fn()
  };
});

describe("useEditorStore", () => {
  it("opens a selected file as the active clean tab", async () => {
    window.dbzs.openFileDialog = vi.fn().mockResolvedValue({
      path: "D:\\Dev\\repo\\dbzs-codee\\README.md",
      name: "README.md",
      content: "# DBZS",
      language: "markdown"
    });

    await useEditorStore.getState().openFile();

    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTab?.name).toBe("README.md");
    expect(state.activeTab?.isDirty).toBe(false);
  });

  it("marks the active tab dirty when content changes", async () => {
    window.dbzs.openFileDialog = vi.fn().mockResolvedValue({
      path: "D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md",
      name: "SYSTEM.md",
      content: "old",
      language: "markdown"
    });
    await useEditorStore.getState().openFile();

    useEditorStore.getState().updateActiveContent("new");

    expect(useEditorStore.getState().activeTab?.content).toBe("new");
    expect(useEditorStore.getState().activeTab?.isDirty).toBe(true);
  });

  it("saves the active tab and clears dirty state", async () => {
    window.dbzs.openFileDialog = vi.fn().mockResolvedValue({
      path: "D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md",
      name: "SYSTEM.md",
      content: "old",
      language: "markdown"
    });
    window.dbzs.saveFile = vi.fn().mockResolvedValue({
      path: "D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md",
      name: "SYSTEM.md",
      content: "new",
      language: "markdown"
    });
    await useEditorStore.getState().openFile();
    useEditorStore.getState().updateActiveContent("new");

    await useEditorStore.getState().saveActiveFile();

    expect(window.dbzs.saveFile).toHaveBeenCalledWith({
      path: "D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md",
      content: "new"
    });
    expect(useEditorStore.getState().activeTab?.isDirty).toBe(false);
  });

  it("creates pending change for workspace files instead of writing directly", async () => {
    window.dbzs.readProjectFile = vi.fn().mockResolvedValue({
      path: "D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md",
      name: "SYSTEM.md",
      content: "old",
      language: "markdown"
    });

    await useEditorStore.getState().openWorkspaceFile("D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md");
    useEditorStore.getState().updateActiveContent("new");

    await useEditorStore.getState().saveActiveFile();

    expect(window.dbzs.createWorkspaceFileSnapshot).toHaveBeenCalledWith("D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md");
    expect(window.dbzs.createWorkspaceDiff).toHaveBeenCalledWith("D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md", "new");
    expect(useEditorStore.getState().activePendingChange?.filePath).toBe("D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md");
    expect(window.dbzs.writeProjectFile).toBeUndefined();
  });

  it("applies and restores a pending workspace change", async () => {
    window.dbzs.readProjectFile = vi.fn().mockResolvedValue({
      path: "D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md",
      name: "SYSTEM.md",
      content: "old",
      language: "markdown"
    });

    await useEditorStore.getState().openWorkspaceFile("D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md");
    useEditorStore.getState().updateActiveContent("new");
    await useEditorStore.getState().saveActiveFile();

    await useEditorStore.getState().applyPendingChange("D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md");
    expect(window.dbzs.applyWorkspacePatch).toHaveBeenCalledWith(
      "D:\\Dev\\repo\\dbzs-codee\\SYSTEM.md",
      "new",
      "snap-1",
      {
        reason: "before_patch",
        label: "Before patch apply: SYSTEM.md",
        relatedRunId: undefined,
        relatedChangeIds: undefined
      }
    );
    expect(useEditorStore.getState().activeTab?.isDirty).toBe(false);

    await useEditorStore.getState().restoreSnapshot("snap-1");
    expect(window.dbzs.restoreWorkspaceSnapshot).toHaveBeenCalledWith("snap-1");
    expect(useEditorStore.getState().activeTab?.content).toBe("old");
  });

  it("speichert ProposedChange als pending im Safe Editing Layer", async () => {
    await useEditorStore.getState().queueProposedChanges([
      {
        id: "pc-1",
        agentId: "runtime-chat",
        filePath: "D:/Dev/repo/dbzs-codee/SYSTEM.md",
        proposedContent: "new",
        reason: "Agent update",
        createdAt: new Date().toISOString(),
        status: "pending"
      }
    ]);

    const state = useEditorStore.getState();
    expect(state.pendingChanges["D:/Dev/repo/dbzs-codee/SYSTEM.md"]?.source).toBe("agent");
    expect(state.proposedChanges["pc-1"]?.status).toBe("pending");
    expect(window.dbzs.createWorkspaceFileSnapshot).toHaveBeenCalledWith("D:/Dev/repo/dbzs-codee/SYSTEM.md");
    expect(window.dbzs.createWorkspaceDiff).toHaveBeenCalledWith("D:/Dev/repo/dbzs-codee/SYSTEM.md", "new");
  });

  it("wendet ProposedChange ueber Safe Layer an", async () => {
    window.dbzs.readProjectFile = vi.fn().mockResolvedValue({
      path: "D:/Dev/repo/dbzs-codee/SYSTEM.md",
      name: "SYSTEM.md",
      content: "old",
      language: "markdown"
    });

    await useEditorStore.getState().openWorkspaceFile("D:/Dev/repo/dbzs-codee/SYSTEM.md");
    await useEditorStore.getState().queueProposedChanges([
      {
        id: "pc-2",
        agentId: "runtime-chat",
        filePath: "D:/Dev/repo/dbzs-codee/SYSTEM.md",
        proposedContent: "new",
        reason: "Agent update",
        createdAt: new Date().toISOString(),
        status: "pending"
      }
    ]);

    await useEditorStore.getState().applyPendingChange("D:/Dev/repo/dbzs-codee/SYSTEM.md");

    expect(window.dbzs.applyWorkspacePatch).toHaveBeenCalledWith(
      "D:/Dev/repo/dbzs-codee/SYSTEM.md",
      "new",
      "snap-1",
      {
        reason: "before_agent_run",
        label: "Before agent patch: SYSTEM.md",
        relatedRunId: "runtime-chat",
        relatedChangeIds: ["pc-2"]
      }
    );
    expect(useEditorStore.getState().proposedChanges["pc-2"]?.status).toBe("applied");
  });

  it("reject setzt Status und schreibt keine Datei", async () => {
    await useEditorStore.getState().queueProposedChanges([
      {
        id: "pc-3",
        agentId: "runtime-chat",
        filePath: "D:/Dev/repo/dbzs-codee/SYSTEM.md",
        proposedContent: "new",
        reason: "Agent update",
        createdAt: new Date().toISOString(),
        status: "pending"
      }
    ]);

    useEditorStore.getState().rejectProposedChange("pc-3");

    expect(useEditorStore.getState().proposedChanges["pc-3"]?.status).toBe("rejected");
    expect(window.dbzs.applyWorkspacePatch).not.toHaveBeenCalled();
  });
});
