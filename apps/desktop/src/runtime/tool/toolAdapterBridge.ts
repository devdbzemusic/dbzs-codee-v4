import { useEditorStore } from "@/stores/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { parseStructuredCommandLine } from "@/services/structuredCommandParser";
import {
  assertValidPackageName,
  buildInstallDependencyArgs
} from "@/services/workspacePackageContract";
import type {
  AgentWebSearchResult,
  AgentWebDocument
} from "@dbzs/shared";
import { isContextPathAllowed } from "@dbzs/shared";
import type {
  SkillArtifactReference,
  SkillArtifactWriteRequest
} from "@/runtime/skill/skillContracts";

export interface ToolPatchPreview {
  patchId: string;
  filePath: string;
  diff: string;
  afterContent: string;
}

export interface ToolAdapterBridge {
  readFile(path: string, startLine?: number, endLine?: number): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(fromPath: string, toPath: string): Promise<void>;
  applyPatch(path: string, proposedContent: string, previewOnly: boolean): Promise<ToolPatchPreview>;
  listFiles(path?: string, recursive?: boolean): Promise<string[]>;
  searchWorkspace(query: string, limit: number): Promise<string[]>;
  grep(pattern: string, include: string | undefined, maxResults: number): Promise<string[]>;
  openFile(path: string): Promise<void>;
  runTerminalCommand(command: string, cwd?: string, timeoutMs?: number): Promise<string>;
  getGitDiff(filePath?: string): Promise<string>;
  runTests(commandId: string): Promise<{ runId: string; status: string }>;
  runWorkspaceCommand(commandId: string): Promise<string>;
  installDependency(input: {
    packageManager: "npm" | "pnpm" | "yarn" | "bun";
    packages: Array<{ name: string; version?: string }>;
    dependencyType: "production" | "development";
    reason: string;
    timeoutMs?: number;
  }): Promise<string>;
  webSearch(
    query: string,
    purpose: string,
    maxResults?: number,
    recencyDays?: number,
    allowedDomains?: string[],
    safeSearch?: "strict" | "moderate" | "off",
    language?: string
  ): Promise<AgentWebSearchResult>;
  webFetch(
    url: string,
    purpose: string,
    maxBytes?: number,
    timeoutMs?: number
  ): Promise<AgentWebDocument>;
  writeSkillArtifact(
    workspaceRoot: string,
    request: SkillArtifactWriteRequest
  ): Promise<SkillArtifactReference>;
}

function ensureBridgeMethod<T>(method: T | undefined, name: string): T {
  if (!method) {
    throw new Error(`${name} is unavailable.`);
  }
  return method;
}

function toPathFilter(pathValue: string, recursive: boolean): string {
  const normalized = pathValue.replace(/\\/g, "/").replace(/\/$/, "");
  return recursive ? `${normalized}/` : normalized;
}

export class DesktopToolAdapterBridge implements ToolAdapterBridge {
  async readFile(path: string, startLine?: number, endLine?: number): Promise<string> {
    if (!isContextPathAllowed(path)) {
      throw new Error("Path is excluded by workspace context policy.");
    }
    const reader = ensureBridgeMethod(window.dbzs.readProjectFile, "readProjectFile");
    const file = await reader(path);
    if (!file) {
      throw new Error("File not found.");
    }

    if (!startLine || !endLine) {
      return file.content;
    }

    const lines = file.content.split(/\r?\n/);
    const slice = lines.slice(startLine - 1, Math.max(startLine - 1, endLine));
    return `${slice.join("\n")}\n`;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const writer = ensureBridgeMethod(window.dbzs.writeProjectFile, "writeProjectFile");
    await writer(path, content);
  }

