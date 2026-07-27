import { constants as fsConstants, existsSync, readdirSync, readFileSync } from "node:fs";
import { access, mkdir, stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

export interface FilesystemCheckResolvedTargets {
  modelRoots: string[];
  runtimeExecutableCandidates: string[];
}

const DEFAULT_MODELS_DIR = "D:/Models";
const DEFAULT_WIN_RUNTIMES_DIR = "D:/win_runtimes";

function normalizeMaybePath(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  return path.normalize(trimmed);
}

function uniquePaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const value of values) {
    const normalized = normalizeMaybePath(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(normalized);
  }
  return resolved;
}

function readBootSettings(userDataDir: string): Record<string, unknown> {
  try {
    const settingsPath = path.join(userDataDir, "settings.json");
    if (!existsSync(settingsPath)) {
      return {};
    }
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function resolveOllamaModelsDir(env: NodeJS.ProcessEnv): string {
  const configured = normalizeMaybePath(env.DBZS_OLLAMA_MODELS_DIR) ?? normalizeMaybePath(env.OLLAMA_MODELS);
  if (configured) {
    return configured;
  }

  const colocated = path.join("G:", "Ollama", "models");
  if (existsSync(colocated)) {
    return colocated;
  }

  return path.join(os.homedir(), ".ollama", "models");
}

function discoverRuntimeExecutableCandidates(runtimeRoot: string, platform: NodeJS.Platform): string[] {
  const executableNames = platform === "win32"
    ? ["llama-server.exe", "llama-cli.exe"]
    : ["llama-server", "llama-cli"];

  const fallbackCandidates = executableNames.flatMap((name) => [
    path.join(runtimeRoot, name),
    path.join(runtimeRoot, "llama", name),
    path.join(runtimeRoot, "bin", name)
  ]);

  if (!existsSync(runtimeRoot)) {
    return uniquePaths(fallbackCandidates);
  }

  const discovered: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: runtimeRoot, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    try {
      for (const entry of readdirSync(current.dir, { withFileTypes: true })) {
        const fullPath = path.join(current.dir, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < 4) {
            queue.push({ dir: fullPath, depth: current.depth + 1 });
          }
          continue;
        }
        if (entry.isFile() && executableNames.includes(entry.name)) {
          discovered.push(fullPath);
        }
      }
    } catch {
      // unreadable directories are ignored here; the actual boot phase will
      // still report the root as unavailable via the model/root checks.
    }
  }

  return uniquePaths([...discovered, ...fallbackCandidates]);
}

export function resolveFilesystemCheckTargets(input: {
  userDataDir: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): FilesystemCheckResolvedTargets {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const settings = readBootSettings(input.userDataDir);

  const configuredModelsPath =
    normalizeMaybePath(env.DBZS_MODELS_DIR) ??
    normalizeMaybePath(typeof settings.modelsPath === "string" ? settings.modelsPath : null) ??
    DEFAULT_MODELS_DIR;
  const runtimeRoot = normalizeMaybePath(env.DBZS_WIN_RUNTIMES_DIR) ?? DEFAULT_WIN_RUNTIMES_DIR;

  return {
    modelRoots: uniquePaths([
      configuredModelsPath,
      resolveOllamaModelsDir(env)
    ]),
    runtimeExecutableCandidates: discoverRuntimeExecutableCandidates(runtimeRoot, platform)
  };
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
