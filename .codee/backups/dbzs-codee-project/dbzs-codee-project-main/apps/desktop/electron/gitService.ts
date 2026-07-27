import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  GitCommitSuggestion,
  GitDiffSummary,
  GitFileStatus,
  GitRepositoryStatus,
  GitStatusEntry
} from "@dbzs/shared";
import { ensurePathInsideWorkspace, toResolvedPath } from "./workspaceService.js";

interface GitServiceOptions {
  spawnImpl?: typeof spawn;
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface GitBranchDivergence {
  hasUpstream: boolean;
  aheadCount: number;
  behindCount: number;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

function statusFromPorcelainCode(xy: string): GitFileStatus {
  if (xy === "??") {
    return "untracked";
  }

  const normalized = xy.padEnd(2, " ").slice(0, 2);
  const [x, y] = normalized;

  const conflictCodes = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU", "DC", "CD"]);
  if (conflictCodes.has(normalized) || x === "U" || y === "U") {
    return "conflicted";
  }

  if (x === "R" || y === "R") {
    return "renamed";
  }
  if (x === "D" || y === "D") {
    return "deleted";
  }
  if (x === "A" || y === "A") {
    return "added";
  }
  if (x === "M" || y === "M" || x === "T" || y === "T") {
    return "modified";
  }

  return "modified";
}

function parsePorcelainStatus(stdout: string): GitStatusEntry[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const entries: GitStatusEntry[] = [];
  for (const line of lines) {
    if (line.length < 3) {
      continue;
    }

    const xy = line.slice(0, 2);
    const rest = line.slice(3).trim();
    const target = rest.includes(" -> ") ? rest.split(" -> ").at(-1) ?? rest : rest;
    const filePath = normalizePath(unquote(target));
    if (!filePath) {
      continue;
    }

    entries.push({
      filePath,
      status: statusFromPorcelainCode(xy)
    });
  }

  return entries;
}

function parseDiffStat(stdout: string): GitDiffSummary[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/files? changed/i.test(line));

  const summaries: GitDiffSummary[] = [];
  for (const line of lines) {
    const [left, right] = line.split("|").map((part) => part.trim());
    if (!left || !right) {
      continue;
    }

    const filePath = normalizePath(unquote(left.includes(" => ") ? left.split(" => ").at(-1) ?? left : left));
    const additions = (right.match(/\+/g) ?? []).length;
    const deletions = (right.match(/-/g) ?? []).length;
    summaries.push({
      filePath,
      additions,
      deletions,
      summary: right
    });
  }

  return summaries;
}

function sanitizeCommitTitle(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9_\-/ ]/g, "")
    .trim()
    .slice(0, 72);
}

export class GitService {
  private readonly spawnImpl: typeof spawn;

  constructor(options: GitServiceOptions = {}) {
    this.spawnImpl = options.spawnImpl ?? spawn;
  }

