import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { BackupReason, BackupSummary, RestoreSummary } from "@dbzs/shared";

export type { BackupReason, BackupSummary, RestoreSummary } from "@dbzs/shared";

export interface BackupServiceOptions {
  backupsRoot?: string;
  backendAppDataDir?: string;
  userDataDir?: string;
  maxBackups?: number;
  minIntervalMs?: number;
}

interface ManifestEntry {
  originalPath: string;
  backupRelativePath: string;
}

interface BackupManifest {
  id: string;
  createdAt: string;
  reason: BackupReason;
  workspaceRoot: string | null;
  entries: ManifestEntry[];
}

const DEFAULT_MAX_BACKUPS = 14;
const DEFAULT_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Small state files only. Deliberately excludes rag.sqlite3 (+-wal/-shm): a
 * rebuildable RAG/vector index cache that is routinely hundreds of MB to
 * multiple GB on a real project -- including it would make "automatic"
 * backups impractically slow and large for a personal-use app. Re-index the
 * workspace to rebuild it after a restore. Also excludes *.pre-migration-*.bak
 * files, which are already backups themselves.
 */
const BACKEND_DB_FILENAMES = [
  "settings.json",
  "agents.sqlite3",
  "agents.sqlite3-wal",
  "agents.sqlite3-shm",
  "agent_workbench.db",
  "context_cache.sqlite3",
  "context_cache.json",
  "job_spooler.sqlite3",
  "project_memory.sqlite3",
  "review_gates.db",
  "task_board.sqlite3",
  "trajectory_events.db",
  "write_access.sqlite3"
];

/**
 * Model *weight* files (.gguf etc.) are deliberately excluded -- multi-GB,
 * externally sourced, reproducible. Only the small JSON catalog/runtime
 * profile metadata is backed up.
 */
const MODEL_PROFILE_FILENAMES = ["models.catalog.json", "models.runtime.json"];

const ELECTRON_USER_DATA_FILENAMES = ["workspace-state.json", "settings.json"];

const WORKSPACE_CONFIG_RELATIVE_FILES = [path.join("config", "runtime.json")];

function resolveBackendAppDataDir(): string {
  const configured = process.env.DBZS_APP_DATA_DIR?.trim();
  if (configured) {
    return path.resolve(configured.replace(/\\/g, "/"));
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    return path.join(localAppData, "DBZS", "CodeAssistant");
  }
  return path.join(os.homedir(), ".dbzs", "code-assistant");
}

async function resolveModelsDir(backendAppDataDir: string): Promise<string | null> {
  const configured = process.env.DBZS_MODELS_DIR?.trim();
  if (configured) {
    return path.resolve(configured.replace(/\\/g, "/"));
  }
  try {
    const raw = await fs.readFile(path.join(backendAppDataDir, "settings.json"), "utf-8");
    const settings = JSON.parse(raw) as { modelsPath?: string };
    if (settings.modelsPath) {
      return path.resolve(settings.modelsPath.replace(/\\/g, "/"));
    }
  } catch {
    // best-effort only -- model profile backup is a nice-to-have, not critical state
  }
  return null;
}

async function copyIfExists(sourcePath: string, destPath: string): Promise<boolean> {
  try {
    await fs.access(sourcePath);
  } catch {
    return false;
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.copyFile(sourcePath, destPath);
  return true;
}

async function copyDirectoryExcluding(
  sourceDir: string,
  destDir: string,
  excludedNames: Set<string>
): Promise<string[]> {
  const copied: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch {
    return copied;
  }
  for (const entry of entries) {
    if (excludedNames.has(entry.name.toLowerCase())) continue;
    const srcPath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      copied.push(...(await copyDirectoryExcluding(srcPath, destPath, excludedNames)));
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
      copied.push(srcPath);
    }
  }
  return copied;
}

/**
 * Whole-app-state backup for personal/local use: settings, the Codee
 * databases, active-workspace .codee/ data (minus restore-points, which are
 * their own already-capped rollback mechanism), workspace runtime config, and
 * small model-profile metadata. No generic scheduler -- callers decide when
 * to invoke runBackupIfDue (typically once at app startup).
 */
export class BackupService {
  private readonly maxBackups: number;
  private readonly minIntervalMs: number;
  private readonly backupsRootOverride?: string;
  private readonly backendAppDataDirOverride?: string;
  private readonly userDataDirOverride?: string;

  constructor(options: BackupServiceOptions = {}) {
    this.maxBackups = Math.max(1, options.maxBackups ?? DEFAULT_MAX_BACKUPS);
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
    this.backupsRootOverride = options.backupsRoot;
    this.backendAppDataDirOverride = options.backendAppDataDir;
    this.userDataDirOverride = options.userDataDir;
  }

  private userDataDir(): string {
    return this.userDataDirOverride ?? app.getPath("userData");
  }

  private backupsRoot(): string {
    return this.backupsRootOverride ?? path.join(this.userDataDir(), "backups");
  }

  private backendAppDataDir(): string {
    return this.backendAppDataDirOverride ?? resolveBackendAppDataDir();
  }

  private markerPath(): string {
    return path.join(this.backupsRoot(), ".last-backup.json");
  }

