import { backendClient } from "@/services/backendClient";
import { parseStructuredCommandLine } from "@/services/structuredCommandParser";
import { isExcludedRelativePath, joinRoot, normalizeRoot } from "./reviewPathUtils";
import type { ReviewWorkspaceFileEntry, ReviewWorkspaceIO } from "./types";

/**
 * Default Electron/backend-backed IO. Writes are limited to paths under the workspace
 * (including `.codee/reviews/` artifacts).
 */
export function createElectronReviewWorkspaceIO(): ReviewWorkspaceIO {
  return {
    async listFiles(workspaceRoot) {
      const files = await backendClient.scanProjectFiles(workspaceRoot);
      const entries: ReviewWorkspaceFileEntry[] = [];
      for (const file of files) {
        const relativePath = (file.relativePath || file.path || "").replace(/\\/g, "/");
        if (!relativePath || isExcludedRelativePath(relativePath)) continue;
        entries.push({ relativePath, bytes: Math.max(64, relativePath.length * 32) });
      }
      return entries;
    },

    async readText(workspaceRoot, relativePath) {
      if (isExcludedRelativePath(relativePath) && !relativePath.replace(/\\/g, "/").startsWith(".codee/")) {
        return null;
      }
      try {
        const file = await backendClient.readProjectFile(joinRoot(workspaceRoot, relativePath));
        return file?.content ?? null;
      } catch {
        return null;
      }
    },

    async writeText(workspaceRoot, relativePath, content) {
      const normalized = relativePath.replace(/\\/g, "/");
      if (!normalized.startsWith(".codee/")) {
        throw new Error("repository_review_write_blocked: only .codee/ paths may be written");
      }
      await backendClient.writeProjectFile(joinRoot(workspaceRoot, normalized), content);
    },

    async deleteFile(workspaceRoot, relativePath) {
      const normalized = relativePath.replace(/\\/g, "/");
      if (!normalized.startsWith(".codee/")) {
        throw new Error("repository_review_delete_blocked: only .codee/ paths may be deleted");
      }
      await backendClient.deleteProjectFile(joinRoot(workspaceRoot, normalized));
    },

    async pathExists(workspaceRoot, relativePath) {
      const text = await this.readText(workspaceRoot, relativePath);
      return text != null;
    },

    async getGitState(workspaceRoot) {
      try {
        const status = await window.dbzs?.gitStatus?.(workspaceRoot);
        if (!status || typeof status !== "object") {
          return { dirty: false, changedFiles: [] };
        }
        const data = status as {
          branch?: string;
          currentBranch?: string;
          dirty?: boolean;
          changedFiles?: string[];
          files?: Array<{ path?: string }>;
        };
        const changedFiles =
          data.changedFiles ??
          (Array.isArray(data.files)
            ? data.files.map((f) => f.path).filter((p): p is string => Boolean(p))
            : []);
        return {
          branch: data.branch ?? data.currentBranch,
          dirty: Boolean(data.dirty ?? changedFiles.length > 0),
          changedFiles
        };
      } catch {
        return { dirty: false, changedFiles: [] };
      }
    },

    async runCommand({ cwd, command, timeoutMs }) {
      const started = Date.now();
      const terminalExec = window.dbzs?.terminalExec;
      if (!terminalExec) {
        return {
          exitCode: 127,
          stdout: "",
          stderr: "terminalExec unavailable",
          durationMs: Date.now() - started
        };
      }
      try {
        const request = {
          ...parseStructuredCommandLine(command, cwd),
          timeoutMs
        };
        const result = await Promise.race([
          terminalExec(request),
          new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
            setTimeout(
              () => resolve({ code: 124, stdout: "", stderr: "command_timeout" }),
              timeoutMs
            )
          )
        ]);
        return {
          exitCode: Number(result.code ?? 1),
          stdout: String(result.stdout ?? "").slice(0, 20_000),
          stderr: String(result.stderr ?? "").slice(0, 20_000),
          durationMs: Date.now() - started
        };
      } catch (error) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - started
        };
      }
    }
  };
}

export { isExcludedRelativePath, normalizeRoot, joinRoot };
