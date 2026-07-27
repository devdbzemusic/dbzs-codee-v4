import type {
  RuntimeChatWorkspaceContext,
  WorkspaceFile,
  WorkspaceProjectFile
} from "@dbzs/shared";
import { isContextPathAllowed } from "@dbzs/shared";

const MAX_WORKSPACE_TREE_FILES = 80;
const MAX_SAMPLED_FILES = 6;
const MAX_SAMPLED_FILE_CHARS = 2_000;

const IMPORTANT_FILE_NAMES = new Set([
  "README.md",
  "AGENTS.md",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "tsconfig.json",
  "vite.config.ts",
  "electron.vite.config.ts"
]);

export type WorkspaceContextProgressEvent =
  | { type: "start"; workspaceName: string; candidateCount: number; treeFileCount: number }
  | { type: "reading"; relativePath: string }
  | { type: "loaded"; relativePath: string; charCount: number; language: string }
  | { type: "failed"; relativePath: string }
  | { type: "done"; sampledCount: number; failedCount: number; treeFileCount: number };

export interface WorkspaceContextBuildResult {
  context: RuntimeChatWorkspaceContext | null;
  sampledCount: number;
  failedCount: number;
}

function isContextEligible(file: WorkspaceProjectFile): boolean {
  return isContextPathAllowed(file.relativePath);
}

function pickContextFiles(files: WorkspaceProjectFile[], activeFilePath: string | null): WorkspaceProjectFile[] {
  const eligibleFiles = files.filter(isContextEligible);
  const activeFile = activeFilePath
    ? eligibleFiles.find((file) => file.path === activeFilePath) ?? null
    : null;
  const important = eligibleFiles.filter((file) => IMPORTANT_FILE_NAMES.has(file.name));
  const sourceEntrypoints = eligibleFiles.filter((file) =>
    /(^|[\\/])(main|app|index|config|settings)\.(py|ts|tsx|js|json)$/i.test(file.relativePath)
  );

  const seen = new Set<string>();
  return [activeFile, ...important, ...sourceEntrypoints].filter((file): file is WorkspaceProjectFile => {
    if (!file) {
      return false;
    }
    if (seen.has(file.path)) {
      return false;
    }
    seen.add(file.path);
    return true;
  }).slice(0, MAX_SAMPLED_FILES);
}

export async function buildWorkspaceContext(
  workspaceRoot: string | null,
  workspaceName: string | null,
  workspaceFiles: WorkspaceProjectFile[],
  activeFile: WorkspaceFile | null,
  onProgress?: (event: WorkspaceContextProgressEvent) => void
): Promise<WorkspaceContextBuildResult> {
  if (!workspaceRoot) {
    return {
      context: null,
      sampledCount: 0,
      failedCount: 0
    };
  }

  const activeFilePath = activeFile?.path ?? null;
  const candidates = pickContextFiles(workspaceFiles, activeFilePath);
  const treeFiles = workspaceFiles.filter(isContextEligible).slice(0, MAX_WORKSPACE_TREE_FILES);
  const resolvedName = workspaceName ?? workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace";

  onProgress?.({
    type: "start",
    workspaceName: resolvedName,
    candidateCount: candidates.length,
    treeFileCount: treeFiles.length
  });

  const sampledFiles = [];
  let failedCount = 0;

  for (const file of candidates) {
    onProgress?.({ type: "reading", relativePath: file.relativePath });
    try {
      const loaded =
        activeFile && activeFile.path === file.path
          ? activeFile
          : await window.dbzs.readProjectFile?.(file.path);

      if (!loaded) {
        continue;
      }

      const content = loaded.content.slice(0, MAX_SAMPLED_FILE_CHARS);
      sampledFiles.push({
        path: loaded.path,
        relativePath: file.relativePath,
        language: loaded.language,
        content
      });
      onProgress?.({
        type: "loaded",
        relativePath: file.relativePath,
        charCount: content.length,
        language: loaded.language
      });
    } catch {
      failedCount += 1;
      onProgress?.({ type: "failed", relativePath: file.relativePath });
    }
  }

  onProgress?.({
    type: "done",
    sampledCount: sampledFiles.length,
    failedCount,
    treeFileCount: treeFiles.length
  });

  return {
    context: {
      rootPath: workspaceRoot,
      name: resolvedName,
      fileTree: treeFiles.map((file) => file.relativePath),
      sampledFiles
    },
    sampledCount: sampledFiles.length,
    failedCount
  };
}

export function formatWorkspaceContextSummary(context: RuntimeChatWorkspaceContext | null | undefined): string {
  if (!context) {
    return "Kein Workspace-Kontext";
  }

  const sampled = context.sampledFiles
    .map((file) => `${file.relativePath} (${file.language}, ${file.content.length} Zeichen)`)
    .join("\n");

  return [
    `Workspace: ${context.name}`,
    `Root: ${context.rootPath}`,
    `Dateibaum: ${context.fileTree.length} Eintraege`,
    `Geladene Kontextdateien (${context.sampledFiles.length}):`,
    sampled || "- (keine)"
  ].join("\n");
}

export function buildWorkspaceContextSystemMessage(
  workspaceContext: RuntimeChatWorkspaceContext | null | undefined
): string | null {
  if (!workspaceContext) {
    return null;
  }

  const fileTreePreview = workspaceContext.fileTree
    .slice(0, 40)
    .map((entry) => `- ${entry}`)
    .join("\n");
  const fileBlocks = workspaceContext.sampledFiles.map(
    (file) =>
      `### ${file.relativePath} (${file.language})\n\`\`\`${file.language}\n${file.content}\n\`\`\``
  );

  return [
    "[Workspace Context]",
    `Name: ${workspaceContext.name}`,
    `Root: ${workspaceContext.rootPath}`,
    "",
    "Project file tree (preview):",
    fileTreePreview || "- (leer)",
    "",
    fileBlocks.length > 0 ? "Project file contents:" : "Project file contents: (keine geladen)",
    ...fileBlocks
  ].join("\n");
}