  async createFile(path: string, content: string): Promise<void> {
    const existing = await window.dbzs.readProjectFile?.(path);
    if (existing) {
      throw new Error("File already exists.");
    }
    await this.writeFile(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    const deleter = ensureBridgeMethod(window.dbzs.deleteWorkspacePath, "deleteWorkspacePath");
    await deleter(path);
  }

  async renameFile(fromPath: string, toPath: string): Promise<void> {
    const renamer = ensureBridgeMethod(window.dbzs.renameWorkspacePath, "renameWorkspacePath");
    await renamer(fromPath, toPath);
  }

  async applyPatch(path: string, proposedContent: string, previewOnly: boolean): Promise<ToolPatchPreview> {
    const patchApi = ensureBridgeMethod(window.dbzs.createWorkspaceDiff, "createWorkspaceDiff");
    const preview = await patchApi(path, proposedContent);

    if (previewOnly) {
      return {
        patchId: preview.snapshotId,
        filePath: path,
        diff: preview.diff,
        afterContent: preview.afterContent
      };
    }

    const applier = ensureBridgeMethod(window.dbzs.applyWorkspacePatch, "applyWorkspacePatch");
    await applier(path, preview.afterContent, preview.snapshotId, {
      reason: "before_patch",
      label: `Before patch apply: ${path}`
    });

    return {
      patchId: preview.snapshotId,
      filePath: path,
      diff: preview.diff,
      afterContent: preview.afterContent
    };
  }

  async listFiles(path?: string, recursive = false): Promise<string[]> {
    const workspace = useWorkspaceStore.getState();
    const files = workspace.files
      .map((entry) => entry.relativePath)
      .filter((entry) => isContextPathAllowed(entry));
    if (!path) {
      return files;
    }

    const filter = toPathFilter(path, recursive);
    return files.filter((entry) =>
      recursive ? entry.startsWith(filter) : entry === filter
    );
  }

  async searchWorkspace(query: string, limit: number): Promise<string[]> {
    const lowered = query.toLowerCase();
    const workspace = useWorkspaceStore.getState();
    return workspace.files
      .map((entry) => entry.relativePath)
      .filter((entry) => isContextPathAllowed(entry))
      .filter((entry) => entry.toLowerCase().includes(lowered))
      .slice(0, limit);
  }

  async grep(pattern: string, include: string | undefined, maxResults: number): Promise<string[]> {
    const regex = new RegExp(pattern, "i");
    const workspace = useWorkspaceStore.getState();
    const candidates = workspace.files.filter((entry) => {
      if (!isContextPathAllowed(entry.relativePath)) {
        return false;
      }
      if (!include) {
        return true;
      }
      return entry.relativePath.includes(include);
    });

    const results: string[] = [];
    for (const candidate of candidates) {
      const file = await window.dbzs.readProjectFile?.(candidate.path);
      if (!file) {
        continue;
      }
      const lines = file.content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!regex.test(line)) {
          continue;
        }
        results.push(`${candidate.relativePath}:${index + 1}:${line.trim()}`);
        if (results.length >= maxResults) {
          return results;
        }
      }
    }

