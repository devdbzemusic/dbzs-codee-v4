/*
 * DBZS – Division By Zeros
 * Datei: useAppShellLifecycle.ts
 * Bereich: Desktop / App Shell
 *
 * Zweck:
 *   Kapselt die Lifecycle-, Sync- und Shell-Effekte der Haupt-App.
 *
 * Warum:
 *   App.tsx soll Layout und Composition bleiben, nicht Sammelstelle fuer
 *   Boot-, Window-, Sync- und Keyboard-Logik.
 *
 * Wozu:
 *   Reduziert die Groesse von App.tsx und macht App-Shell-Verhalten separat
 *   test- und wartbarer.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { BackendStartupStatus, BootState, RuntimeStatus, WorkspaceProjectFile } from "@dbzs/shared";
import { useAgentRegistryStore } from "@/stores/agentRegistryStore";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTaskBoardStore } from "@/stores/taskBoardStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useNotebookStore } from "@/stores/notebookStore";
import { codeIndexService } from "@/services/codeIndexService";
import { initRuntimeChatSync } from "@/services/runtimeChatSync";
import { readStandaloneView, type StandaloneView } from "@/utils/standaloneView";
import { toRuntimeChatContextFile } from "@/utils/runtimeChatWindow";
import { shouldSyncWorkspaceSettings } from "@/utils/workspaceState";
import type { RuntimeChatContextSnapshot } from "@/types/runtimeChatWindow";
import type { FileEditorTab } from "@/stores/editorStore";

type LoadRuntimeStatus = () => Promise<void>;

interface TrackedFrontendPhase {
  id: string;
  state: string;
  retryCount: number;
  startedAt?: string | number | null;
}

interface RuntimeChatWindowSyncOptions {
  activeTab: FileEditorTab | null;
  platformDiagnosticsOnlyMode: boolean;
  runtimeChatOnlyMode: boolean;
  settingsOnlyMode: boolean;
  runtimeContextHint: string | null;
  setBootState: Dispatch<SetStateAction<BootState | null>>;
  setRuntimeChatWindowOpen: Dispatch<SetStateAction<boolean>>;
  setSharedChatContext: Dispatch<SetStateAction<RuntimeChatContextSnapshot | null>>;
  workspaceFiles: WorkspaceProjectFile[];
  workspaceProjectName: string | null;
  workspaceProjectPath: string | null;
}

export function useRuntimeChatWindowSync(options: RuntimeChatWindowSyncOptions): void {
  const {
    activeTab,
    platformDiagnosticsOnlyMode,
    runtimeChatOnlyMode,
    settingsOnlyMode,
    runtimeContextHint,
    setBootState,
    setRuntimeChatWindowOpen,
    setSharedChatContext,
    workspaceFiles,
    workspaceProjectName,
    workspaceProjectPath
  } = options;

  useEffect(() => initRuntimeChatSync(), []);

  useEffect(() => {
    const onWindowState = window.dbzs.onRuntimeChatWindowState;
    if (!onWindowState) {
      return;
    }

    return onWindowState(({ open }) => {
      setRuntimeChatWindowOpen(open);
    });
  }, [setRuntimeChatWindowOpen]);

  useEffect(() => {
    const getContext = window.dbzs.getRuntimeChatContext;
    const onContext = window.dbzs.onRuntimeChatContext;
    if (getContext) {
      void getContext().then((context) => {
        setSharedChatContext(context);
      });
    }

    if (!onContext) {
      return;
    }

    return onContext((context) => {
      setSharedChatContext(context);
    });
  }, [setSharedChatContext]);

  useEffect(() => {
    let cancelled = false;
    window.dbzs.getBootState?.().then((initial) => {
      if (!cancelled) {
        setBootState(initial);
      }
    });
    const unsubscribe = window.dbzs.onBootState?.((next) => setBootState(next));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [setBootState]);

  useEffect(() => {
    if (runtimeChatOnlyMode || platformDiagnosticsOnlyMode || settingsOnlyMode) {
      return;
    }

    const publish = window.dbzs.publishRuntimeChatContext;
    if (!publish) {
      return;
    }

    void publish({
      activeFile: activeTab ? toRuntimeChatContextFile(activeTab) : null,
      contextHint: runtimeContextHint,
      workspaceRoot: workspaceProjectPath,
      workspaceName: workspaceProjectName,
      workspaceFiles
    }).catch(() => undefined);
  }, [
    activeTab,
    platformDiagnosticsOnlyMode,
    runtimeChatOnlyMode,
    settingsOnlyMode,
    runtimeContextHint,
    workspaceFiles,
    workspaceProjectName,
    workspaceProjectPath
  ]);
}

interface TrackedFrontendBootOptions {
  activeTrackedFrontendPhase: TrackedFrontendPhase | null;
  trackedFrontendPhaseKey: string | null;
  trackedFrontendBootRunRef: { current: string | null };
  loadAgents: () => Promise<unknown>;
  loadAllowedCommands: () => Promise<unknown>;
  loadInitialState: () => Promise<unknown>;
  loadJobs: () => Promise<unknown>;
  loadModelIndex: () => Promise<unknown>;
  loadRuntimeStatus: LoadRuntimeStatus;
  loadTasks: () => Promise<unknown>;
  loadWorkspaceState: () => Promise<unknown>;
}

export function useTrackedFrontendBoot(options: TrackedFrontendBootOptions): void {
  const {
    activeTrackedFrontendPhase,
    trackedFrontendPhaseKey,
    trackedFrontendBootRunRef,
    loadAgents,
    loadAllowedCommands,
    loadInitialState,
    loadJobs,
    loadModelIndex,
    loadRuntimeStatus,
    loadTasks,
    loadWorkspaceState
  } = options;

  useEffect(() => {
    const report = window.dbzs.reportBootPhaseState;
    const activePhaseId = activeTrackedFrontendPhase?.id ?? null;
    if (!activePhaseId || !trackedFrontendPhaseKey) {
      return;
    }
    if (trackedFrontendBootRunRef.current === trackedFrontendPhaseKey) {
      return;
    }
    trackedFrontendBootRunRef.current = trackedFrontendPhaseKey;

    let cancelled = false;

    function errorMessage(err: unknown): string {
      return err instanceof Error ? err.message : String(err);
    }

    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitForBackendBridge(): Promise<void> {
      const maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (cancelled) return;
        try {
          await window.dbzs.getBackendHealth();
          return;
        } catch (err) {
          if (attempt === maxAttempts - 1) throw err;
          await sleep(500);
        }
      }
    }

    async function runTrackedBootFrom(startPhaseId: string): Promise<void> {
      if (startPhaseId === "frontend-bridge") {
        try {
          await waitForBackendBridge();
          if (cancelled) return;
          await report?.("frontend-bridge", "success", "IPC-Bridge verbunden.");
        } catch (err) {
          await report?.("frontend-bridge", "failed", errorMessage(err));
          return;
        }
      }

      if (startPhaseId === "frontend-bridge" || startPhaseId === "frontend-config-sync") {
        await loadInitialState();
        if (cancelled) return;
        const settingsError = useSettingsStore.getState().error;
        if (settingsError) {
          await report?.("frontend-config-sync", "failed", settingsError);
          return;
        }
        await report?.("frontend-config-sync", "success", "Einstellungen synchronisiert.");
      }

      const safeMode = (await window.dbzs.isBootSafeMode?.()) ?? false;

      if (startPhaseId === "frontend-bridge" || startPhaseId === "frontend-config-sync" || startPhaseId === "workspace-restore") {
        if (safeMode) {
          await report?.("workspace-restore", "success", "Sicherer Modus: Workspace-Wiederherstellung übersprungen.");
        } else {
          await Promise.all([loadWorkspaceState(), loadAllowedCommands()]);
          if (cancelled) return;
          const workspaceStateError = useWorkspaceStore.getState().error;
          if (workspaceStateError) {
            await report?.("workspace-restore", "failed", workspaceStateError);
            return;
          }
          await report?.("workspace-restore", "success", "Workspace wiederhergestellt.");
        }
      }

      if (safeMode) {
        if (
          startPhaseId === "frontend-bridge" ||
          startPhaseId === "frontend-config-sync" ||
          startPhaseId === "workspace-restore" ||
          startPhaseId === "agents-roles-models"
        ) {
          await report?.("agents-roles-models", "success", "Sicherer Modus: Agenten-Autostarts übersprungen.");
        }
        return;
      }

      if (
        startPhaseId === "frontend-bridge" ||
        startPhaseId === "frontend-config-sync" ||
        startPhaseId === "workspace-restore" ||
        startPhaseId === "agents-roles-models"
      ) {
        await Promise.all([loadModelIndex(), loadRuntimeStatus(), loadAgents(), loadTasks(), loadJobs()]);
        if (cancelled) return;
        const groupError =
          useModelIndexStore.getState().error ||
          useRuntimeStore.getState().error ||
          useAgentRegistryStore.getState().error ||
          useTaskBoardStore.getState().error;
        if (groupError) {
          await report?.("agents-roles-models", "failed", groupError);
          return;
        }
        await report?.("agents-roles-models", "success", "Agenten und Modelle geladen.");
      }
    }

    void runTrackedBootFrom(activePhaseId);
    return () => {
      cancelled = true;
    };
  }, [
    activeTrackedFrontendPhase?.id,
    trackedFrontendPhaseKey,
    trackedFrontendBootRunRef,
    loadAgents,
    loadAllowedCommands,
    loadInitialState,
    loadJobs,
    loadModelIndex,
    loadRuntimeStatus,
    loadTasks,
    loadWorkspaceState
  ]);
}

interface BackendLifecycleOptions {
  backendHealthStatus: string | undefined;
  loadAgents: () => Promise<unknown>;
  loadInitialState: () => Promise<unknown>;
  loadJobs: () => Promise<unknown>;
  loadModelIndex: () => Promise<unknown>;
  loadProjectMemory: (workspaceRoot: string | null) => Promise<unknown>;
  loadRuntimeStatus: LoadRuntimeStatus;
  loadTasks: () => Promise<unknown>;
  refreshGitStatus: () => Promise<unknown>;
  setBackendStartupStatus: (status: BackendStartupStatus) => void;
}

export function useBackendLifecycleSync(options: BackendLifecycleOptions): void {
  const {
    backendHealthStatus,
    loadAgents,
    loadInitialState,
    loadJobs,
    loadModelIndex,
    loadProjectMemory,
    loadRuntimeStatus,
    loadTasks,
    refreshGitStatus,
    setBackendStartupStatus
  } = options;

  useEffect(() => {
    const getStatus = window.dbzs.getBackendStartupStatus;
    const onStatus = window.dbzs.onBackendStartupStatus;
    if (!getStatus || !onStatus) {
      return;
    }

    let hasSeenInitialStatus = false;

    const reloadBackendStores = () => {
      void loadInitialState();
      void loadModelIndex();
      void loadRuntimeStatus();
      void loadAgents();
      void loadTasks();
      void loadJobs();
      const workspace = useWorkspaceStore.getState();
      if (workspace.state.projectPath) {
        void workspace.scanFiles();
        void loadProjectMemory(workspace.state.projectPath);
        void refreshGitStatus();
      }
    };

    void getStatus().then((status) => {
      setBackendStartupStatus(status);
      hasSeenInitialStatus = true;
    });

    const unsubscribe = onStatus((status) => {
      setBackendStartupStatus(status);
      if (status.state === "ready") {
        if (hasSeenInitialStatus) {
          reloadBackendStores();
        }
        hasSeenInitialStatus = true;
      }
    });

    return unsubscribe;
  }, [
    loadAgents,
    loadInitialState,
    loadJobs,
    loadModelIndex,
    loadProjectMemory,
    loadRuntimeStatus,
    loadTasks,
    refreshGitStatus,
    setBackendStartupStatus
  ]);

  useEffect(() => {
    if (backendHealthStatus !== "ok") {
      return;
    }

    void loadRuntimeStatus();
    void loadTasks();
    void loadJobs();
    const projectPath = useWorkspaceStore.getState().state.projectPath;
    if (projectPath) {
      void loadProjectMemory(projectPath);
      void refreshGitStatus();
    }

    const interval = window.setInterval(() => {
      void loadRuntimeStatus();
    }, 15_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [backendHealthStatus, loadJobs, loadProjectMemory, loadRuntimeStatus, loadTasks, refreshGitStatus]);
}

interface WorkspaceProjectSyncOptions {
  activeTab: { path: string } | null;
  loadProjectMemory: (workspaceRoot: string | null) => Promise<unknown>;
  refreshGitStatus: () => Promise<unknown>;
  setDetectedWorkspaceData: (files: WorkspaceProjectFile[]) => Promise<unknown> | void;
  setDocsWorkspaceRoot: (workspaceRoot: string) => void;
  setIndexBuildBusy: Dispatch<SetStateAction<boolean>>;
  setIndexError: Dispatch<SetStateAction<string | null>>;
  settingsMaxFileScanCount: number;
  setStandaloneView: Dispatch<SetStateAction<StandaloneView>>;
  updateWorkspaceState: (patch: { maxFileScanCount: number }) => Promise<unknown>;
  workspaceFiles: WorkspaceProjectFile[];
  workspaceStateLoaded: boolean;
  workspaceProjectPath: string | null;
}

export function useWorkspaceProjectSync(options: WorkspaceProjectSyncOptions): void {
  const {
    activeTab,
    loadProjectMemory,
    refreshGitStatus,
    setDetectedWorkspaceData,
    setDocsWorkspaceRoot,
    setIndexBuildBusy,
    setIndexError,
    settingsMaxFileScanCount,
    setStandaloneView,
    updateWorkspaceState,
    workspaceFiles,
    workspaceStateLoaded,
    workspaceProjectPath
  } = options;

  useEffect(() => {
    const syncStandaloneView = () => {
      setStandaloneView(readStandaloneView());
    };
    window.addEventListener("hashchange", syncStandaloneView);
    window.addEventListener("popstate", syncStandaloneView);
    return () => {
      window.removeEventListener("hashchange", syncStandaloneView);
      window.removeEventListener("popstate", syncStandaloneView);
    };
  }, [setStandaloneView]);

  useEffect(() => {
    if (!shouldSyncWorkspaceSettings(workspaceStateLoaded)) {
      return;
    }

    void updateWorkspaceState({ maxFileScanCount: settingsMaxFileScanCount });
  }, [settingsMaxFileScanCount, updateWorkspaceState, workspaceStateLoaded]);

  useEffect(() => {
    if (workspaceProjectPath) {
      setDocsWorkspaceRoot(workspaceProjectPath);
    }
  }, [workspaceProjectPath, setDocsWorkspaceRoot]);

  useEffect(() => {
    if (workspaceProjectPath || !activeTab) {
      return;
    }

    const workspace = activeTab.path.includes("/")
      ? activeTab.path.split("/").slice(0, -1).join("/")
      : activeTab.path.includes("\\")
        ? activeTab.path.split("\\").slice(0, -1).join("\\")
        : "";

    if (workspace) {
      setDocsWorkspaceRoot(workspace);
    }
  }, [activeTab, setDocsWorkspaceRoot, workspaceProjectPath]);

  useEffect(() => {
    void loadProjectMemory(workspaceProjectPath);
  }, [loadProjectMemory, workspaceProjectPath]);

  useEffect(() => {
    if (!workspaceProjectPath) return;
    void useRuntimeChatStore.getState().checkForPendingQuestion(workspaceProjectPath);
  }, [workspaceProjectPath]);

  useEffect(() => {
    if (workspaceFiles.length === 0) {
      return;
    }

    void setDetectedWorkspaceData(workspaceFiles);
  }, [setDetectedWorkspaceData, workspaceFiles]);

  useEffect(() => {
    if (!workspaceProjectPath) {
      return;
    }

    setIndexBuildBusy(true);
    setIndexError(null);
    void codeIndexService
      .buildWorkspaceIndex(workspaceProjectPath)
      .then(() => {
        setIndexBuildBusy(false);
      })
      .catch((error) => {
        setIndexError(error instanceof Error ? error.message : "Code-Index konnte nicht erstellt werden.");
        setIndexBuildBusy(false);
      });
  }, [setIndexBuildBusy, setIndexError, workspaceProjectPath, workspaceFiles]);

  useEffect(() => {
    if (!workspaceProjectPath) {
      return;
    }

    void refreshGitStatus();
  }, [refreshGitStatus, workspaceProjectPath]);
}

interface AppKeyboardShortcutsOptions {
  handleOpenRuntimeChatWindow: () => Promise<void>;
  cycleWorkbenchPreset: () => void;
  openCommandPalette: () => void;
  openFile: () => Promise<unknown>;
  saveActiveFile: () => Promise<unknown>;
  saveActiveFileAs: () => Promise<unknown>;
}

export function useAppKeyboardShortcuts(options: AppKeyboardShortcutsOptions): void {
  const { cycleWorkbenchPreset, handleOpenRuntimeChatWindow, openCommandPalette, openFile, saveActiveFile, saveActiveFileAs } = options;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        cycleWorkbenchPreset();
        return;
      }

      if (!event.ctrlKey) return;
      if (isEditableTarget) return;

      if (event.key >= "1" && event.key <= "5") {
        event.preventDefault();
        const tabs = ["mission-control", "cdee", "runtime", "jobs", "editor"] as const;
        useNotebookStore.getState().setActiveTab(tabs[Number(event.key) - 1]);
        return;
      }

      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openFile();
      }

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (event.shiftKey) {
          void saveActiveFileAs();
        } else {
          void saveActiveFile();
        }
        return;
      }

      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (event.shiftKey && event.altKey) {
          void useWorkspaceStore.getState().createNewFolder();
        } else if (event.shiftKey) {
          void useWorkspaceStore.getState().createProject();
        } else {
          void useWorkspaceStore.getState().createNewFile();
        }
        return;
      }

      if (event.key === ",") {
        event.preventDefault();
        void window.dbzs.openSettingsWindow?.();
      }

      if (event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void handleOpenRuntimeChatWindow();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [cycleWorkbenchPreset, handleOpenRuntimeChatWindow, openCommandPalette, openFile, saveActiveFile, saveActiveFileAs]);
}

export function useAppGridLayoutVars(
  visibleLeftWidth: number,
  visibleRightWidth: number,
  visibleTerminalHeight: number
): void {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--dbzs-grid-rows", `64px minmax(0, 1fr) ${visibleTerminalHeight}px`);
    root.style.setProperty("--dbzs-grid-columns", `${visibleLeftWidth}px minmax(0, 1fr) ${visibleRightWidth}px`);
    root.style.setProperty("--dbzs-footer-columns", `minmax(0, 1fr) ${visibleRightWidth}px`);
  }, [visibleLeftWidth, visibleRightWidth, visibleTerminalHeight]);
}
