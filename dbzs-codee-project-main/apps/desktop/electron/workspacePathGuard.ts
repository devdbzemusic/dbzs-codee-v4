/*
 * DBZS – Division By Zeros
 * Datei: workspacePathGuard.ts
 * Bereich: Desktop / Security
 *
 * Zweck: Kanonische Workspace-Grenze fuer vorhandene und neue Dateipfade.
 * Input: Workspace-Root und Zielpfad.
 * Output: Validierter absoluter Pfad oder stabil codierter Fehler.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

async function statPath(target: string): Promise<import("node:fs").Stats> {
  try {
    return await fs.stat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw error;
    }
    throw new WorkspacePathError("PATH_REVALIDATION_FAILED", "Pfad konnte nicht geprüft werden.");
  }
}

export type WorkspacePathErrorCode =
  | "PATH_OUTSIDE_WORKSPACE"
  | "SYMLINK_ESCAPE"
  | "INVALID_WORKSPACE_ROOT"
  | "PATH_REVALIDATION_FAILED";

export class WorkspacePathError extends Error {
  constructor(public readonly code: WorkspacePathErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "WorkspacePathError";
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function nearestExistingParent(candidate: string): Promise<string> {
  let current = candidate;
  for (;;) {
    try {
      await fs.lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new WorkspacePathError("PATH_REVALIDATION_FAILED", "Kein vorhandener Elternpfad gefunden.");
      }
      current = parent;
    }
  }
}

export async function resolveCanonicalWorkspacePath(
  workspaceRoot: string,
  candidatePath: string,
  options: { allowMissing?: boolean } = {}
): Promise<string> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await fs.realpath(path.resolve(workspaceRoot));
    const rootStats = await statPath(canonicalRoot);
    if (!rootStats.isDirectory()) {
      throw new Error("not a directory");
    }
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      throw error;
    }
    throw new WorkspacePathError("INVALID_WORKSPACE_ROOT", "Workspace existiert nicht oder ist kein Verzeichnis.");
  }

  const absoluteWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedCandidate = path.resolve(candidatePath);
  const relativeCandidate = path.isAbsolute(candidatePath)
    ? resolvedCandidate
    : path.resolve(absoluteWorkspaceRoot, candidatePath);

  if (!isWithin(absoluteWorkspaceRoot, relativeCandidate)) {
    throw new WorkspacePathError("PATH_OUTSIDE_WORKSPACE", "Ziel liegt ausserhalb des Workspace.");
  }

  try {
    const canonicalCandidate = await fs.realpath(relativeCandidate);
    if (!isWithin(canonicalRoot, canonicalCandidate)) {
      throw new WorkspacePathError("SYMLINK_ESCAPE", "Ziel verlaesst den Workspace ueber Symlink oder Junction.");
    }
    return canonicalCandidate;
  } catch (error) {
    if (error instanceof WorkspacePathError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !options.allowMissing) {
      throw new WorkspacePathError("PATH_REVALIDATION_FAILED", "Zielpfad konnte nicht kanonisiert werden.");
    }
  }

  const existingParent = await nearestExistingParent(path.dirname(relativeCandidate));
  const canonicalParent = await fs.realpath(existingParent);
  if (!isWithin(canonicalRoot, canonicalParent)) {
    throw new WorkspacePathError("SYMLINK_ESCAPE", "Elternpfad verlaesst den Workspace ueber Symlink oder Junction.");
  }
  return path.resolve(relativeCandidate);
}
