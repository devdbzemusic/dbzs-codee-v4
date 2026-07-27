import type {
  ImportantFile,
  KnownIssue,
  MemoryTask,
  ProjectMemory,
  WorkspaceProjectFile
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

const MEMORY_DIR_NAME = ".codee";
const MEMORY_FILE_NAME = "project-memory.json";

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function joinPath(base: string, segment: string): string {
  const normalizedBase = base.replace(/[\\/]+$/, "");
  return `${normalizedBase}/${segment}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function detectFrameworks(files: WorkspaceProjectFile[]): string[] {
  const normalized = files.map((file) => normalizePath(file.relativePath).toLowerCase());

  const frameworks: string[] = [];
  const has = (pattern: RegExp): boolean => normalized.some((entry) => pattern.test(entry));

  if (has(/(^|\/)package\.json$/)) {
    frameworks.push("node");
  }
  if (has(/(^|\/)tsconfig(\..+)?\.json$/)) {
    frameworks.push("typescript");
  }
  if (has(/\.(ts|tsx|mts|cts)$/)) {
    frameworks.push("typescript");
  }
  if (has(/(^|\/)vite\.config\.(ts|js|mts|mjs)$/)) {
    frameworks.push("vite");
  }
  if (has(/electron\.vite\.config\.ts$/) || has(/(^|\/)electron\//)) {
    frameworks.push("electron");
  }
  if (has(/(^|\/)src\/App\.tsx$/) || has(/\.tsx$/)) {
    frameworks.push("react");
  }
  if (has(/(^|\/)next\.config\.(js|mjs|ts)$/) || has(/(^|\/)app\//)) {
    frameworks.push("next");
  }
  if (has(/(^|\/)pyproject\.toml$/) || has(/\.py$/)) {
    frameworks.push("python");
  }
  if (has(/(^|\/)pytest\.ini$/) || has(/(^|\/)tests?\//)) {
    frameworks.push("pytest");
  }
  if (has(/tailwind\.config\.(ts|js|mjs|cjs)$/)) {
    frameworks.push("tailwind");
  }

  return unique(frameworks);
}

function detectLanguages(files: WorkspaceProjectFile[]): string[] {
  const mapped = files.map((file) => file.language.toLowerCase());
  const normalizedPaths = files.map((file) => normalizePath(file.relativePath));

  if (normalizedPaths.some((pathValue) => /\.tsx?$/.test(pathValue))) {
    mapped.push("typescript");
  }
  if (normalizedPaths.some((pathValue) => /\.jsx?$/.test(pathValue))) {
    mapped.push("javascript");
  }
  if (normalizedPaths.some((pathValue) => /\.py$/.test(pathValue))) {
    mapped.push("python");
  }

  return unique(mapped);
}

function detectArchitectureNotes(files: WorkspaceProjectFile[]): string[] {
  const normalized = files.map((file) => normalizePath(file.relativePath));
  const notes: string[] = [];

  if (normalized.some((entry) => entry.startsWith("apps/desktop/"))) {
    notes.push("Monorepo mit Desktop-App unter apps/desktop.");
  }
  if (normalized.some((entry) => entry.startsWith("backend/"))) {
    notes.push("Backend-Komponenten liegen getrennt unter backend.");
  }
  if (normalized.some((entry) => entry.startsWith("packages/shared/"))) {
    notes.push("Geteilte Typen/Vertraege werden in packages/shared gepflegt.");
  }
  if (normalized.some((entry) => /(^|\/)stores\//.test(entry))) {
    notes.push("State-Management basiert auf modularen Stores.");
  }
  if (normalized.some((entry) => /(^|\/)services\//.test(entry))) {
    notes.push("Domänenlogik wird ueber Services gekapselt.");
  }

  return unique(notes);
}

function detectCodingPatterns(frameworks: string[], files: WorkspaceProjectFile[]): string[] {
  const patterns: string[] = ["Safe Editing Layer fuer Dateiaenderungen nutzen."];

  if (frameworks.includes("typescript")) {
    patterns.push("TypeScript strict beibehalten und any vermeiden.");
  }
  if (frameworks.includes("react")) {
    patterns.push("UI-Komponenten klein halten und Logik in Stores/Services auslagern.");
  }
  if (files.some((file) => normalizePath(file.relativePath).includes("tests/"))) {
    patterns.push("Neue Features mit fokussierten Service- und Store-Tests absichern.");
  }

  return unique(patterns);
}

function detectImportantFiles(files: WorkspaceProjectFile[]): ImportantFile[] {
  const result: ImportantFile[] = [];
  const normalized = files.map((file) => ({
    ...file,
    normalized: normalizePath(file.relativePath)
  }));

  const mark = (pattern: RegExp, reason: string) => {
    const found = normalized.find((file) => pattern.test(file.normalized));
    if (!found) {
      return;
    }
    result.push({
      path: found.normalized,
      reason
    });
  };

  mark(/(^|\/)README\.md$/i, "Projektueberblick und Startpunkte.");
  mark(/(^|\/)AGENTS\.md$/i, "Agent- und Architekturregeln.");
  mark(/(^|\/)package\.json$/i, "Node-Abhaengigkeiten und Scripts.");
  mark(/(^|\/)pyproject\.toml$/i, "Python-Abhaengigkeiten und Tooling.");
  mark(/(^|\/)apps\/desktop\/src\/App\.tsx$/i, "Zentrale UI-Komposition.");
  mark(/(^|\/)packages\/shared\/src\/index\.ts$/i, "Shared Types/Contracts.");

  return unique(result.map((entry) => `${entry.path}::${entry.reason}`)).map((entry) => {
    const [path, reason] = entry.split("::");
    return { path, reason };
  });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isProjectMemory(value: unknown): value is ProjectMemory {
  if (!value || typeof value !== "object") {
    return false;
  }

  const casted = value as Partial<ProjectMemory>;
  return (
    typeof casted.projectId === "string" &&
    typeof casted.projectName === "string" &&
    typeof casted.workspaceRoot === "string" &&
    Array.isArray(casted.frameworks) &&
    Array.isArray(casted.languages) &&
    Array.isArray(casted.architectureNotes) &&
    Array.isArray(casted.codingPatterns) &&
    Array.isArray(casted.importantFiles) &&
    Array.isArray(casted.recentTasks) &&
    Array.isArray(casted.knownIssues) &&
    typeof casted.updatedAt === "string"
  );
}

export class ProjectMemoryService {
  private currentWorkspaceRoot: string | null = null;

  private currentMemory: ProjectMemory | null = null;

  private getMemoryFilePath(workspaceRoot: string): string {
    const base = normalizePath(workspaceRoot);
    return joinPath(base, `${MEMORY_DIR_NAME}/${MEMORY_FILE_NAME}`);
  }

  private createEmptyMemory(workspaceRoot: string, projectName: string, files: WorkspaceProjectFile[]): ProjectMemory {
    const frameworks = detectFrameworks(files);
    const languages = detectLanguages(files);
    return {
      projectId: createId("project"),
      projectName,
      workspaceRoot: normalizePath(workspaceRoot),
      frameworks,
      languages,
      architectureNotes: detectArchitectureNotes(files),
      codingPatterns: detectCodingPatterns(frameworks, files),
      importantFiles: detectImportantFiles(files),
      recentTasks: [],
      knownIssues: [],
      updatedAt: new Date().toISOString()
    };
  }

  async loadProjectMemory(workspaceRoot: string): Promise<ProjectMemory> {
    const readProjectFile = backendClient.readProjectFile;
    const scanProjectFiles = backendClient.scanProjectFiles;

    if (!readProjectFile || !scanProjectFiles) {
      throw new Error("Workspace file bridge ist nicht verfuegbar.");
    }

    const normalizedRoot = normalizePath(workspaceRoot);
    const memoryFilePath = this.getMemoryFilePath(normalizedRoot);

    const existing = await readProjectFile(memoryFilePath);
    if (existing?.content) {
      const parsed = safeJsonParse(existing.content);
      if (isProjectMemory(parsed)) {
        this.currentWorkspaceRoot = normalizedRoot;
        this.currentMemory = parsed;
        return parsed;
      }
    }

    const files = await scanProjectFiles(normalizedRoot);
    const projectName = normalizedRoot.split("/").filter(Boolean).at(-1) ?? "workspace";
    const empty = this.createEmptyMemory(normalizedRoot, projectName, files);

    await this.saveProjectMemory(empty);
    return empty;
  }

  async saveProjectMemory(memory: ProjectMemory): Promise<ProjectMemory> {
    const writeProjectFile = backendClient.writeProjectFile;
    if (!writeProjectFile) {
      throw new Error("Workspace write bridge ist nicht verfuegbar.");
    }

    const next: ProjectMemory = {
      ...memory,
      workspaceRoot: normalizePath(memory.workspaceRoot),
      frameworks: unique(memory.frameworks),
      languages: unique(memory.languages),
      architectureNotes: unique(memory.architectureNotes),
      codingPatterns: unique(memory.codingPatterns),
      importantFiles: memory.importantFiles.filter((entry) => entry.path.trim().length > 0),
      recentTasks: memory.recentTasks.slice(0, 25),
      knownIssues: memory.knownIssues,
      updatedAt: new Date().toISOString()
    };

    const memoryFilePath = this.getMemoryFilePath(next.workspaceRoot);
    await writeProjectFile(memoryFilePath, `${JSON.stringify(next, null, 2)}\n`);

    this.currentWorkspaceRoot = next.workspaceRoot;
    this.currentMemory = next;
    return next;
  }

  async updateProjectMemory(memory: ProjectMemory): Promise<ProjectMemory> {
    return this.saveProjectMemory({
      ...memory,
      updatedAt: new Date().toISOString()
    });
  }

  async addRecentTask(task: MemoryTask): Promise<ProjectMemory> {
    const memory = this.requireCurrentMemory();
    const next: ProjectMemory = {
      ...memory,
      recentTasks: [{ ...task }, ...memory.recentTasks.filter((entry) => entry.id !== task.id)].slice(0, 25)
    };

    return this.updateProjectMemory(next);
  }

  async addKnownIssue(issue: KnownIssue): Promise<ProjectMemory> {
    const memory = this.requireCurrentMemory();
    const next: ProjectMemory = {
      ...memory,
      knownIssues: [{ ...issue }, ...memory.knownIssues.filter((entry) => entry.id !== issue.id)]
    };

    return this.updateProjectMemory(next);
  }

  async markImportantFile(path: string, reason: string): Promise<ProjectMemory> {
    const memory = this.requireCurrentMemory();
    const normalizedPath = normalizePath(path);
    const trimmedReason = reason.trim();
    const existing = memory.importantFiles.find((entry) => normalizePath(entry.path) === normalizedPath);

    const nextFiles = existing
      ? memory.importantFiles.map((entry) =>
          normalizePath(entry.path) === normalizedPath
            ? { ...entry, reason: trimmedReason || entry.reason }
            : entry
        )
      : [{ path: normalizedPath, reason: trimmedReason || "Als wichtig markiert." }, ...memory.importantFiles];

    return this.updateProjectMemory({
      ...memory,
      importantFiles: nextFiles
    });
  }

  private requireCurrentMemory(): ProjectMemory {
    if (!this.currentMemory || !this.currentWorkspaceRoot) {
      throw new Error("Project Memory ist nicht geladen.");
    }

    return this.currentMemory;
  }
}

export const projectMemoryService = new ProjectMemoryService();
