import { create } from "zustand";
import type { ProjectMemoryEntry } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

interface ProjectMemoryState {
  workspace: string;
  entries: ProjectMemoryEntry[];
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  setWorkspace: (workspace: string) => void;
  loadEntries: () => Promise<void>;
  upsertEntry: (memoryKey: string, content: string, tags: string[]) => Promise<void>;
  deleteEntry: (entryId: number) => Promise<void>;
}

export const useProjectMemoryStore = create<ProjectMemoryState>((set, get) => ({
  workspace: "default",
  entries: [],
  isLoading: false,
  isMutating: false,
  error: null,
  setWorkspace: (workspace) => set({ workspace }),
  loadEntries: async () => {
    set({ isLoading: true, error: null });
    try {
      const entries = await backendClient.listProjectMemory(get().workspace);
      set({ entries, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Project Memory konnte nicht geladen werden",
        isLoading: false
      });
    }
  },
  upsertEntry: async (memoryKey, content, tags) => {
    set({ isMutating: true, error: null });
    try {
      await backendClient.upsertProjectMemory({
        workspace: get().workspace,
        memory_key: memoryKey,
        content,
        tags
      });
      await get().loadEntries();
      set({ isMutating: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Project Memory konnte nicht gespeichert werden",
        isMutating: false
      });
    }
  },
  deleteEntry: async (entryId) => {
    set({ isMutating: true, error: null });
    try {
      await backendClient.deleteProjectMemory(entryId);
      set({ entries: get().entries.filter((entry) => entry.id !== entryId), isMutating: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Project Memory konnte nicht geloescht werden",
        isMutating: false
      });
    }
  }
}));
