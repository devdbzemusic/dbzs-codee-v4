import fs from "node:fs/promises";
import path from "node:path";
import { isExcludedRelativePath, normalizeRoot } from "./reviewPathUtils";
import type { ReviewWorkspaceFileEntry, ReviewWorkspaceIO } from "./types";

async function walk(
  root: string,
  dir: string,
  out: ReviewWorkspaceFileEntry[],
  depth: number
): Promise<void> {
  if (depth > 8 || out.length > 4000) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replace(/\\/g, "/");
    if (isExcludedRelativePath(rel)) continue;
    if (entry.isDirectory()) {
      await walk(root, abs, out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const st = await fs.stat(abs);
      out.push({ relativePath: rel, bytes: st.size });
    } catch {
      // skip
    }
  }
}

/** Node fs-backed IO for offline repro / CLI (writes only under .codee/). */
export function createNodeReviewWorkspaceIO(): ReviewWorkspaceIO {
  return {
    async listFiles(workspaceRoot) {
      const root = normalizeRoot(workspaceRoot);
      const out: ReviewWorkspaceFileEntry[] = [];
      await walk(root, root, out, 0);
      return out;
    },
    async readText(workspaceRoot, relativePath) {
      try {
        const abs = path.join(normalizeRoot(workspaceRoot), relativePath);
        return await fs.readFile(abs, "utf8");
      } catch {
        return null;
      }
    },
    async writeText(workspaceRoot, relativePath, content) {
      const normalized = relativePath.replace(/\\/g, "/");
      if (!normalized.startsWith(".codee/")) {
        throw new Error("repository_review_write_blocked: only .codee/ paths may be written");
      }
      const abs = path.join(normalizeRoot(workspaceRoot), normalized);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
    },
    async pathExists(workspaceRoot, relativePath) {
      try {
        await fs.access(path.join(normalizeRoot(workspaceRoot), relativePath));
        return true;
      } catch {
        return false;
      }
    },
    async getGitState(workspaceRoot) {
      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        const cwd = normalizeRoot(workspaceRoot);
        const branch = (
          await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd })
        ).stdout.trim();
        const status = (await execFileAsync("git", ["status", "--porcelain"], { cwd })).stdout;
        const changedFiles = status
          .split(/\r?\n/)
          .map((line) => line.slice(3).trim())
          .filter(Boolean);
        return { branch, dirty: changedFiles.length > 0, changedFiles };
      } catch {
        return { dirty: false, changedFiles: [] };
      }
    }
  };
}
