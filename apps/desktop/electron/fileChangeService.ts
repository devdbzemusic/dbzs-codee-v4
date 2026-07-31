import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RestorePointReason, WorkspaceFile } from "@dbzs/shared";
import { ensurePathInsideWorkspace, toResolvedPath } from "./workspaceService.js";
import type { RestorePointService } from "./restorePointService.js";

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

interface FileSnapshot {
  id: string;
  filePath: string;
  existed: boolean;
  content: string;
  createdAt: string;
}

interface ApplyPatchRestoreOptions {
  reason?: RestorePointReason;
  label?: string;
  relatedRunId?: string;
  relatedChangeIds?: string[];
}

interface FileChangeServiceOptions {
  restorePointService?: RestorePointService;
}

function detectLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".css": "css",
    ".html": "html",
    ".js": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".py": "python",
    ".tsx": "typescript",
    ".ts": "typescript",
    ".toml": "ini",
    ".yaml": "yaml",
    ".yml": "yaml"
  };

  return map[extension] ?? "plaintext";
}

async function readWorkspaceFile(filePath: string): Promise<WorkspaceFile> {
  const content = await fs.readFile(filePath, "utf-8");
  return {
    path: filePath,
    name: path.basename(filePath),
    content,
    language: detectLanguage(filePath)
  };
}

export class FileChangeService {
  private readonly restorePointService?: RestorePointService;

  private readonly snapshotsById = new Map<string, FileSnapshot>();
  private readonly latestSnapshotIdByFile = new Map<string, string>();

  constructor(options: FileChangeServiceOptions = {}) {
    this.restorePointService = options.restorePointService;
  }

  private nextSnapshotId(filePath: string): string {
    return `${Date.now()}-${Buffer.from(filePath).toString("base64url")}`;
  }

  private getSnapshotByFilePath(filePath: string): FileSnapshot | null {
    const resolved = toResolvedPath(filePath);
    const snapshotId = this.latestSnapshotIdByFile.get(resolved);
    if (!snapshotId) {
      return null;
    }
    return this.snapshotsById.get(snapshotId) ?? null;
  }

  private getSnapshotById(snapshotId: string): FileSnapshot {
    const snapshot = this.snapshotsById.get(snapshotId);
    if (!snapshot) {
      throw new Error("No snapshot available for this snapshot id.");
    }
    return snapshot;
  }

  hasSnapshot(filePath: string): boolean {
    return this.getSnapshotByFilePath(filePath) !== null;
  }

  private createTextDiff(before: string, after: string): string {
    if (before === after) {
      return "Keine Änderungen.";
    }

    const beforeLines = before.split(/\r?\n/);
    const afterLines = after.split(/\r?\n/);
    const maxLength = Math.max(beforeLines.length, afterLines.length);
    const output: string[] = ["--- before", "+++ after"];

    for (let index = 0; index < maxLength; index += 1) {
      const left = beforeLines[index];
      const right = afterLines[index];

      if (left === right) {
        if (left !== undefined) {
          output.push(` ${left}`);
        }
        continue;
      }

      if (left !== undefined) {
        output.push(`-${left}`);
      }
      if (right !== undefined) {
        output.push(`+${right}`);
      }
    }

    return output.join("\n");
  }

  async createSnapshot(workspaceRoot: string, filePath: string): Promise<{ snapshotId: string; filePath: string; existed: boolean }> {
    const safePath = ensurePathInsideWorkspace(workspaceRoot, filePath);
    const resolvedPath = toResolvedPath(safePath);
    const snapshotId = this.nextSnapshotId(resolvedPath);

    try {
      const content = await fs.readFile(safePath, "utf-8");
      const snapshot: FileSnapshot = {
        id: snapshotId,
        filePath: resolvedPath,
        existed: true,
        content,
        createdAt: new Date().toISOString()
      };
      this.snapshotsById.set(snapshotId, snapshot);
      this.latestSnapshotIdByFile.set(resolvedPath, snapshotId);
      return { snapshotId, filePath: safePath, existed: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const snapshot: FileSnapshot = {
          id: snapshotId,
          filePath: resolvedPath,
          existed: false,
          content: "",
          createdAt: new Date().toISOString()
        };
        this.snapshotsById.set(snapshotId, snapshot);
        this.latestSnapshotIdByFile.set(resolvedPath, snapshotId);
        return { snapshotId, filePath: safePath, existed: false };
      }
      throw error;
    }
  }

