import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RestorePointService } from "./restorePointService.js";

describe("RestorePointService", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  function createWorkspace(): string {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "dbzs-restore-points-"));
    tempDirectories.push(workspace);
    return workspace;
  }

  it("creates restore point with metadata index", async () => {
    const workspace = createWorkspace();
    const filePath = path.join(workspace, "src", "main.ts");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "export const value = 1;\n", "utf-8");

    const service = new RestorePointService();
    const point = await service.createRestorePoint(workspace, [filePath], "before_patch", "Before patch apply");

    expect(point.reason).toBe("before_patch");
    expect(point.files).toHaveLength(1);
    expect(point.files[0]?.filePath).toBe("src/main.ts");

    const indexPath = path.join(workspace, ".codee", "restore-points", "index.json");
    const indexRaw = await fs.readFile(indexPath, "utf-8");
    expect(indexRaw).toContain(point.id);
  });

  it("restores an existing file", async () => {
    const workspace = createWorkspace();
    const filePath = path.join(workspace, "README.md");
    await fs.writeFile(filePath, "before\n", "utf-8");

    const service = new RestorePointService();
    const point = await service.createRestorePoint(workspace, [filePath], "before_patch", "Readme checkpoint");

    await fs.writeFile(filePath, "after\n", "utf-8");
    const restored = await service.restorePoint(workspace, point.id);

    expect(restored.success).toBe(true);
    expect(restored.restoredFiles).toContain("README.md");
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("before\n");
  });

  it("deletes files that did not exist at restore-point time", async () => {
    const workspace = createWorkspace();
    const filePath = path.join(workspace, "new-file.txt");

    const service = new RestorePointService();
    const point = await service.createRestorePoint(workspace, [filePath], "before_patch", "Before file create");

    await fs.writeFile(filePath, "temporary\n", "utf-8");
    const restored = await service.restorePoint(workspace, point.id);

    expect(restored.success).toBe(true);
    expect(restored.deletedFiles).toContain("new-file.txt");
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores multiple files in one operation", async () => {
    const workspace = createWorkspace();
    const first = path.join(workspace, "a.txt");
    const second = path.join(workspace, "nested", "b.txt");
    await fs.mkdir(path.dirname(second), { recursive: true });
    await fs.writeFile(first, "A\n", "utf-8");
    await fs.writeFile(second, "B\n", "utf-8");

    const service = new RestorePointService();
    const point = await service.createRestorePoint(workspace, [first, second], "before_bulk_change", "Bulk checkpoint");

    await fs.writeFile(first, "A2\n", "utf-8");
    await fs.writeFile(second, "B2\n", "utf-8");

    const restored = await service.restorePoint(workspace, point.id);
    expect(restored.success).toBe(true);
    expect(restored.restoredFiles).toEqual(expect.arrayContaining(["a.txt", "nested/b.txt"]));
    await expect(fs.readFile(first, "utf-8")).resolves.toBe("A\n");
    await expect(fs.readFile(second, "utf-8")).resolves.toBe("B\n");
  });

  it("blocks paths outside workspace", async () => {
    const workspace = createWorkspace();
    const outsidePath = path.resolve(workspace, "..", "outside.txt");

    const service = new RestorePointService();
    await expect(
      service.createRestorePoint(workspace, [outsidePath], "before_patch", "Blocked")
    ).rejects.toThrow("outside of current workspace");
  });

  it("handles missing file as non-existing snapshot", async () => {
    const workspace = createWorkspace();
    const missingPath = path.join(workspace, "missing", "file.txt");

    const service = new RestorePointService();
    const point = await service.createRestorePoint(workspace, [missingPath], "before_patch", "Missing file checkpoint");

    expect(point.files[0]?.existed).toBe(false);
    expect(point.files[0]?.content).toBe("");
  });

  it("cleans up old restore points", async () => {
    const workspace = createWorkspace();
    const filePath = path.join(workspace, "file.txt");
    await fs.writeFile(filePath, "1\n", "utf-8");

    const service = new RestorePointService({ maxPointsPerWorkspace: 2 });
    const first = await service.createRestorePoint(workspace, [filePath], "manual", "first");
    await fs.writeFile(filePath, "2\n", "utf-8");
    const second = await service.createRestorePoint(workspace, [filePath], "manual", "second");
    await fs.writeFile(filePath, "3\n", "utf-8");
    const third = await service.createRestorePoint(workspace, [filePath], "manual", "third");

    const listed = await service.listRestorePoints(workspace);
    const listedIds = listed.map((point) => point.id);
    expect(listedIds).toContain(second.id);
    expect(listedIds).toContain(third.id);
    expect(listedIds).not.toContain(first.id);
  });

  it("stores git head and branch when git metadata exists", async () => {
    const workspace = createWorkspace();
    const filePath = path.join(workspace, "src", "index.ts");
    const gitDir = path.join(workspace, ".git");
    await fs.mkdir(path.join(gitDir, "refs", "heads"), { recursive: true });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "export {};\n", "utf-8");
    await fs.writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n", "utf-8");
    await fs.writeFile(path.join(gitDir, "refs", "heads", "main"), "abc123def456\n", "utf-8");

    const service = new RestorePointService();
    const point = await service.createRestorePoint(workspace, [filePath], "manual", "Git metadata checkpoint");

    expect(point.gitBranch).toBe("main");
    expect(point.gitHead).toBe("abc123def456");
  });

  describe("rebuildIndexFromDisk", () => {
    it("recovers restore points after index.json is corrupted", async () => {
      const workspace = createWorkspace();
      const filePath = path.join(workspace, "README.md");
      await fs.writeFile(filePath, "before\n", "utf-8");

      const service = new RestorePointService();
      const first = await service.createRestorePoint(workspace, [filePath], "manual", "first");
      const second = await service.createRestorePoint(workspace, [filePath], "manual", "second");

      const indexPath = path.join(workspace, ".codee", "restore-points", "index.json");
      await fs.writeFile(indexPath, "{not valid json", "utf-8");
      expect(await service.listRestorePoints(workspace)).toEqual([]);

      const result = await service.rebuildIndexFromDisk(workspace);

      expect(result.recovered).toBe(2);
      expect(result.corrupted).toEqual([]);
      const recoveredPoints = await service.listRestorePoints(workspace);
      const recoveredIds = recoveredPoints.map((point) => point.id);
      expect(recoveredIds).toContain(first.id);
      expect(recoveredIds).toContain(second.id);
    });

    it("skips corrupted point files and reports them", async () => {
      const workspace = createWorkspace();
      const filePath = path.join(workspace, "README.md");
      await fs.writeFile(filePath, "before\n", "utf-8");

      const service = new RestorePointService();
      const good = await service.createRestorePoint(workspace, [filePath], "manual", "good");

      const storageDir = path.join(workspace, ".codee", "restore-points");
      await fs.writeFile(path.join(storageDir, "broken-point.json"), "{not valid json", "utf-8");

      const result = await service.rebuildIndexFromDisk(workspace);

      expect(result.recovered).toBe(1);
      expect(result.corrupted).toEqual(["broken-point.json"]);
      const recoveredIds = (await service.listRestorePoints(workspace)).map((point) => point.id);
      expect(recoveredIds).toEqual([good.id]);
    });

    it("produces an empty index when no point files exist", async () => {
      const workspace = createWorkspace();
      const service = new RestorePointService();

      const result = await service.rebuildIndexFromDisk(workspace);

      expect(result).toEqual({ recovered: 0, corrupted: [] });
      expect(await service.listRestorePoints(workspace)).toEqual([]);
    });
  });
});
