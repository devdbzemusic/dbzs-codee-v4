import { spawn } from "node:child_process";
import path from "node:path";
import type {
  CommitAssistantContext,
  CommitMessageSuggestion,
  CommitRequest,
  CommitResult,
  GitDiffSummary
} from "@dbzs/shared";
import { ensurePathInsideWorkspace, toResolvedPath } from "./workspaceService.js";
import { GitService } from "./gitService.js";
import type { RestorePointService } from "./restorePointService.js";

interface CommitAssistantServiceOptions {
  gitService?: GitService;
  restorePointService?: RestorePointService;
  spawnImpl?: typeof spawn;
  timeoutMs?: number;
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

const MAX_TITLE_LENGTH = 72;

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+$/g, "").replace(/\/+/g, "/").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sanitizeText(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeTitle(value: string): string {
  return sanitizeText(value)
    .replace(/[^a-zA-Z0-9_:/()\-., ]/g, "")
    .slice(0, MAX_TITLE_LENGTH);
}

function scopeFromFiles(files: string[]): string {
  const normalized = files.map((file) => normalizePath(file).toLowerCase());
  if (normalized.some((file) => file.startsWith("backend/"))) {
    return "backend";
  }
  if (normalized.some((file) => file.startsWith("packages/shared/"))) {
    return "shared";
  }
  if (normalized.some((file) => file.includes("/components/"))) {
    return "ui";
  }
  if (normalized.some((file) => file.includes("/stores/"))) {
    return "store";
  }
  if (normalized.some((file) => file.includes("/services/"))) {
    return "service";
  }
  return "workspace";
}

function computeRisk(diffSummary: GitDiffSummary[], changedFileCount: number): "low" | "medium" | "high" {
  const totalChurn = diffSummary.reduce((sum, entry) => sum + entry.additions + entry.deletions, 0);
  const hasLargeFile = diffSummary.some((entry) => entry.additions + entry.deletions >= 300);

  if (hasLargeFile || changedFileCount > 20 || totalChurn > 1200) {
    return "high";
  }
  if (changedFileCount > 8 || totalChurn > 300) {
    return "medium";
  }
  return "low";
}

function detectType(files: string[], context?: CommitAssistantContext): CommitMessageSuggestion["type"] {
  const normalized = files.map((file) => normalizePath(file).toLowerCase());
  const hasFailedTests = (context?.testResults ?? []).some(
    (result) => result.status === "failed" || (typeof result.exitCode === "number" && result.exitCode > 0)
  );
  const hasReviewErrors = (context?.reviewReports ?? []).some((report) =>
    report.findings.some((finding) => finding.severity === "error")
  );

  if (hasFailedTests || hasReviewErrors) {
    return "fix";
  }
  if (normalized.every((file) => /(^|\/)docs?\//.test(file) || file.endsWith(".md"))) {
    return "docs";
  }
  if (normalized.every((file) => /(^|\/)tests?\//.test(file) || /\.(test|spec)\./.test(file))) {
    return "test";
  }
  if ((context?.appliedChanges ?? []).some((change) => /refactor|cleanup|simplify/i.test(change.reason))) {
    return "refactor";
  }
  if (normalized.every((file) => /(^|\/)\.github\//.test(file) || file.includes("package.json") || file.includes("pnpm-lock"))) {
    return "chore";
  }
  return "feat";
}

function summaryForType(type: CommitMessageSuggestion["type"], context?: CommitAssistantContext): string {
  const hasFailedTests = (context?.testResults ?? []).some(
    (result) => result.status === "failed" || (typeof result.exitCode === "number" && result.exitCode > 0)
  );

  switch (type) {
    case "fix":
      return hasFailedTests ? "stabilize failing checks" : "address review findings";
    case "refactor":
      return "improve internal structure";
    case "test":
      return "expand validation coverage";
    case "docs":
      return "update project documentation";
    case "chore":
      return "maintain workspace configuration";
    case "feat":
    default:
      return "extend workspace capabilities";
  }
}

function buildBody(
  files: string[],
  diffSummary: GitDiffSummary[],
  context?: CommitAssistantContext
): string | undefined {
  const lines: string[] = [];
  const totalChurn = diffSummary.reduce((sum, entry) => sum + entry.additions + entry.deletions, 0);
  lines.push(`Changed files: ${files.length}`);
  lines.push(`Diff churn: ${totalChurn} lines`);

  const agentRuns = context?.agentRuns ?? [];
  if (agentRuns.length > 0) {
    const failed = agentRuns.filter((run) => run.status === "failed").length;
    lines.push(`Agent runs: ${agentRuns.length} total, ${failed} failed`);
  }

  const testResults = context?.testResults ?? [];
  if (testResults.length > 0) {
    const failedTests = testResults.filter(
      (result) => result.status === "failed" || (typeof result.exitCode === "number" && result.exitCode > 0)
    ).length;
    lines.push(`Validation: ${failedTests === 0 ? "tests passed" : `${failedTests} test checks failed`}`);
  }

  const reviewReports = context?.reviewReports ?? [];
  if (reviewReports.length > 0) {
    const reviewErrors = reviewReports
      .flatMap((report) => report.findings)
      .filter((finding) => finding.severity === "error").length;
    lines.push(`Review: ${reviewErrors === 0 ? "no error findings" : `${reviewErrors} error findings present`}`);
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function ensureSafePathArg(relativePath: string): void {
  if (!relativePath || relativePath.includes("\u0000")) {
    throw new Error("[COMMIT_INVALID] Ungueltiger Dateipfad in includeFiles.");
  }
  if (relativePath.startsWith("-")) {
    throw new Error("[COMMIT_INVALID] Dateipfade duerfen nicht mit '-' beginnen.");
  }
}

export class CommitAssistantService {
  private readonly gitService: GitService;

  private readonly restorePointService?: RestorePointService;

  private readonly spawnImpl: typeof spawn;

  private readonly timeoutMs: number;

  constructor(options: CommitAssistantServiceOptions = {}) {
    this.gitService = options.gitService ?? new GitService();
    this.restorePointService = options.restorePointService;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? 30_000);
  }

  private async runGit(workspaceRoot: string, args: string[]): Promise<GitCommandResult> {
    const safeWorkspace = toResolvedPath(workspaceRoot);

    return await new Promise<GitCommandResult>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const child = this.spawnImpl("git", args, {
        cwd: safeWorkspace,
        shell: false,
        windowsHide: true
      });

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.timeoutMs);

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

      child.on("error", (error) => {
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

  async suggestCommitMessages(
    workspaceRoot: string,
    context?: CommitAssistantContext
  ): Promise<CommitMessageSuggestion[]> {
    const repositoryStatus = await this.gitService.getRepositoryStatus(workspaceRoot, this.timeoutMs);
    if (!repositoryStatus.isRepository || !repositoryStatus.hasUncommittedChanges) {
      return [];
    }

    const diffSummary = await this.gitService.getDiffSummary(workspaceRoot, this.timeoutMs);
    const filesFromDiff = diffSummary.map((entry) => entry.filePath);
    const filesFromStatus = repositoryStatus.entries.map((entry) => entry.filePath);
    const affectedFiles = unique([...filesFromDiff, ...filesFromStatus]);

    const type = detectType(affectedFiles, context);
    const scope = scopeFromFiles(affectedFiles);
    const riskLevel = computeRisk(diffSummary, affectedFiles.length);
    const shortSummary = summaryForType(type, context);
    const body = buildBody(affectedFiles, diffSummary, context);

    const primary: CommitMessageSuggestion = {
      id: `commit-suggestion-${Date.now().toString(36)}`,
      title: `${type}(${scope}): ${shortSummary}`,
      body,
      type,
      scope,
      affectedFiles,
      riskLevel,
      createdAt: new Date().toISOString()
    };

    const secondary: CommitMessageSuggestion = {
      id: `commit-suggestion-alt-${Date.now().toString(36)}`,
      title: `chore(${scope}): update ${affectedFiles.length} files`,
      body,
      type: "chore",
      scope,
      affectedFiles,
      riskLevel,
      createdAt: new Date().toISOString()
    };

    return [primary, secondary];
  }

  buildCommitMessage(suggestion: CommitMessageSuggestion): string {
    const title = sanitizeTitle(suggestion.title);
    if (!title) {
      throw new Error("[COMMIT_INVALID] Commit-Titel ist leer.");
    }

    const body = sanitizeText(suggestion.body ?? "");
    return body ? `${title}\n\n${body}` : title;
  }

  async validateCommitRequest(workspaceRoot: string, request: CommitRequest): Promise<void> {
    const safeWorkspace = toResolvedPath(workspaceRoot);
    const repositoryStatus = await this.gitService.getRepositoryStatus(safeWorkspace, this.timeoutMs);

    if (!repositoryStatus.isRepository) {
      throw new Error("[COMMIT_BLOCKED] Workspace ist kein Git-Repository.");
    }
    if (!repositoryStatus.hasUncommittedChanges) {
      throw new Error("[COMMIT_BLOCKED] Keine lokalen Aenderungen vorhanden.");
    }

    const includeFiles = unique(request.includeFiles);
    if (includeFiles.length === 0) {
      throw new Error("[COMMIT_BLOCKED] includeFiles darf nicht leer sein.");
    }

    for (const filePath of includeFiles) {
      const absoluteCandidate = path.isAbsolute(filePath) ? filePath : path.join(safeWorkspace, filePath);
      const safeFile = ensurePathInsideWorkspace(safeWorkspace, absoluteCandidate);
      const relativePath = normalizePath(path.relative(safeWorkspace, safeFile));
      ensureSafePathArg(relativePath);
    }

    const changedFileSet = new Set(repositoryStatus.entries.map((entry) => normalizePath(entry.filePath)));
    const includedChangedFiles = includeFiles.filter((filePath) => changedFileSet.has(normalizePath(filePath)));
    if (includedChangedFiles.length === 0) {
      throw new Error("[COMMIT_BLOCKED] includeFiles enthaelt keine geaenderten Dateien.");
    }

    this.buildCommitMessage(request.message);
  }

  async createCommit(workspaceRoot: string, request: CommitRequest): Promise<CommitResult> {
    try {
      const safeWorkspace = toResolvedPath(workspaceRoot);
      await this.validateCommitRequest(safeWorkspace, request);

      const includeFiles = unique(request.includeFiles);
      const absoluteFiles = includeFiles.map((filePath) => {
        const absoluteCandidate = path.isAbsolute(filePath) ? filePath : path.join(safeWorkspace, filePath);
        return ensurePathInsideWorkspace(safeWorkspace, absoluteCandidate);
      });

      const relativeFiles = absoluteFiles.map((safeFile) => {
        const relative = normalizePath(path.relative(safeWorkspace, safeFile));
        ensureSafePathArg(relative);
        return relative;
      });

      if (this.restorePointService) {
        await this.restorePointService.createRestorePoint(
          safeWorkspace,
          absoluteFiles,
          "before_commit",
          `Before commit: ${sanitizeTitle(request.message.title) || "local commit"}`
        );
      }

      const addResult = await this.runGit(safeWorkspace, ["add", "--", ...relativeFiles]);
      if (addResult.code !== 0) {
        return {
          success: false,
          error: `[GIT_ERROR] ${addResult.stderr.trim() || "git add fehlgeschlagen."}`
        };
      }

      const title = sanitizeTitle(request.message.title);
      const body = sanitizeText(request.message.body ?? "");
      const commitArgs = ["commit", "-m", title];
      if (body) {
        commitArgs.push("-m", body);
      }

      const commitResult = await this.runGit(safeWorkspace, commitArgs);
      if (commitResult.code !== 0) {
        return {
          success: false,
          error: `[GIT_ERROR] ${commitResult.stderr.trim() || "git commit fehlgeschlagen."}`
        };
      }

      const hashResult = await this.runGit(safeWorkspace, ["rev-parse", "HEAD"]);
      if (hashResult.code !== 0) {
        return {
          success: false,
          error: `[GIT_ERROR] ${hashResult.stderr.trim() || "Commit Hash konnte nicht gelesen werden."}`
        };
      }

      const commitHash = hashResult.stdout.trim();
      return {
        success: true,
        commitHash
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Commit konnte nicht erstellt werden."
      };
    }
  }
}
