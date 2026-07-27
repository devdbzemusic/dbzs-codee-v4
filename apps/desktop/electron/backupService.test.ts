import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackupService } from "./backupService.js";

describe("BackupService", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  function createTempDir(prefix: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirectories.push(dir);
    return dir;
  }

  async function setupFixture() {
    const backupsRoot = createTempDir("dbzs-backups-");
    const backendAppDataDir = createTempDir("dbzs-backend-data-");
    const userDataDir = createTempDir("dbzs-user-data-");
    const workspaceRoot = createTempDir("dbzs-workspace-");

    await fs.writeFile(path.join(backendAppDataDir, "settings.json"), JSON.stringify({ theme: "dark" }), "utf-8");
    await fs.writeFile(path.join(backendAppDataDir, "agents.sqlite3"), "sqlite-bytes", "utf-8");
    // Deliberately not backed up: large rebuildable RAG cache.
    await fs.writeFile(path.join(backendAppDataDir, "rag.sqlite3"), "x".repeat(1024), "utf-8");

    await fs.writeFile(path.join(userDataDir, "workspace-state.json"), JSON.stringify({ projectPath: workspaceRoot }), "utf-8");

    const codeeDir = path.join(workspaceRoot, ".codee");
    await fs.mkdir(path.join(codeeDir, "restore-points"), { recursive: true });
    await fs.writeFile(path.join(codeeDir, "restore-points", "index.json"), "[]", "utf-8");
    await fs.writeFile(path.join(codeeDir, "project-memory.json"), "{}", "utf-8");

    await fs.mkdir(path.join(workspaceRoot, "config"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "config", "runtime.json"), "{}", "utf-8");

    const service = new BackupService({ backupsRoot, backendAppDataDir, userDataDir, maxBackups: 2 });
    return { service, backupsRoot, backendAppDataDir, userDataDir, workspaceRoot, codeeDir };
  }

  it("backs up settings, non-RAG databases, and workspace .codee data excluding restore-points", async () => {
    const { service, workspaceRoot } = await setupFixture();

    const summary = await service.createBackup("manual", workspaceRoot);

    const manifestRaw = await fs.readFile(path.join(summary.path, "manifest.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw) as { entries: { originalPath: string }[] };
    const backedUpNames = manifest.entries.map((entry) => path.basename(entry.originalPath));

    expect(backedUpNames).toContain("settings.json");
    expect(backedUpNames).toContain("agents.sqlite3");
    expect(backedUpNames).toContain("project-memory.json");
    expect(backedUpNames).toContain("runtime.json");
    expect(backedUpNames).not.toContain("rag.sqlite3");
    expect(manifest.entries.some((entry) => entry.originalPath.includes("restore-points"))).toBe(false);
  });

  it("is due on first run and not due immediately after a backup", async () => {
    const { service, workspaceRoot } = await setupFixture();

    await expect(service.isBackupDue()).resolves.toBe(true);
    await service.createBackup("startup", workspaceRoot);
    await expect(service.isBackupDue()).resolves.toBe(false);
  });

  it("prunes old backups beyond the configured cap", async () => {
    const { service, workspaceRoot } = await setupFixture();

    await service.createBackup("manual", workspaceRoot);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.createBackup("manual", workspaceRoot);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.createBackup("manual", workspaceRoot);

    const backups = await service.listBackups();
    expect(backups).toHaveLength(2);
  });

  it("restores backed-up files to their original locations", async () => {
    const { service, backendAppDataDir, workspaceRoot, codeeDir } = await setupFixture();

    const summary = await service.createBackup("manual", workspaceRoot);

    await fs.writeFile(path.join(backendAppDataDir, "settings.json"), JSON.stringify({ theme: "light" }), "utf-8");
    await fs.rm(path.join(codeeDir, "project-memory.json"));

    const restoreResult = await service.restoreFromBackup(summary.id);

    expect(restoreResult.errors).toEqual([]);
    const settingsRaw = await fs.readFile(path.join(backendAppDataDir, "settings.json"), "utf-8");
    expect(JSON.parse(settingsRaw)).toEqual({ theme: "dark" });
    await expect(fs.readFile(path.join(codeeDir, "project-memory.json"), "utf-8")).resolves.toBe("{}");
  });
});
