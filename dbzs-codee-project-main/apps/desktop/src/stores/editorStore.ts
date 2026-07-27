import { create } from "zustand";
import { useNotebookStore } from "@/stores/notebookStore";
import type { ProposedChange, WorkspaceFile } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ragClient } from "@/services/ragClient";
import { isPathInsideWorkspace } from "@/utils/workspacePathUtils";

interface UndoRedoState {
  undo: string[];
  redo: string[];
}

interface BaseEditorTab {
  id: string;
  type: "file" | "chat";
  title: string;
}

export interface FileEditorTab extends BaseEditorTab, WorkspaceFile {
  type: "file";
  id: string;
  isDirty: boolean;
  savedContent: string;
  source: "dialog" | "workspace";
  undoRedo: UndoRedoState;
}

export interface ChatEditorTab extends BaseEditorTab {
  type: "chat";
  name: string;
  path: string;
  content: string;
  language: string;
  isDirty: boolean;
  savedContent: string;
  source: "workspace";
  undoRedo: UndoRedoState;
}

export type EditorTab = FileEditorTab | ChatEditorTab;

interface ConflictNavigationTarget {
  filePath: string;
  line: number;
}

export interface FileChangeSnapshotState {
  snapshotId: string;
  filePath: string;
  createdAt: string;
  existed: boolean;
}

export interface PendingFileChangeState {
  snapshotId: string;
  filePath: string;
  label: string;
  beforeContent: string;
  afterContent: string;
  diff: string;
  createdAt: string;
  source: "manual" | "agent";
  proposedChangeId?: string;
  agentId?: string;
  reason?: string;
}

export interface AppliedFileChangeState {
  snapshotId: string;
  filePath: string;
  appliedAt: string;
  action: "apply" | "restore";
}

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  isBusy: boolean;
  error: string | null;
  activeTab: EditorTab | null;
  lastActiveFileTabId: string | null;
  lastSavedAt: string | null;
  hasWorkspacePatchUndo: boolean;
  snapshots: Record<string, FileChangeSnapshotState>;
  pendingChanges: Record<string, PendingFileChangeState>;
  proposedChanges: Record<string, ProposedChange>;
  appliedChanges: AppliedFileChangeState[];
  activePendingChange: PendingFileChangeState | null;
  conflictNavigationTarget: ConflictNavigationTarget | null;
  openFile: () => Promise<void>;
  openWorkspaceFile: (filePath: string) => Promise<void>;
  openWorkspaceConflictFile: (filePath: string, line?: number) => Promise<void>;
  openRuntimeChatTab: () => void;
  restoreWorkspaceTabs: (projectPath: string) => Promise<void>;
  undoLastSavedWorkspacePatch: () => Promise<void>;
  clearConflictNavigationTarget: () => void;
  selectTab: (tabId: string) => void;
  updateActiveContent: (content: string) => void;
  undoActiveTab: () => void;
  redoActiveTab: () => void;
  saveActiveFile: () => Promise<void>;
  saveActiveFileAs: () => Promise<void>;
  queueProposedChanges: (changes: ProposedChange[]) => Promise<void>;
  applyPendingChange: (filePath?: string) => Promise<void>;
  discardPendingChange: (filePath?: string) => void;
  rejectProposedChange: (proposedChangeId: string) => void;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  closeTab: (tabId: string) => void;
}

export function isFileEditorTab(tab: EditorTab | null | undefined): tab is FileEditorTab {
  return tab?.type === "file";
}

function toTab(file: WorkspaceFile, source: "dialog" | "workspace"): FileEditorTab {
  return {
    ...file,
    type: "file",
    title: file.name,
    id: file.path,
    isDirty: false,
    savedContent: file.content,
    source,
    undoRedo: { undo: [], redo: [] }
  };
}

function deriveActiveTab(tabs: EditorTab[], activeTabId: string | null): EditorTab | null {
  return tabs.find((tab) => tab.id === activeTabId) ?? null;
}

function deriveLastActiveFileTabId(tabs: EditorTab[], activeTabId: string | null): string | null {
  const active = deriveActiveTab(tabs, activeTabId);
  if (isFileEditorTab(active)) {
    return active.id;
  }

  const lastFile = [...tabs].reverse().find((tab): tab is FileEditorTab => isFileEditorTab(tab));
  return lastFile?.id ?? null;
}

