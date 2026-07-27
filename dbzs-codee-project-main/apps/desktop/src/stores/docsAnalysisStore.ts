import { create } from "zustand";
import type { DocsAnalysisSummary } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

interface DocsAnalysisState {
  workspaceRoot: string;
  summary: DocsAnalysisSummary | null;
  markdown: string;
  isLoading: boolean;
  error: string | null;
  setWorkspaceRoot: (workspaceRoot: string) => void;
  analyze: () => Promise<void>;
  generate: () => Promise<void>;
}

export const useDocsAnalysisStore = create<DocsAnalysisState>((set, get) => ({
  workspaceRoot: "",
  summary: null,
  markdown: "",
  isLoading: false,
  error: null,
  setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),
  analyze: async () => {
    const workspaceRoot = get().workspaceRoot.trim();
    if (!workspaceRoot) {
      set({ error: "Workspace Root fehlt." });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const summary = await backendClient.analyzeDocs(workspaceRoot, 6);
      set({ summary, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Analyse konnte nicht ausgefuehrt werden",
        isLoading: false
      });
    }
  },
  generate: async () => {
    const workspaceRoot = get().workspaceRoot.trim();
    if (!workspaceRoot) {
      set({ error: "Workspace Root fehlt." });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const response = await backendClient.generateDocs({ workspace_root: workspaceRoot, max_files: 6 });
      set({ summary: response.summary, markdown: response.content, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Dokumentation konnte nicht generiert werden",
        isLoading: false
      });
    }
  }
}));
