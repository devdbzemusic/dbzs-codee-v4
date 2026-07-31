import { promises as fs } from "node:fs";
import path from "node:path";
import { ensurePathInsideWorkspace, toResolvedPath } from "./workspaceService.js";

export type WorkspaceProtectedPathScope = "file" | "tree";

export interface WorkspaceProtectedPath {
  path: string;
  scope: WorkspaceProtectedPathScope;
  reason?: string;
}

export interface WorkspaceProtectedPathMatch {
  entry: WorkspaceProtectedPath;
  relativePath: string;
}

const CONFIG_RELATIVE_PATH = ".codee/protected-paths.json";

function normalizeProtectedPath(rawPath: string): { path: string; scopeFromSyntax: WorkspaceProtectedPathScope } {
  const trimmed = rawPath.trim().replace(/\\/g, "/");
  const scopeFromSyntax = trimmed.endsWith("/") ? "tree" : "file";
  const normalized = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").includes("..") || path.isAbsolute(normalized)) {
    throw new Error(`[WORKSPACE_PROTECTED_PATH_INVALID] Ungueltiger geschuetzter Pfad: ${rawPath}`);
  }
  return { path: normalized, scopeFromSyntax };
}

function parseConfigPayload(payload: unknown): WorkspaceProtectedPath[] {
  const entries =
    Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { protectedPaths?: unknown }).protectedPaths)
        ? (payload as { protectedPaths: unknown[] }).protectedPaths
        : payload && typeof payload === "object" && Array.isArray((payload as { lockedPaths?: unknown }).lockedPaths)
          ? (payload as { lockedPaths: unknown[] }).lockedPaths
          : [];

  return entries.map((entry) => {
    if (typeof entry === "string") {
      const normalized = normalizeProtectedPath(entry);
      return { path: normalized.path, scope: normalized.scopeFromSyntax };
    }
    if (!entry || typeof entry !== "object") {
      throw new Error("[WORKSPACE_PROTECTED_PATH_INVALID] Eintrag muss String oder Objekt sein.");
    }
    const rawPath = (entry as { path?: unknown }).path;
    if (typeof rawPath !== "string") {
      throw new Error("[WORKSPACE_PROTECTED_PATH_INVALID] Objekt-Eintrag braucht path.");
    }
    const normalized = normalizeProtectedPath(rawPath);
    const rawScope = (entry as { scope?: unknown }).scope;
    const scope =
      rawScope === "file" || rawScope === "tree"
        ? rawScope
        : normalized.scopeFromSyntax;
    const reason = (entry as { reason?: unknown }).reason;
    return {
      path: normalized.path,
      scope,
      reason: typeof reason === "string" ? reason : undefined
    };
  });
}

function matchesProtectedPath(target: string, entry: WorkspaceProtectedPath): boolean {
  if (entry.scope === "file") {
    return target.toLowerCase() === entry.path.toLowerCase();
  }
  const lowerTarget = target.toLowerCase();
  const lowerEntry = entry.path.toLowerCase();
  return lowerTarget === lowerEntry || lowerTarget.startsWith(`${lowerEntry}/`);
}

export class WorkspaceProtectedPathsService {
  async loadProtectedPaths(workspaceRoot: string): Promise<WorkspaceProtectedPath[]> {
    const workspace = toResolvedPath(workspaceRoot);
    const configPath = ensurePathInsideWorkspace(workspace, path.join(workspace, CONFIG_RELATIVE_PATH));
    try {
      const content = await fs.readFile(configPath, "utf-8");
      return parseConfigPayload(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      if (error instanceof SyntaxError) {
        throw new Error(`[WORKSPACE_PROTECTED_PATHS_CONFIG_INVALID] ${CONFIG_RELATIVE_PATH} ist kein gueltiges JSON.`);
      }
      throw error;
    }
  }

  async findProtectedPathMatch(
    workspaceRoot: string,
    relativePath: string
  ): Promise<WorkspaceProtectedPathMatch | null> {
    const normalized = normalizeProtectedPath(relativePath).path;
    const entries = await this.loadProtectedPaths(workspaceRoot);
    const entry = entries.find((candidate) => matchesProtectedPath(normalized, candidate));
    return entry ? { entry, relativePath: normalized } : null;
  }

  async assertPatchAllowed(workspaceRoot: string, relativePath: string): Promise<void> {
    const match = await this.findProtectedPathMatch(workspaceRoot, relativePath);
    if (!match) {
      return;
    }
    const reason = match.entry.reason ? ` Grund: ${match.entry.reason}` : "";
    throw new Error(`[PATCH_WORKSPACE_PATH_LOCKED] Geschuetzter Workspace-Pfad blockiert: ${match.relativePath}.${reason}`);
  }
}
