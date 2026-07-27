import { promises as fs } from "node:fs";
import path from "node:path";
import type { RestorePoint, RestorePointReason, RestoreResult } from "@dbzs/shared";
import { ensurePathInsideWorkspace, toResolvedPath } from "./workspaceService.js";

interface RestorePointServiceOptions {
  maxPointsPerWorkspace?: number;
}

interface RestorePointIndexEntry {
  id: string;
  reason: RestorePointReason;
  label: string;
  createdAt: string;
  fileCount: number;
  gitHead?: string;
  gitBranch?: string;
  relatedRunId?: string;
  relatedChangeIds?: string[];
}

interface CreateRestorePointOptions {
  relatedRunId?: string;
  relatedChangeIds?: string[];
}

const DEFAULT_MAX_POINTS = 60;

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toRestorePointId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `rp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+$/g, "");
}

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function findGitDir(workspaceRoot: string): Promise<string | null> {
  const dotGitPath = path.join(workspaceRoot, ".git");

  try {
    const stats = await fs.stat(dotGitPath);
    if (stats.isDirectory()) {
      return dotGitPath;
    }

    if (!stats.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const gitFile = await fs.readFile(dotGitPath, "utf-8");
  const match = gitFile.match(/^gitdir:\s*(.+)$/im);
  if (!match?.[1]) {
    return null;
  }

  return path.resolve(workspaceRoot, match[1].trim());
}

async function readRefHash(gitDir: string, refPath: string): Promise<string | undefined> {
  const looseRefPath = path.join(gitDir, refPath);
  try {
    const value = (await fs.readFile(looseRefPath, "utf-8")).trim();
    return value.length > 0 ? value : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const packedRefsPath = path.join(gitDir, "packed-refs");
  const packedRefs = await tryReadFile(packedRefsPath);
  if (!packedRefs) {
    return undefined;
  }

  const lines = packedRefs.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("^")) {
      continue;
    }

    const [hash, ref] = line.split(/\s+/);
    if (ref === refPath && hash) {
      return hash;
    }
  }

  return undefined;
}

async function readGitMetadata(workspaceRoot: string): Promise<{ gitHead?: string; gitBranch?: string }> {
  const gitDir = await findGitDir(workspaceRoot);
  if (!gitDir) {
    return {};
  }

  const headPath = path.join(gitDir, "HEAD");
  const headValue = await tryReadFile(headPath);
  if (!headValue) {
    return {};
  }

  const trimmedHead = headValue.trim();
  if (trimmedHead.startsWith("ref:")) {
    const refPath = trimmedHead.slice(4).trim();
    const gitHead = await readRefHash(gitDir, refPath);
    const gitBranch = refPath.startsWith("refs/heads/") ? refPath.slice("refs/heads/".length) : refPath;
    return {
      gitHead,
      gitBranch
    };
  }

  return {
    gitHead: trimmedHead,
    gitBranch: "detached"
  };
}

export class RestorePointService {
  private readonly maxPointsPerWorkspace: number;

  constructor(options: RestorePointServiceOptions = {}) {
    this.maxPointsPerWorkspace = Math.max(1, options.maxPointsPerWorkspace ?? DEFAULT_MAX_POINTS);
  }

  private resolveWorkspace(workspaceRoot: string): string {
    return toResolvedPath(workspaceRoot);
  }

  private resolveStorageDir(workspaceRoot: string): string {
    return path.join(this.resolveWorkspace(workspaceRoot), ".codee", "restore-points");
  }

  private resolveIndexPath(workspaceRoot: string): string {
    return path.join(this.resolveStorageDir(workspaceRoot), "index.json");
  }

  private resolvePointPath(workspaceRoot: string, restorePointId: string): string {
    return path.join(this.resolveStorageDir(workspaceRoot), `${restorePointId}.json`);
  }

  private async ensureStorage(workspaceRoot: string): Promise<void> {
    const storageDir = this.resolveStorageDir(workspaceRoot);
    await fs.mkdir(storageDir, { recursive: true });

    const indexPath = this.resolveIndexPath(workspaceRoot);
    const existingIndex = await tryReadFile(indexPath);
    if (existingIndex === null) {
      await fs.writeFile(indexPath, "[]\n", "utf-8");
    }
  }

  private async readIndex(workspaceRoot: string): Promise<RestorePointIndexEntry[]> {
    const indexPath = this.resolveIndexPath(workspaceRoot);
    const rawIndex = await tryReadFile(indexPath);
    if (!rawIndex) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawIndex) as RestorePointIndexEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeIndex(workspaceRoot: string, entries: RestorePointIndexEntry[]): Promise<void> {
    const indexPath = this.resolveIndexPath(workspaceRoot);
    await fs.writeFile(indexPath, `${JSON.stringify(entries, null, 2)}\n`, "utf-8");
  }

  private toIndexEntry(point: RestorePoint): RestorePointIndexEntry {
    return {
      id: point.id,
      reason: point.reason,
      label: point.label,
      createdAt: point.createdAt,
      fileCount: point.files.length,
      gitHead: point.gitHead,
      gitBranch: point.gitBranch,
      relatedRunId: point.relatedRunId,
      relatedChangeIds: point.relatedChangeIds
    };
  }

  async createRestorePoint(
    workspaceRoot: string,
    filePaths: string[],
    reason: RestorePointReason,
    label: string,
    options: CreateRestorePointOptions = {}
  ): Promise<RestorePoint> {
    const safeWorkspace = this.resolveWorkspace(workspaceRoot);
    await this.ensureStorage(safeWorkspace);

    const normalizedFilePaths = unique(filePaths);
    if (normalizedFilePaths.length === 0) {
      throw new Error("[RESTORE_POINT_INVALID] Keine Dateipfade fuer Restore Point angegeben.");
    }

    const files: RestorePoint["files"] = [];
    for (const filePath of normalizedFilePaths) {
      const absoluteCandidate = path.isAbsolute(filePath) ? filePath : path.join(safeWorkspace, filePath);
      const safeFile = ensurePathInsideWorkspace(safeWorkspace, absoluteCandidate);
      const content = await tryReadFile(safeFile);
      files.push({
        filePath: toPosixPath(path.relative(safeWorkspace, safeFile)),
        content: content ?? "",
        existed: content !== null
      });
    }

    const gitMetadata = await readGitMetadata(safeWorkspace);
    const restorePoint: RestorePoint = {
      id: toRestorePointId(),
      workspaceRoot: safeWorkspace,
      reason,
      label: label.trim() || `Restore Point (${reason})`,
      files,
      gitHead: gitMetadata.gitHead,
      gitBranch: gitMetadata.gitBranch,
      relatedRunId: options.relatedRunId,
      relatedChangeIds: options.relatedChangeIds,
      createdAt: new Date().toISOString()
    };

    const pointPath = this.resolvePointPath(safeWorkspace, restorePoint.id);
    await fs.writeFile(pointPath, `${JSON.stringify(restorePoint, null, 2)}\n`, "utf-8");

    const index = await this.readIndex(safeWorkspace);
    await this.writeIndex(safeWorkspace, [this.toIndexEntry(restorePoint), ...index]);
    await this.cleanupOldRestorePoints(safeWorkspace);

    return restorePoint;
  }

  async listRestorePoints(workspaceRoot: string): Promise<RestorePoint[]> {
    const safeWorkspace = this.resolveWorkspace(workspaceRoot);
    await this.ensureStorage(safeWorkspace);

    const indexEntries = await this.readIndex(safeWorkspace);
    const points: RestorePoint[] = [];
    const survivingIndex: RestorePointIndexEntry[] = [];

    for (const entry of indexEntries) {
      const pointPath = this.resolvePointPath(safeWorkspace, entry.id);
      const rawPoint = await tryReadFile(pointPath);
      if (!rawPoint) {
        continue;
      }

      try {
        const parsed = JSON.parse(rawPoint) as RestorePoint;
        points.push(parsed);
        survivingIndex.push(entry);
      } catch {
        // Ignore malformed entries and compact index below.
      }
    }

    if (survivingIndex.length !== indexEntries.length) {
      await this.writeIndex(safeWorkspace, survivingIndex);
    }

    return points.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async restorePoint(workspaceRoot: string, restorePointId: string): Promise<RestoreResult> {
    const safeWorkspace = this.resolveWorkspace(workspaceRoot);
    await this.ensureStorage(safeWorkspace);

    const pointPath = this.resolvePointPath(safeWorkspace, restorePointId);
    const rawPoint = await tryReadFile(pointPath);
    if (!rawPoint) {
      throw new Error("[RESTORE_POINT_NOT_FOUND] Restore Point existiert nicht.");
    }

    const point = JSON.parse(rawPoint) as RestorePoint;
    const restoredFiles: string[] = [];
    const deletedFiles: string[] = [];
    const errors: string[] = [];

    for (const file of point.files) {
      try {
        const absoluteCandidate = path.isAbsolute(file.filePath)
          ? file.filePath
          : path.join(safeWorkspace, file.filePath);
        const safeFile = ensurePathInsideWorkspace(safeWorkspace, absoluteCandidate);

        if (file.existed) {
          await fs.mkdir(path.dirname(safeFile), { recursive: true });
          await fs.writeFile(safeFile, file.content, "utf-8");
          restoredFiles.push(toPosixPath(path.relative(safeWorkspace, safeFile)));
          continue;
        }

        await fs.rm(safeFile, { force: true });
        deletedFiles.push(toPosixPath(path.relative(safeWorkspace, safeFile)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${file.filePath}: ${message}`);
      }
    }

    return {
      success: errors.length === 0,
      restoredFiles,
      deletedFiles,
      errors
    };
  }

  async deleteRestorePoint(workspaceRoot: string, restorePointId: string): Promise<{ deleted: boolean }> {
    const safeWorkspace = this.resolveWorkspace(workspaceRoot);
    await this.ensureStorage(safeWorkspace);

    const pointPath = this.resolvePointPath(safeWorkspace, restorePointId);
    await fs.rm(pointPath, { force: true });

    const index = await this.readIndex(safeWorkspace);
    const nextIndex = index.filter((entry) => entry.id !== restorePointId);
    await this.writeIndex(safeWorkspace, nextIndex);

    return {
      deleted: nextIndex.length !== index.length
    };
  }

  async cleanupOldRestorePoints(workspaceRoot: string): Promise<{ removed: string[] }> {
    const safeWorkspace = this.resolveWorkspace(workspaceRoot);
    await this.ensureStorage(safeWorkspace);

    const index = await this.readIndex(safeWorkspace);
    if (index.length <= this.maxPointsPerWorkspace) {
      return { removed: [] };
    }

    const kept = index.slice(0, this.maxPointsPerWorkspace);
    const removedEntries = index.slice(this.maxPointsPerWorkspace);
    const removed: string[] = [];

    for (const entry of removedEntries) {
      const pointPath = this.resolvePointPath(safeWorkspace, entry.id);
      await fs.rm(pointPath, { force: true });
      removed.push(entry.id);
    }

    await this.writeIndex(safeWorkspace, kept);
    return { removed };
  }
}