  private async ensureWorkspaceRoot(workspaceRoot: string): Promise<string> {
    const resolved = toResolvedPath(workspaceRoot);
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) {
      throw new Error("[GIT_WORKSPACE_INVALID] Workspace root ist kein Verzeichnis.");
    }
    return resolved;
  }

  private ensureFileInsideWorkspace(workspaceRoot: string, filePath: string): string {
    return ensurePathInsideWorkspace(workspaceRoot, filePath);
  }

  private async runGit(
    workspaceRoot: string,
    args: string[],
    timeoutMs: number
  ): Promise<GitCommandResult> {
    const safeWorkspace = await this.ensureWorkspaceRoot(workspaceRoot);

    return await new Promise<GitCommandResult>((resolve, reject) => {
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      let timedOut = false;
      let settled = false;

      const child = this.spawnImpl("git", args, {
        cwd: safeWorkspace,
        shell: false,
        windowsHide: true
      });

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, Math.max(100, timeoutMs));

      const finalize = (result: GitCommandResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        if (timedOut) {
          reject(new Error(`[GIT_TIMEOUT] git ${args.join(" ")} timed out.`));
          return;
        }
        resolve(result);
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf-8"));
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf-8"));
      });

      child.on("error", (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        reject(new Error(`[GIT_ERROR] ${error.message}`));
      });

      child.on("exit", (code) => {
        finalize({
          stdout: stdoutChunks.join(""),
          stderr: stderrChunks.join(""),
          code: code ?? 1
        });
      });
    });
  }

  async validateGitRepository(workspaceRoot: string, timeoutMs: number): Promise<boolean> {
    const result = await this.runGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"], timeoutMs);
    return result.code === 0 && result.stdout.trim() === "true";
  }

  async getCurrentBranch(workspaceRoot: string, timeoutMs: number): Promise<string> {
    const result = await this.runGit(workspaceRoot, ["branch", "--show-current"], timeoutMs);
    if (result.code !== 0) {
      throw new Error(`[GIT_ERROR] ${result.stderr.trim() || "Branch konnte nicht gelesen werden."}`);
    }

    return result.stdout.trim();
  }

  async getChangedFiles(workspaceRoot: string, timeoutMs: number): Promise<GitStatusEntry[]> {
    const result = await this.runGit(workspaceRoot, ["status", "--porcelain=v1"], timeoutMs);
    if (result.code !== 0) {
      throw new Error(`[GIT_ERROR] ${result.stderr.trim() || "Git-Status konnte nicht gelesen werden."}`);
    }

    return parsePorcelainStatus(result.stdout);
  }

  async getBranchDivergence(workspaceRoot: string, timeoutMs: number): Promise<GitBranchDivergence> {
    const upstreamResult = await this.runGit(
      workspaceRoot,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      timeoutMs
    );

    if (upstreamResult.code !== 0) {
      return {
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0
      };
    }

    const divergenceResult = await this.runGit(
      workspaceRoot,
      ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
      timeoutMs
    );
    if (divergenceResult.code !== 0) {
      throw new Error(`[GIT_ERROR] ${divergenceResult.stderr.trim() || "Branch-Divergenz konnte nicht gelesen werden."}`);
    }

    const [behindRaw = "0", aheadRaw = "0"] = divergenceResult.stdout.trim().split(/\s+/);
    const behindCount = Number.parseInt(behindRaw, 10);
    const aheadCount = Number.parseInt(aheadRaw, 10);

    return {
      hasUpstream: true,
      aheadCount: Number.isNaN(aheadCount) ? 0 : Math.max(0, aheadCount),
      behindCount: Number.isNaN(behindCount) ? 0 : Math.max(0, behindCount)
    };
  }

  async getRepositoryStatus(workspaceRoot: string, timeoutMs: number): Promise<GitRepositoryStatus> {
    const safeWorkspace = await this.ensureWorkspaceRoot(workspaceRoot);
    const isRepository = await this.validateGitRepository(safeWorkspace, timeoutMs);
    if (!isRepository) {
      return {
        workspaceRoot: safeWorkspace,
        isRepository: false,
        hasUncommittedChanges: false,
        entries: [],
        updatedAt: new Date().toISOString()
      };
    }

    const [currentBranch, entries] = await Promise.all([
      this.getCurrentBranch(safeWorkspace, timeoutMs),
      this.getChangedFiles(safeWorkspace, timeoutMs)
    ]);
    const divergence = await this.getBranchDivergence(safeWorkspace, timeoutMs);

    return {
      workspaceRoot: safeWorkspace,
      isRepository: true,
      currentBranch,
      hasUpstream: divergence.hasUpstream,
      aheadCount: divergence.aheadCount,
      behindCount: divergence.behindCount,
      hasUncommittedChanges: entries.length > 0,
      entries,
      updatedAt: new Date().toISOString()
    };
  }

  async getDiff(workspaceRoot: string, timeoutMs: number, filePath?: string): Promise<string> {
    const safeWorkspace = await this.ensureWorkspaceRoot(workspaceRoot);
    const args = ["diff", "--"];

    if (filePath && filePath.trim().length > 0) {
      const safeFile = this.ensureFileInsideWorkspace(safeWorkspace, filePath);
      const relative = normalizePath(path.relative(safeWorkspace, safeFile));
      args.push(relative);
    }

    const result = await this.runGit(safeWorkspace, args, timeoutMs);
    if (result.code !== 0) {
      throw new Error(`[GIT_ERROR] ${result.stderr.trim() || "Diff konnte nicht gelesen werden."}`);
    }

    return result.stdout;
  }

  async getDiffSummary(workspaceRoot: string, timeoutMs: number): Promise<GitDiffSummary[]> {
    const isRepo = await this.validateGitRepository(workspaceRoot, timeoutMs);
    if (!isRepo) return [];

    const result = await this.runGit(workspaceRoot, ["diff", "--stat"], timeoutMs);
    if (result.code !== 0) {
      throw new Error(`[GIT_ERROR] ${result.stderr.trim() || "Diff-Stat konnte nicht gelesen werden."}`);
    }

    return parseDiffStat(result.stdout);
  }

  async suggestCommitMessage(diffSummary: GitDiffSummary[]): Promise<GitCommitSuggestion> {
    if (diffSummary.length === 0) {
      return {
        title: "chore: no local changes",
        body: "No changed files detected.",
        affectedFiles: [],
        riskLevel: "low"
      };
    }

    const affectedFiles = unique(diffSummary.map((entry) => entry.filePath));
    const totalAdditions = diffSummary.reduce((acc, entry) => acc + entry.additions, 0);
    const totalDeletions = diffSummary.reduce((acc, entry) => acc + entry.deletions, 0);
    const touchesTests = affectedFiles.some((file) => /(^|\/)(tests?|__tests__|specs?)(\/|$)|\.(test|spec)\./i.test(file));
    const touchesCritical = affectedFiles.some((file) => /electron\/main\.ts$|electron\/preload\.ts$|packages\/shared\/src\/index\.ts$|backend\//i.test(file));

    const scope = touchesCritical ? "core" : touchesTests ? "tests" : "workspace";
    const title = sanitizeCommitTitle(`feat(${scope}): update ${affectedFiles.length} files`);

    let riskLevel: "low" | "medium" | "high" = "low";
    if (touchesCritical || diffSummary.length > 15 || totalAdditions + totalDeletions > 800) {
      riskLevel = "high";
    } else if (diffSummary.length > 6 || totalAdditions + totalDeletions > 250) {
      riskLevel = "medium";
    }

    return {
      title: title || "feat: update workspace changes",
      body: `Changed files: ${affectedFiles.length}. Additions: ${totalAdditions}. Deletions: ${totalDeletions}.`,
      affectedFiles,
      riskLevel
    };
  }
}