  async createDiff(
    workspaceRoot: string,
    filePath: string,
    proposedContent: string
  ): Promise<{
    snapshotId: string;
    beforeContent: string;
    afterContent: string;
    diff: string;
    beforeHash: string;
    afterHash: string;
  }> {
    const safePath = ensurePathInsideWorkspace(workspaceRoot, filePath);
    const resolved = toResolvedPath(safePath);
    const existingSnapshot = this.getSnapshotByFilePath(resolved);
    const snapshot = existingSnapshot
      ? existingSnapshot
      : await this.createSnapshot(workspaceRoot, resolved).then(({ snapshotId }) => this.getSnapshotById(snapshotId));

    return {
      snapshotId: snapshot.id,
      beforeContent: snapshot.content,
      afterContent: proposedContent,
      diff: this.createTextDiff(snapshot.content, proposedContent),
      beforeHash: sha256Hex(snapshot.content),
      afterHash: sha256Hex(proposedContent)
    };
  }

  async applyChange(
    workspaceRoot: string,
    filePath: string,
    proposedContent: string,
    snapshotId?: string,
    restoreOptions: ApplyPatchRestoreOptions = {}
  ): Promise<{
    snapshotId: string;
    file: WorkspaceFile;
    diff: string;
    restorePointId?: string;
    beforeHash: string;
    afterHash: string;
  }> {
    const safePath = ensurePathInsideWorkspace(workspaceRoot, filePath);
    const resolved = toResolvedPath(safePath);
    const snapshot = snapshotId
      ? this.getSnapshotById(snapshotId)
      : this.getSnapshotByFilePath(resolved);

    if (!snapshot) {
      throw new Error("No snapshot available for this file.");
    }
    if (toResolvedPath(snapshot.filePath) !== resolved) {
      throw new Error("Snapshot does not match the target file.");
    }

    let restorePointId: string | undefined;
    if (this.restorePointService) {
      const restorePoint = await this.restorePointService.createRestorePoint(
        workspaceRoot,
        [safePath],
        restoreOptions.reason ?? "before_patch",
        restoreOptions.label ?? `Before patch apply: ${path.basename(safePath)}`,
        {
          relatedRunId: restoreOptions.relatedRunId,
          relatedChangeIds: restoreOptions.relatedChangeIds
        }
      );
      restorePointId = restorePoint.id;
    }

    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, proposedContent, "utf-8");
    const file = await readWorkspaceFile(safePath);

    // Verify the write landed the intended content — re-read rather than trust
    // fs.writeFile succeeded silently (matches the same check on rollback).
    const afterHash = sha256Hex(proposedContent);
    const actualHash = sha256Hex(await fs.readFile(safePath, "utf-8"));
    if (actualHash !== afterHash) {
      throw new Error(`Patch apply verification failed: on-disk content does not match the intended write for ${safePath}.`);
    }

    return {
      snapshotId: snapshot.id,
      file,
      diff: this.createTextDiff(snapshot.content, proposedContent),
      restorePointId,
      beforeHash: sha256Hex(snapshot.content),
      afterHash
    };
  }

  async restoreSnapshot(workspaceRoot: string, snapshotId: string): Promise<{ restored: boolean; file: WorkspaceFile | null; snapshotId: string }> {
    const snapshot = this.getSnapshotById(snapshotId);
    const safePath = ensurePathInsideWorkspace(workspaceRoot, snapshot.filePath);

    if (!snapshot.existed) {
      await fs.rm(safePath, { force: true });
      return { restored: true, file: null, snapshotId: snapshot.id };
    }

    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, snapshot.content, "utf-8");
    const file = await readWorkspaceFile(safePath);
    return { restored: true, file, snapshotId: snapshot.id };
  }

  async undoPatch(workspaceRoot: string, filePath: string): Promise<{ file: WorkspaceFile | null; hasUndo: boolean }> {
    const safePath = ensurePathInsideWorkspace(workspaceRoot, filePath);
    const snapshot = this.getSnapshotByFilePath(safePath);
    if (!snapshot) {
      return { file: null, hasUndo: false };
    }

    const restored = await this.restoreSnapshot(workspaceRoot, snapshot.id);
    this.snapshotsById.delete(snapshot.id);
    const resolved = toResolvedPath(safePath);
    const latest = this.latestSnapshotIdByFile.get(resolved);
    if (latest === snapshot.id) {
      this.latestSnapshotIdByFile.delete(resolved);
    }
    return {
      file: restored.file,
      hasUndo: false
    };
  }

  async createFileSnapshot(workspaceRoot: string, filePath: string): Promise<{ snapshotId: string; filePath: string; existed: boolean }> {
    return this.createSnapshot(workspaceRoot, filePath);
  }

  async applyPatch(
    workspaceRoot: string,
    filePath: string,
    newContent: string,
    snapshotId?: string,
    restoreOptions: ApplyPatchRestoreOptions = {}
  ): Promise<{
    snapshotId: string;
    file: WorkspaceFile;
    diff: string;
    restorePointId?: string;
    beforeHash: string;
    afterHash: string;
  }> {
    return this.applyChange(workspaceRoot, filePath, newContent, snapshotId, restoreOptions);
  }
}
