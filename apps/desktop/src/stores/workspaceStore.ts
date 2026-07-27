import { create } from "zustand";
import type { WorkspaceProjectFile, WorkspaceState } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { notifyWorkspaceSynced } from "@/services/workspaceSync";
import { promptText } from "@/services/promptText";
import { ragClient } from "@/services/ragClient";
import { useEditorStore } from "@/stores/editorStore";
import { toAbsPath, validateRelativePath } from "@/utils/workspacePathUtils";

const defaultState: WorkspaceState = {
  projectPath: null,
  projectName: null,
  lastOpenedAt: null,
  maxFileScanCount: 2500
};

interface WorkspaceStoreState {
  state: WorkspaceState;
  files: WorkspaceProjectFile[];
  isLoading: boolean;
  hasLoadedState: boolean;
  status: "idle" | "loading" | "ready" | "empty" | "error";
  error: string | null;
  loadWorkspaceState: () => Promise<void>;
  openWorkspace: () => Promise<void>;
  createProject: () => Promise<void>;
  openProjectDirectory: () => Promise<void>;
  createNewFile: (defaultRelativePath?: string) => Promise<void>;
  createNewFolder: (defaultRelativePath?: string) => Promise<void>;
  saveWorkspace: () => Promise<void>;
  scanFiles: () => Promise<void>;
  updateWorkspaceState: (next: Partial<WorkspaceState>) => Promise<void>;
  resetWorkspace: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  state: defaultState,
  files: [],
  isLoading: false,
  hasLoadedState: false,
  status: "idle",
  error: null,
  loadWorkspaceState: async () => {
    set({ isLoading: true, error: null, status: "loading" });
    try {
      const state = await backendClient.getWorkspaceState();
      set({ state, isLoading: false, hasLoadedState: true, status: state.projectPath ? "ready" : "idle" });
      if (state.projectPath) {
        await get().scanFiles();
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Workspace state konnte nicht geladen werden.",
        isLoading: false,
        hasLoadedState: true,
        status: "error"
      });
    }
  },
  openWorkspace: async () => {
    await get().openProjectDirectory();
  },
  createProject: async () => {
    set({ isLoading: true, error: null, status: "loading" });
    try {
      const selected = await backendClient.createNewProject();
      if (!selected) {
        set({ isLoading: false, status: get().state.projectPath ? "ready" : "idle" });
        return;
      }

      const nextState: WorkspaceState = {
        ...get().state,
        projectPath: selected.projectPath,
        projectName: selected.projectName,
        lastOpenedAt: new Date().toISOString()
      };
      const persisted = await backendClient.setWorkspaceState(nextState);
      set({ state: persisted, isLoading: false, status: "ready" });
      await get().scanFiles();
      if (selected.createdFiles.includes("README.md")) {
        await useEditorStore.getState().openWorkspaceFile(toAbsPath(selected.projectPath, "README.md"));
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Neues Projekt konnte nicht erstellt werden.",
        isLoading: false,
        status: "error"
      });
    }
  },
  openProjectDirectory: async () => {
    set({ isLoading: true, error: null, status: "loading" });
    try {
      const selected = await backendClient.selectProjectDirectory();
      if (!selected) {
        set({ isLoading: false, status: get().state.projectPath ? "ready" : "idle" });
        return;
      }

      const nextState: WorkspaceState = {
        ...get().state,
        projectPath: selected.projectPath,
        projectName: selected.projectName,
        lastOpenedAt: new Date().toISOString()
      };
      const persisted = await backendClient.setWorkspaceState(nextState);
      set({ state: persisted, isLoading: false, status: "ready" });
      await get().scanFiles();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Projektordner konnte nicht geladen werden.",
        isLoading: false,
        status: "error"
      });
    }
  },
  createNewFile: async (defaultRelativePath = "neu.txt") => {
    const projectPath = get().state.projectPath;
    if (!projectPath) {
      set({ error: "Kein aktiver Workspace. Bitte zuerst ein Projekt oeffnen oder erstellen." });
      return;
    }

    const relativePath = (await promptText({
      title: "Neue Datei",
      label: "Relativer Pfad",
      value: defaultRelativePath,
      confirmText: "Erstellen"
    }))?.trim();

    if (!relativePath) {
      return;
    }

    if (!validateRelativePath(relativePath)) {
      set({ error: "Ungueltiger Pfad." });
      return;
    }

    set({ isLoading: true, error: null, status: "loading" });
    try {
      const absolutePath = toAbsPath(projectPath, relativePath);
      await backendClient.writeProjectFile(absolutePath, "");
      await get().scanFiles();
      await useEditorStore.getState().openWorkspaceFile(absolutePath);
      set({ isLoading: false, status: "ready" });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Neue Datei konnte nicht erstellt werden.",
        isLoading: false,
        status: "error"
      });
    }
  },
  createNewFolder: async (defaultRelativePath = "neuer-ordner") => {
    const projectPath = get().state.projectPath;
    if (!projectPath) {
      set({ error: "Kein aktiver Workspace. Bitte zuerst ein Projekt oeffnen oder erstellen." });
      return;
    }

    const relativePath = (await promptText({
      title: "Neuer Ordner",
      label: "Relativer Pfad",
      value: defaultRelativePath,
      confirmText: "Erstellen"
    }))?.trim();

    if (!relativePath) {
      return;
    }

    if (!validateRelativePath(relativePath)) {
      set({ error: "Ungueltiger Pfad." });
      return;
    }

    set({ isLoading: true, error: null, status: "loading" });
    try {
      const absolutePath = toAbsPath(projectPath, relativePath);
      await backendClient.createWorkspaceFolder(absolutePath);
      await get().scanFiles();
      set({ isLoading: false, status: "ready" });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Neuer Ordner konnte nicht erstellt werden.",
        isLoading: false,
        status: "error"
      });
    }
  },
  saveWorkspace: async () => {
    const projectPath = get().state.projectPath;
    if (!projectPath) {
      set({ error: "Kein Workspace zum Speichern." });
      return;
    }

    set({ isLoading: true, error: null, status: "loading" });
    try {
      const persisted = await backendClient.setWorkspaceState({
        ...get().state,
        lastOpenedAt: new Date().toISOString()
      });
      set({ state: persisted, isLoading: false, status: get().files.length > 0 ? "ready" : "idle" });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Workspace konnte nicht gespeichert werden.",
        isLoading: false,
        status: "error"
      });
    }
  },
  scanFiles: async () => {
    const projectPath = get().state.projectPath;
    if (!projectPath) {
      set({ files: [], status: "idle" });
      return;
    }

    set({ isLoading: true, error: null, status: "loading" });
    try {
      const files = await backendClient.scanProjectFiles(projectPath);
      set({ files, isLoading: false, status: files.length > 0 ? "ready" : "empty" });
      notifyWorkspaceSynced(get().state, files.length);
      void ragClient.syncIndex(projectPath, { reason: "workspace_scan" }).catch((error) => {
        console.warn("RAG index sync failed:", error);
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Projektdateien konnten nicht gescannt werden.",
        isLoading: false,
        status: "error"
      });
    }
  },
  updateWorkspaceState: async (next) => {
    set({ isLoading: true, error: null, status: "loading" });
    try {
      const persisted = await backendClient.setWorkspaceState({ ...get().state, ...next });
      set({ state: persisted, isLoading: false, status: get().files.length > 0 ? "ready" : "idle" });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Workspace state konnte nicht gespeichert werden.",
        isLoading: false,
        status: "error"
      });
    }
  },
  resetWorkspace: async () => {
    set({ isLoading: true, error: null, status: "loading" });
    try {
      const persisted = await backendClient.setWorkspaceState({
        ...get().state,
        projectPath: null,
        projectName: null,
        lastOpenedAt: null
      });
      set({ state: persisted, files: [], isLoading: false, status: "idle" });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Workspace konnte nicht zurueckgesetzt werden.",
        isLoading: false,
        status: "error"
      });
    }
  }
}));
