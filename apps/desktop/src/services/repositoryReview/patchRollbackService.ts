import type { RestorePoint, RestoreResult } from "@dbzs/shared";
import { readJson, writeFileAtomic } from "@/services/io/atomicFileIo";
import type { ReviewWorkspaceIO } from "../repositoryReview/types";
import { joinRoot } from "../repositoryReview";

export interface PatchRollbackServiceOptions {
  io: ReviewWorkspaceIO;
}

async function loadRestorePoint(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  restorePointId: string
): Promise<RestorePoint | null> {
  const path = `.codee/restore-points/restore-point-${restorePointId}.json`;
  if (!(await io.pathExists(workspaceRoot, path))) {
    return null;
  }
  // Using backend/electron fs for reading from workspace, not Node fs directly
  const content = await io.readText(workspaceRoot, path);
  if (!content) return null;
  try {
    return JSON.parse(content) as RestorePoint;
  } catch {
    return null;
  }
}

/**
 * Rolls back file changes using a restore point.
 */
export async function rollbackPatch(
  restorePointId: string,
  options: PatchRollbackServiceOptions
): Promise<RestoreResult> {
  const restorePoint = await loadRestorePoint(
    options.io,
    "", // workspaceRoot is implicitly handled by io
    restorePointId
  );

  if (!restorePoint) {
    return {
      success: false,
      restoredFiles: [],
      deletedFiles: [],
      errors: [`Restore point ${restorePointId} not found.`]
    };
  }

  const restoredFiles: string[] = [];
  const deletedFiles: string[] = [];
  const errors: string[] = [];

  for (const file of restorePoint.files) {
    try {
      if (file.existed) {
        await options.io.writeText(restorePoint.workspaceRoot, file.filePath, file.content);
        restoredFiles.push(file.filePath);
      } else if (options.io.deleteFile) {
        await options.io.deleteFile(restorePoint.workspaceRoot, file.filePath);
        deletedFiles.push(file.filePath);
      }
    } catch (error) {
      errors.push(`Failed to restore ${file.filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { success: errors.length === 0, restoredFiles, deletedFiles, errors };
}