    return results;
  }

  async openFile(path: string): Promise<void> {
    const opener = ensureBridgeMethod(useEditorStore.getState().openWorkspaceFile, "openWorkspaceFile");
    await opener(path);
  }

  async runTerminalCommand(command: string): Promise<string> {
    const runner = ensureBridgeMethod(window.dbzs.terminalExec, "terminalExec");
    const workspaceRoot = useWorkspaceStore.getState().state.projectPath;
    if (!workspaceRoot) {
      throw new Error("Workspace not active.");
    }
    const result = await runner(parseStructuredCommandLine(command, workspaceRoot));
    return `${result.stdout}\n${result.stderr}`.trim();
  }

  async getGitDiff(filePath?: string): Promise<string> {
    const reader = ensureBridgeMethod(window.dbzs.getGitDiff, "getGitDiff");
    const workspaceRoot = useWorkspaceStore.getState().state.projectPath;
    if (!workspaceRoot) {
      throw new Error("Workspace not active.");
    }
    return reader(workspaceRoot, filePath);
  }

  async runTests(commandId: string): Promise<{ runId: string; status: string }> {
    const workspaceRoot = useWorkspaceStore.getState().state.projectPath;
    if (!workspaceRoot) {
      throw new Error("Workspace not active.");
    }

    const executor = ensureBridgeMethod(window.dbzs.executeSafeCommand, "executeSafeCommand");
    const run = await executor(workspaceRoot, commandId);
    if (!run) {
      throw new Error("Test command did not start.");
    }
    return {
      runId: run.runId,
      status: run.status
    };
  }

  async runWorkspaceCommand(commandId: string): Promise<string> {
    const workspaceRoot = useWorkspaceStore.getState().state.projectPath;
    if (!workspaceRoot) {
      throw new Error("Workspace not active.");
    }

    const executor = ensureBridgeMethod(window.dbzs.executeSafeCommand, "executeSafeCommand");
    const getStatus = ensureBridgeMethod(window.dbzs.getSafeCommandRunStatus, "getSafeCommandRunStatus");
    const getLogs = ensureBridgeMethod(window.dbzs.streamSafeCommandLogs, "streamSafeCommandLogs");

    let run = await executor(workspaceRoot, commandId);
    if (!run) {
      throw new Error("Command did not start.");
    }

    const pollIntervalMs = 250;
    while (run.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      run = await getStatus(run.runId);
    }

    const logs = await getLogs(run.runId);
    const stdout = logs.stdout ?? "";
    const stderr = logs.stderr ?? "";
    const exitCode = run.exitCode !== null ? run.exitCode : 1;

    return `Command: ${commandId}\nExit Code: ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
  }

  async installDependency(input: {
    packageManager: "npm" | "pnpm" | "yarn" | "bun";
    packages: Array<{ name: string; version?: string }>;
    dependencyType: "production" | "development";
    reason: string;
    timeoutMs?: number;
  }): Promise<string> {
    const workspaceRoot = useWorkspaceStore.getState().state.projectPath;
    if (!workspaceRoot) {
      throw new Error("Workspace not active.");
    }
    for (const pkg of input.packages) {
      assertValidPackageName(pkg.name);
    }
    const built = buildInstallDependencyArgs({
      packageManager: input.packageManager,
      packages: input.packages,
      dependencyType: input.dependencyType
    });
    const runner = ensureBridgeMethod(window.dbzs.terminalExec, "terminalExec");
    const result = await runner({
      ...parseStructuredCommandLine(
        [built.command, ...built.args].join(" "),
        workspaceRoot
      ),
      timeoutMs: input.timeoutMs ?? 120_000
    });
    const exitNote =
      typeof (result as { exitCode?: number }).exitCode === "number"
        ? `Exit Code: ${(result as { exitCode?: number }).exitCode}`
        : "Exit Code: unknown";
    return [
      `Dependency install (${input.dependencyType})`,
      `Reason: ${input.reason}`,
      `Command: ${built.command} ${built.args.join(" ")}`,
      exitNote,
      `stdout:\n${result.stdout ?? ""}`,
      `stderr:\n${result.stderr ?? ""}`
    ].join("\n");
  }

  async webSearch(
    query: string,
    purpose: string,
    maxResults?: number,
    recencyDays?: number,
    allowedDomains?: string[],
    safeSearch?: "strict" | "moderate" | "off",
    language?: string
  ): Promise<AgentWebSearchResult> {
    const searcher = ensureBridgeMethod(window.dbzs.executeWebSearch, "executeWebSearch");
    return searcher({
      id: self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7),
      runId: "runtime-chat-run",
      query,
      purpose,
      maxResults: maxResults ?? 5,
      recencyDays,
      allowedDomains,
      safeSearch: safeSearch ?? "strict",
      language,
      createdAt: new Date().toISOString()
    });
  }

  async webFetch(
    url: string,
    purpose: string,
    maxBytes?: number,
    timeoutMs?: number
  ): Promise<AgentWebDocument> {
    const fetcher = ensureBridgeMethod(window.dbzs.executeWebFetch, "executeWebFetch");
    return fetcher({
      id: self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7),
      runId: "runtime-chat-run",
      url,
      purpose,
      maxBytes,
      timeoutMs,
      createdAt: new Date().toISOString()
    });
  }

  async writeSkillArtifact(
    workspaceRoot: string,
    request: SkillArtifactWriteRequest
  ): Promise<SkillArtifactReference> {
    const writer = ensureBridgeMethod(window.dbzs.writeSkillArtifact, "writeSkillArtifact");
    return writer(workspaceRoot, request);
  }
}
