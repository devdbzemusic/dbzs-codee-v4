import { constants as fsConstants } from "node:fs";
import { access, mkdir, stat, statfs } from "node:fs/promises";

export const MIN_FREE_SPACE_BYTES = 500 * 1024 * 1024;

export interface FilesystemCheckModelRoot {
  path: string;
  exists: boolean;
  readable: boolean;
}

export interface FilesystemCheckResult {
  userDataWritable: boolean;
  logDirWritable: boolean;
  databaseDirWritable: boolean;
  modelRoots: FilesystemCheckModelRoot[];
  backendLaunchAvailable: boolean;
  runtimeExecutableAvailable: boolean;
  freeSpaceBytes: number;
}

export interface FilesystemCheckInput {
  userDataDir: string;
  logDir: string;
  tempDir: string;
  databaseDir: string;
  /** Configured local-model directories (optional -- missing ones are warnings, not failures). */
  modelRoots: string[];
  /** Resolves synchronously/quickly -- reuses backendStartupService's own launch-resolution logic. */
  isBackendLaunchAvailable: () => boolean;
  /**
   * Candidate paths for the llama.cpp/runtime executable. Best-effort only:
   * the runtime location is fundamentally backend/user-configuration
   * dependent, so an empty list means "not checkable from here" (treated as
   * available) rather than a false failure -- the authoritative gate is the
   * backend's own runtime-manager-init phase.
   */
  runtimeExecutableCandidates: string[];
}

async function ensureWritableDir(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkModelRoot(root: string): Promise<FilesystemCheckModelRoot> {
  try {
    await stat(root);
    try {
      await access(root, fsConstants.R_OK);
      return { path: root, exists: true, readable: true };
    } catch {
      return { path: root, exists: true, readable: false };
    }
  } catch {
    return { path: root, exists: false, readable: false };
  }
}

export async function runFilesystemCheck(input: FilesystemCheckInput): Promise<FilesystemCheckResult> {
  const [userDataWritable, logDirWritable, databaseDirWritable] = await Promise.all([
    ensureWritableDir(input.userDataDir),
    ensureWritableDir(input.logDir),
    ensureWritableDir(input.databaseDir)
  ]);
  // tempDir is checked (created if missing) but has no dedicated result
  // field -- a missing/unwritable OS temp dir is an environment problem
  // well beyond this app's remit, not something to gate boot on.
  await ensureWritableDir(input.tempDir);

  const modelRoots = await Promise.all(input.modelRoots.map(checkModelRoot));

  const backendLaunchAvailable = input.isBackendLaunchAvailable();

  let runtimeExecutableAvailable = input.runtimeExecutableCandidates.length === 0;
  for (const candidate of input.runtimeExecutableCandidates) {
    try {
      await stat(candidate);
      runtimeExecutableAvailable = true;
      break;
    } catch {
      // try next candidate
    }
  }

  let freeSpaceBytes = Number.POSITIVE_INFINITY;
  try {
    const stats = await statfs(input.userDataDir);
    freeSpaceBytes = stats.bavail * stats.bsize;
  } catch {
    // statfs unsupported or failed (older Node/OS quirk) -- do not turn an
    // unrelated platform-API gap into a false "disk full" failure.
    freeSpaceBytes = Number.POSITIVE_INFINITY;
  }

  return {
    userDataWritable,
    logDirWritable,
    databaseDirWritable,
    modelRoots,
    backendLaunchAvailable,
    runtimeExecutableAvailable,
    freeSpaceBytes
  };
}
