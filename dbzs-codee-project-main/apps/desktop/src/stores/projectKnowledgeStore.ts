import { create } from "zustand";
import type { KnownIssue, MemoryTask, ProjectMemory, WorkspaceProjectFile } from "@dbzs/shared";
import { projectMemoryService } from "@/services/projectMemoryService";

interface ProjectKnowledgeState {
  memory: ProjectMemory | null;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  loadMemory: (workspaceRoot: string | null) => Promise<void>;
  refreshMemory: () => Promise<void>;
  addRecentTask: (task: MemoryTask) => Promise<void>;
  addKnownIssue: (issue: KnownIssue) => Promise<void>;
  markImportantFile: (path: string, reason: string) => Promise<void>;
  setDetectedWorkspaceData: (workspaceFiles: WorkspaceProjectFile[]) => Promise<void>;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function detectFrameworks(files: WorkspaceProjectFile[]): string[] {
  const paths = files.map((file) => file.relativePath.toLowerCase());
  const frameworks: string[] = [];

  const has = (pattern: RegExp): boolean => paths.some((entry) => pattern.test(entry));

  if (has(/package\.json$/)) frameworks.push("node");
  if (has(/tsconfig(\..+)?\.json$/)) frameworks.push("typescript");
  if (has(/\.(ts|tsx|mts|cts)$/)) frameworks.push("typescript");
  if (has(/vite\.config\.(ts|js|mjs|mts)$/)) frameworks.push("vite");
  if (has(/electron\.vite\.config\.ts$/) || has(/(^|\/)electron\//)) frameworks.push("electron");
  if (has(/src\/App\.tsx$/) || has(/\.tsx$/)) frameworks.push("react");
  if (has(/pyproject\.toml$/) || has(/\.py$/)) frameworks.push("python");
  if (has(/pytest\.ini$/) || has(/(^|\/)tests?\//)) frameworks.push("pytest");
  if (has(/tailwind\.config\.(ts|js|mjs|cjs)$/)) frameworks.push("tailwind");

  return unique(frameworks);
}

function detectLanguages(files: WorkspaceProjectFile[]): string[] {
  const langs = files.map((file) => file.language.toLowerCase());
  if (files.some((file) => /\.tsx?$/.test(file.relativePath))) {
    langs.push("typescript");
  }
  if (files.some((file) => /\.py$/.test(file.relativePath))) {
    langs.push("python");
  }

  return unique(langs);
}

export const useProjectKnowledgeStore = create<ProjectKnowledgeState>((set, get) => ({
  memory: null,
  isLoading: false,
  isMutating: false,
  error: null,
  loadMemory: async (workspaceRoot) => {
    if (!workspaceRoot) {
      set({ memory: null, isLoading: false, error: null });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const memory = await projectMemoryService.loadProjectMemory(workspaceRoot);
      set({ memory, isLoading: false, error: null });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Project Memory konnte nicht geladen werden"
      });
    }
  },
  refreshMemory: async () => {
    const memory = get().memory;
    if (!memory) {
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const next = await projectMemoryService.loadProjectMemory(memory.workspaceRoot);
      set({ memory: next, isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Project Memory konnte nicht aktualisiert werden"
      });
    }
  },
  addRecentTask: async (task) => {
    set({ isMutating: true, error: null });
    try {
      const memory = await projectMemoryService.addRecentTask(task);
      set({ memory, isMutating: false });
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Recent Task konnte nicht gespeichert werden"
      });
    }
  },
  addKnownIssue: async (issue) => {
    set({ isMutating: true, error: null });
    try {
      const memory = await projectMemoryService.addKnownIssue(issue);
      set({ memory, isMutating: false });
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Known Issue konnte nicht gespeichert werden"
      });
    }
  },
  markImportantFile: async (path, reason) => {
    set({ isMutating: true, error: null });
    try {
      const memory = await projectMemoryService.markImportantFile(path, reason);
      set({ memory, isMutating: false });
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Wichtige Datei konnte nicht markiert werden"
      });
    }
  },
  setDetectedWorkspaceData: async (workspaceFiles) => {
    const memory = get().memory;
    if (!memory) {
      return;
    }

    const next: ProjectMemory = {
      ...memory,
      frameworks: unique([...memory.frameworks, ...detectFrameworks(workspaceFiles)]),
      languages: unique([...memory.languages, ...detectLanguages(workspaceFiles)])
    };

    set({ isMutating: true, error: null });
    try {
      const saved = await projectMemoryService.updateProjectMemory(next);
      set({ memory: saved, isMutating: false });
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Workspace-Metadaten konnten nicht gespeichert werden"
      });
    }
  }
}));