function withLimitedHistory(history: string[]): string[] {
  return history.slice(-100);
}

function toFileLabel(filePath: string): string {
  const segments = filePath.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? filePath;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  isBusy: false,
  error: null,
  activeTab: null,
  lastActiveFileTabId: null,
  lastSavedAt: null,
  hasWorkspacePatchUndo: false,
  snapshots: {},
  pendingChanges: {},
  proposedChanges: {},
  appliedChanges: [],
  activePendingChange: null,
  conflictNavigationTarget: null,
  openFile: async () => {
    set({ isBusy: true, error: null });
    try {
      const file = await window.dbzs.openFileDialog();
      if (!file) {
        set({ isBusy: false });
        return;
      }

      const existing = get().tabs.find((tab) => isFileEditorTab(tab) && tab.path === file.path);
      const tabs = existing
        ? get().tabs
        : [...get().tabs, toTab(file, "dialog")];
      const activeTabId = file.path;
      set({
        tabs,
        activeTabId,
        activeTab: deriveActiveTab(tabs, activeTabId),
        lastActiveFileTabId: activeTabId,
        activePendingChange: deriveActivePendingChange(get().pendingChanges, activeTabId, tabs),
        isBusy: false
      });
      useNotebookStore.getState().focusEditorTab();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Datei konnte nicht geoeffnet werden",
        isBusy: false
      });
    }
  },
  openWorkspaceFile: async (filePath) => {
    set({ isBusy: true, error: null });
    try {
      const file = await window.dbzs.readProjectFile?.(filePath);
      if (!file) {
        set({ isBusy: false, error: "Projektdatei konnte nicht geladen werden." });
        return;
      }

      const existing = get().tabs.find((tab) => isFileEditorTab(tab) && tab.path === file.path);
      const tabs = existing
        ? get().tabs
        : [...get().tabs, toTab(file, "workspace")];
      const activeTabId = file.path;

      set({
        tabs,
        activeTabId,
        activeTab: deriveActiveTab(tabs, activeTabId),
        lastActiveFileTabId: activeTabId,
        activePendingChange: deriveActivePendingChange(get().pendingChanges, activeTabId, tabs),
        isBusy: false
      });
      useNotebookStore.getState().focusEditorTab();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Projektdatei konnte nicht geoeffnet werden",
        isBusy: false
      });
    }
  },
  openWorkspaceConflictFile: async (filePath, line = 1) => {
    await get().openWorkspaceFile(filePath);
    set({ conflictNavigationTarget: { filePath, line } });
  },
  openRuntimeChatTab: () => {
    const existing = get().tabs.find((tab) => tab.id === "runtime-chat");
    const chatTab: ChatEditorTab =
      existing && !isFileEditorTab(existing)
        ? existing
        : {
            id: "runtime-chat",
            type: "chat",
            title: "Runtime Chat",
            name: "Runtime Chat",
            path: "runtime-chat",
            content: "",
            language: "markdown",
            isDirty: false,
            savedContent: "",
            source: "workspace",
            undoRedo: { undo: [], redo: [] }
          };

    const tabs = existing ? get().tabs : [...get().tabs, chatTab];
    set({
      tabs,
      activeTabId: chatTab.id,
      activeTab: chatTab,
      activePendingChange: null
    });
  },
  restoreWorkspaceTabs: async () => {
    const tabs = get().tabs;
    const lastActiveFileTabId = get().lastActiveFileTabId;
    if (tabs.length > 0 || !lastActiveFileTabId) {
      return;
    }

    await get().openWorkspaceFile(lastActiveFileTabId);
  },
  undoLastSavedWorkspacePatch: async () => {
    const activeTab = get().activeTab;
    if (!isFileEditorTab(activeTab) || activeTab.source !== "workspace" || !window.dbzs.undoLastWorkspaceWrite) {
      return;
    }

    set({ isBusy: true, error: null });
    try {
      const result = await window.dbzs.undoLastWorkspaceWrite(activeTab.path);
      if (!result.file) {
        set({ isBusy: false, hasWorkspacePatchUndo: result.hasUndo });
        return;
      }

      const restoredFile = result.file;
      const tabs = get().tabs.map((tab) => {
        if (!isFileEditorTab(tab) || tab.id !== activeTab.id) {
          return tab;
        }
        return {
          ...tab,
          ...restoredFile,
          title: restoredFile.name,
          savedContent: restoredFile.content,
          content: restoredFile.content,
          isDirty: false,
          undoRedo: { undo: [], redo: [] }
        };
      });
      set({
        tabs,
        activeTab: deriveActiveTab(tabs, activeTab.id),
        hasWorkspacePatchUndo: result.hasUndo,
        isBusy: false
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Patch-Undo konnte nicht ausgefuehrt werden",
        isBusy: false
      });
    }
  },
  clearConflictNavigationTarget: () => {
    set({ conflictNavigationTarget: null });
  },
  selectTab: (tabId) => {
    const tabs = get().tabs;
    set({
      activeTabId: tabId,
      activeTab: deriveActiveTab(tabs, tabId),
      lastActiveFileTabId: deriveLastActiveFileTabId(tabs, tabId),
      activePendingChange: deriveActivePendingChange(get().pendingChanges, tabId, tabs)
    });
  },
  updateActiveContent: (content) => {
    const activeTabId = get().activeTabId;
    if (!activeTabId) {
      return;
    }

    const tabs = get().tabs.map((tab) => {
      if (!isFileEditorTab(tab) || tab.id !== activeTabId) {
        return tab;
      }

      if (tab.content === content) {
        return tab;
      }

      return {
        ...tab,
        content,
        isDirty: content !== tab.savedContent,
        undoRedo: {
          undo: withLimitedHistory([...tab.undoRedo.undo, tab.content]),
          redo: []
        }
      };
    });
    set({ tabs, activeTab: deriveActiveTab(tabs, activeTabId) });
  },
  undoActiveTab: () => {
    const activeTabId = get().activeTabId;
    if (!activeTabId) {
      return;
    }

    const tabs = get().tabs.map((tab) => {
      if (!isFileEditorTab(tab) || tab.id !== activeTabId || tab.undoRedo.undo.length === 0) {
        return tab;
      }

      const nextContent = tab.undoRedo.undo[tab.undoRedo.undo.length - 1] ?? tab.content;
      const nextUndo = tab.undoRedo.undo.slice(0, -1);
      return {
        ...tab,
        content: nextContent,
        isDirty: nextContent !== tab.savedContent,
        undoRedo: {
          undo: nextUndo,
          redo: withLimitedHistory([tab.content, ...tab.undoRedo.redo])
        }
      };
    });

    set({ tabs, activeTab: deriveActiveTab(tabs, activeTabId) });
  },
  redoActiveTab: () => {
    const activeTabId = get().activeTabId;
    if (!activeTabId) {
      return;
    }

    const tabs = get().tabs.map((tab) => {
      if (!isFileEditorTab(tab) || tab.id !== activeTabId || tab.undoRedo.redo.length === 0) {
        return tab;
      }

      const [nextContent, ...restRedo] = tab.undoRedo.redo;
      const content = nextContent ?? tab.content;
      return {
        ...tab,
        content,
        isDirty: content !== tab.savedContent,
        undoRedo: {
          undo: withLimitedHistory([...tab.undoRedo.undo, tab.content]),
          redo: restRedo
        }
      };
    });

    set({ tabs, activeTab: deriveActiveTab(tabs, activeTabId) });
  },
  saveActiveFile: async () => {
    const activeTab = get().activeTab;
    if (!isFileEditorTab(activeTab)) {
      return;
    }

    set({ isBusy: true, error: null });
    try {
      if (activeTab.source === "workspace") {
        if (!window.dbzs.createWorkspaceFileSnapshot || !window.dbzs.createWorkspaceDiff) {
          throw new Error("Diff/Patch-Bridge ist nicht verfuegbar.");
        }

        const snapshot = await window.dbzs.createWorkspaceFileSnapshot(activeTab.path);
        const diffResult = await window.dbzs.createWorkspaceDiff(activeTab.path, activeTab.content);
        const pending: PendingFileChangeState = {
          snapshotId: diffResult.snapshotId,
          filePath: activeTab.path,
          label: activeTab.name,
          beforeContent: diffResult.beforeContent,
          afterContent: diffResult.afterContent,
          diff: diffResult.diff,
          createdAt: new Date().toISOString(),
          source: "manual"
        };

        set((state) => ({
          snapshots: {
            ...state.snapshots,
            [snapshot.snapshotId]: {
              snapshotId: snapshot.snapshotId,
              filePath: snapshot.filePath,
              createdAt: new Date().toISOString(),
              existed: snapshot.existed
            }
          },
          pendingChanges: {
            ...state.pendingChanges,
            [activeTab.path]: pending
          },
          activePendingChange:
            state.activeTabId === activeTab.id
              ? pending
              : state.activePendingChange,
          isBusy: false
        }));
        return;
      }

      const saved = await window.dbzs.saveFile({
        path: activeTab.path,
        content: activeTab.content
      });
      const tabs = get().tabs.map((tab) =>
        isFileEditorTab(tab) && tab.id === activeTab.id
          ? {
              ...tab,
              ...saved,
              title: saved.name,
              isDirty: false,
              savedContent: saved.content,
              undoRedo: { undo: [], redo: [] }
            }
          : tab
      );
      set({
        tabs,
        activeTab: deriveActiveTab(tabs, activeTab.id),
        lastSavedAt: new Date().toISOString(),
        hasWorkspacePatchUndo: false,
        isBusy: false
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Datei konnte nicht gespeichert werden",
        isBusy: false
      });
    }
  },
  saveActiveFileAs: async () => {
    const activeTab = get().activeTab;
    if (!isFileEditorTab(activeTab)) {
      set({ error: "Keine Datei zum Speichern geoeffnet." });
      return;
    }

    set({ isBusy: true, error: null });
    try {
      const saveAs = window.dbzs.saveFileAsDialog;
      if (!saveAs) {
        throw new Error("Speichern unter ist nicht verfuegbar.");
      }

      const saved = await saveAs({
        defaultPath: activeTab.path,
        content: activeTab.content
      });
      if (!saved) {
        set({ isBusy: false });
        return;
      }

      const workspaceState = await backendClient.getWorkspaceState();
      const source: FileEditorTab["source"] = isPathInsideWorkspace(saved.path, workspaceState.projectPath)
        ? "workspace"
        : "dialog";
      const oldId = activeTab.id;
      const tabs = get().tabs.map((tab) => {
        if (!isFileEditorTab(tab) || tab.id !== oldId) {
          return tab;
        }

        return {
          ...tab,
          ...saved,
          id: saved.path,
          title: saved.name,
          isDirty: false,
          savedContent: saved.content,
          source,
          undoRedo: { undo: [], redo: [] }
        };
      });

      set({
        tabs,
        activeTabId: saved.path,
        activeTab: deriveActiveTab(tabs, saved.path),
        lastActiveFileTabId: saved.path,
        lastSavedAt: new Date().toISOString(),
        hasWorkspacePatchUndo: false,
        isBusy: false
      });

      if (source === "workspace") {
        const workspaceRoot = useWorkspaceStore.getState().state.projectPath;
        if (workspaceRoot) {
          const relativePath = saved.path.replace(/\\/g, "/").replace(`${workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "")}/`, "");
          void ragClient.syncIndex(workspaceRoot, { changedPaths: [relativePath], reason: "file_saved" }).catch((error) => {
            console.warn("RAG file sync failed:", error);
          });
        }
        await useWorkspaceStore.getState().scanFiles();
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Datei konnte nicht gespeichert werden",
        isBusy: false
      });
    }
  },
  queueProposedChanges: async (changes) => {
    if (changes.length === 0) {
      return;
    }
    if (!window.dbzs.createWorkspaceFileSnapshot || !window.dbzs.createWorkspaceDiff) {
      set({ error: "Diff/Patch-Bridge ist nicht verfuegbar." });
      return;
    }

    set({ isBusy: true, error: null });
    try {
      const prepared = [] as Array<{
        proposed: ProposedChange;
        pending: PendingFileChangeState;
        snapshot: FileChangeSnapshotState;
      }>;

      for (const change of changes) {
        const snapshot = await window.dbzs.createWorkspaceFileSnapshot(change.filePath);
        const diffResult = await window.dbzs.createWorkspaceDiff(change.filePath, change.proposedContent);
        prepared.push({
          proposed: {
            ...change,
            originalContent: diffResult.beforeContent,
            status: "pending"
          },
          pending: {
            snapshotId: diffResult.snapshotId,
            filePath: change.filePath,
            label: toFileLabel(change.filePath),
            beforeContent: diffResult.beforeContent,
            afterContent: diffResult.afterContent,
            diff: diffResult.diff,
            createdAt: new Date().toISOString(),
            source: "agent",
            proposedChangeId: change.id,
            agentId: change.agentId,
            reason: change.reason
          },
          snapshot: {
            snapshotId: snapshot.snapshotId,
            filePath: snapshot.filePath,
            createdAt: new Date().toISOString(),
            existed: snapshot.existed
          }
        });
      }

      set((state) => {
        const nextSnapshots = { ...state.snapshots };
        const nextPending = { ...state.pendingChanges };
        const nextProposed = { ...state.proposedChanges };

        for (const entry of prepared) {
          nextSnapshots[entry.snapshot.snapshotId] = entry.snapshot;
          nextPending[entry.pending.filePath] = entry.pending;
          nextProposed[entry.proposed.id] = entry.proposed;
        }

        return {
          snapshots: nextSnapshots,
          pendingChanges: nextPending,
          proposedChanges: nextProposed,
          activePendingChange: deriveActivePendingChange(nextPending, state.activeTabId, state.tabs),
          isBusy: false
        };
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Agent-Vorschlag konnte nicht vorbereitet werden",
        isBusy: false
      });
    }
  },
  applyPendingChange: async (filePath) => {
    const activeTab = get().activeTab;
    const targetPath = filePath ?? (isFileEditorTab(activeTab) ? activeTab.path : null);
    if (!targetPath) {
      return;
    }

    const pending = get().pendingChanges[targetPath];
    if (!pending) {
      return;
    }
    if (!window.dbzs.applyWorkspacePatch) {
      set({ error: "Apply-Patch-Bridge ist nicht verfuegbar." });
      return;
    }

    set({ isBusy: true, error: null });
    try {
      if (pending.proposedChangeId) {
        set((state) => ({
          proposedChanges: {
            ...state.proposedChanges,
            [pending.proposedChangeId as string]: {
              ...state.proposedChanges[pending.proposedChangeId as string],
              status: "approved"
            }
          }
        }));
      }

      const pendingCount = Object.keys(get().pendingChanges).length;
      const restoreReason = pendingCount > 1
        ? "before_bulk_change"
        : pending.source === "agent"
          ? pending.agentId === "debug-agent"
            ? "before_debug_fix"
            : "before_agent_run"
          : "before_patch";
      const restoreLabel = pending.source === "agent"
        ? `Before ${pending.agentId === "debug-agent" ? "debug fix" : "agent patch"}: ${pending.label}`
        : `Before patch apply: ${pending.label}`;

      const result = await window.dbzs.applyWorkspacePatch(
        pending.filePath,
        pending.afterContent,
        pending.snapshotId,
        {
          reason: restoreReason,
          label: restoreLabel,
          relatedRunId: pending.agentId,
          relatedChangeIds: pending.proposedChangeId ? [pending.proposedChangeId] : undefined
        }
      );

      const tabs = get().tabs.map((tab) =>
        isFileEditorTab(tab) && tab.path === pending.filePath
          ? {
              ...tab,
              ...result.file,
              title: result.file.name,
              isDirty: false,
              savedContent: result.file.content,
              undoRedo: { undo: [], redo: [] }
            }
          : tab
      );

      set((state) => {
        const nextPending = { ...state.pendingChanges };
        delete nextPending[pending.filePath];
        const nextProposed = { ...state.proposedChanges };
        if (pending.proposedChangeId && nextProposed[pending.proposedChangeId]) {
          nextProposed[pending.proposedChangeId] = {
            ...nextProposed[pending.proposedChangeId],
            status: "applied"
          };
        }
        return {
          tabs,
          activeTab: deriveActiveTab(tabs, state.activeTabId),
          pendingChanges: nextPending,
          proposedChanges: nextProposed,
          activePendingChange: deriveActivePendingChange(nextPending, state.activeTabId, tabs),
          appliedChanges: [
            ...state.appliedChanges,
            {
              snapshotId: pending.snapshotId,
              filePath: pending.filePath,
              appliedAt: new Date().toISOString(),
              action: "apply"
            }
          ],
          lastSavedAt: new Date().toISOString(),
          hasWorkspacePatchUndo: true,
          isBusy: false
        };
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Patch konnte nicht angewendet werden",
        isBusy: false
      });
    }
  },
  discardPendingChange: (filePath) => {
    const activeTab = get().activeTab;
    const targetPath = filePath ?? (isFileEditorTab(activeTab) ? activeTab.path : null);
    if (!targetPath) {
      return;
    }

    set((state) => {
      const nextPending = { ...state.pendingChanges };
      const pending = nextPending[targetPath];
      delete nextPending[targetPath];
      const nextProposed = { ...state.proposedChanges };
      if (pending?.proposedChangeId && nextProposed[pending.proposedChangeId]) {
        nextProposed[pending.proposedChangeId] = {
          ...nextProposed[pending.proposedChangeId],
          status: "rejected"
        };
      }
      return {
        pendingChanges: nextPending,
        proposedChanges: nextProposed,
        activePendingChange: deriveActivePendingChange(nextPending, state.activeTabId, state.tabs)
      };
    });
  },
  rejectProposedChange: (proposedChangeId) => {
    const proposed = get().proposedChanges[proposedChangeId];
    if (!proposed) {
      return;
    }

    get().discardPendingChange(proposed.filePath);
  },
  restoreSnapshot: async (snapshotId) => {
    if (!window.dbzs.restoreWorkspaceSnapshot) {
      set({ error: "Restore-Snapshot-Bridge ist nicht verfuegbar." });
      return;
    }

    const snapshot = get().snapshots[snapshotId];
    if (!snapshot) {
      set({ error: "Snapshot ist nicht vorhanden." });
      return;
    }

    set({ isBusy: true, error: null });
    try {
      const restored = await window.dbzs.restoreWorkspaceSnapshot(snapshotId);
      const tabs = restored.file
        ? get().tabs.map((tab) =>
            isFileEditorTab(tab) && tab.path === restored.file?.path
              ? {
                  ...tab,
                  ...restored.file,
                  title: restored.file.name,
                  isDirty: false,
                  savedContent: restored.file.content,
                  undoRedo: { undo: [], redo: [] }
                }
              : tab
          )
        : get().tabs;

      set((state) => {
        const nextPending = { ...state.pendingChanges };
        delete nextPending[snapshot.filePath];
        return {
          tabs,
          activeTab: deriveActiveTab(tabs, state.activeTabId),
          pendingChanges: nextPending,
          activePendingChange: deriveActivePendingChange(nextPending, state.activeTabId, tabs),
          appliedChanges: [
            ...state.appliedChanges,
            {
              snapshotId,
              filePath: snapshot.filePath,
              appliedAt: new Date().toISOString(),
              action: "restore"
            }
          ],
          isBusy: false,
          hasWorkspacePatchUndo: false
        };
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Snapshot konnte nicht wiederhergestellt werden",
        isBusy: false
      });
    }
  },
  closeTab: (tabId) => {
    const tabs = get().tabs.filter((tab) => tab.id !== tabId);
    const activeTabId = get().activeTabId === tabId ? (tabs.at(-1)?.id ?? null) : get().activeTabId;
    set({
      tabs,
      activeTabId,
      activeTab: deriveActiveTab(tabs, activeTabId),
      lastActiveFileTabId: deriveLastActiveFileTabId(tabs, activeTabId),
      activePendingChange: deriveActivePendingChange(get().pendingChanges, activeTabId, tabs)
    });
  }
}));

function deriveActivePendingChange(
  pendingChanges: Record<string, PendingFileChangeState>,
  activeTabId: string | null,
  tabs: EditorTab[]
): PendingFileChangeState | null {
  if (!activeTabId) {
    return null;
  }

  const activeTab = deriveActiveTab(tabs, activeTabId);
  if (!isFileEditorTab(activeTab)) {
    return null;
  }

  return pendingChanges[activeTab.path] ?? null;
}