  async isBackupDue(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.markerPath(), "utf-8");
      const marker = JSON.parse(raw) as { lastBackupAt?: string };
      const last = marker.lastBackupAt ? Date.parse(marker.lastBackupAt) : Number.NaN;
      if (Number.isNaN(last)) return true;
      return Date.now() - last >= this.minIntervalMs;
    } catch {
      return true;
    }
  }

  async runBackupIfDue(reason: BackupReason, workspaceRoot?: string | null): Promise<BackupSummary | null> {
    if (reason === "startup" && !(await this.isBackupDue())) {
      return null;
    }
    return this.createBackup(reason, workspaceRoot);
  }

  async createBackup(reason: BackupReason, workspaceRoot?: string | null): Promise<BackupSummary> {
    const id = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(this.backupsRoot(), id);
    await fs.mkdir(backupDir, { recursive: true });

    const entries: ManifestEntry[] = [];

    const backendDir = this.backendAppDataDir();
    for (const name of BACKEND_DB_FILENAMES) {
      const src = path.join(backendDir, name);
      const dest = path.join(backupDir, "backend", name);
      if (await copyIfExists(src, dest)) {
        entries.push({ originalPath: src, backupRelativePath: path.join("backend", name) });
      }
    }

    const modelsDir = await resolveModelsDir(backendDir);
    if (modelsDir) {
      for (const name of MODEL_PROFILE_FILENAMES) {
        const src = path.join(modelsDir, name);
        const dest = path.join(backupDir, "models", name);
        if (await copyIfExists(src, dest)) {
          entries.push({ originalPath: src, backupRelativePath: path.join("models", name) });
        }
      }
    }

    const userDataDir = this.userDataDir();
    for (const name of ELECTRON_USER_DATA_FILENAMES) {
      const src = path.join(userDataDir, name);
      const dest = path.join(backupDir, "userData", name);
      if (await copyIfExists(src, dest)) {
        entries.push({ originalPath: src, backupRelativePath: path.join("userData", name) });
      }
    }

    if (workspaceRoot) {
      const codeeSrc = path.join(workspaceRoot, ".codee");
      const codeeDest = path.join(backupDir, "workspace", ".codee");
      const copiedFiles = await copyDirectoryExcluding(codeeSrc, codeeDest, new Set(["restore-points"]));
      for (const copiedSrc of copiedFiles) {
        const rel = path.relative(codeeSrc, copiedSrc);
        entries.push({ originalPath: copiedSrc, backupRelativePath: path.join("workspace", ".codee", rel) });
      }

      for (const relName of WORKSPACE_CONFIG_RELATIVE_FILES) {
        const src = path.join(workspaceRoot, relName);
        const dest = path.join(backupDir, "workspace", relName);
        if (await copyIfExists(src, dest)) {
          entries.push({ originalPath: src, backupRelativePath: path.join("workspace", relName) });
        }
      }
    }

    const manifest: BackupManifest = {
      id,
      createdAt: new Date().toISOString(),
      reason,
      workspaceRoot: workspaceRoot ?? null,
      entries
    };
    await fs.writeFile(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
    await fs.writeFile(this.markerPath(), JSON.stringify({ lastBackupAt: manifest.createdAt }, null, 2), "utf-8");

    await this.pruneOldBackups();

    return { id, path: backupDir, createdAt: manifest.createdAt, reason, fileCount: entries.length };
  }

  async listBackups(): Promise<BackupSummary[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(this.backupsRoot(), { withFileTypes: true });
    } catch {
      return [];
    }
    const summaries: BackupSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.backupsRoot(), entry.name, "manifest.json");
      try {
        const raw = await fs.readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(raw) as BackupManifest;
        summaries.push({
          id: manifest.id,
          path: path.join(this.backupsRoot(), entry.name),
          createdAt: manifest.createdAt,
          reason: manifest.reason,
          fileCount: manifest.entries.length
        });
      } catch {
        continue;
      }
    }
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async pruneOldBackups(): Promise<{ removed: string[] }> {
    const backups = await this.listBackups();
    if (backups.length <= this.maxBackups) {
      return { removed: [] };
    }
    const toRemove = backups.slice(this.maxBackups);
    const removed: string[] = [];
    for (const backup of toRemove) {
      await fs.rm(backup.path, { recursive: true, force: true });
      removed.push(backup.id);
    }
    return { removed };
  }

  async restoreFromBackup(backupId: string): Promise<RestoreSummary> {
    const backupDir = path.join(this.backupsRoot(), backupId);
    const manifestPath = path.join(backupDir, "manifest.json");
    const raw = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as BackupManifest;

    try {
      // Backup-before-restore: best-effort, must never block the restore the user explicitly asked for.
      await this.createBackup("manual", manifest.workspaceRoot);
    } catch {
      // ignore
    }

    const restoredFiles: string[] = [];
    const errors: string[] = [];
    for (const entry of manifest.entries) {
      try {
        const src = path.join(backupDir, entry.backupRelativePath);
        await fs.mkdir(path.dirname(entry.originalPath), { recursive: true });
        await fs.copyFile(src, entry.originalPath);
        restoredFiles.push(entry.originalPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${entry.originalPath}: ${message}`);
      }
    }

    return { restoredFiles, errors };
  }
}
