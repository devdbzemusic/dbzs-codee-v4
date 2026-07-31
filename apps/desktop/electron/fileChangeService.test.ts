import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileChangeService } from "./fileChangeService.js";

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

describe("FileChangeService", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  function createTempWorkspace(): string {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "dbzs-file-change-"));
    tempDirectories.push(tempRoot);
    return tempRoot;
  }

  it("creates a diff for changed file content", async () => {
    const workspaceRoot = createTempWorkspace();
    const filePath = path.join(workspaceRoot, "src", "main.ts");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "const value = 1;\n", "utf-8");

    const service = new FileChangeService();
    const snapshot = await service.createSnapshot(workspaceRoot, filePath);

    const diff = await service.createDiff(workspaceRoot, filePath, "const value = 2;\n");
    expect(diff.snapshotId).toBe(snapshot.snapshotId);
    expect(diff.diff).toContain("--- before");
    expect(diff.diff).toContain("+++ after");
    expect(diff.diff).toContain("-const value = 1;");
    expect(diff.diff).toContain("+const value = 2;");
    expect(diff.beforeHash).toBe(sha256Hex("const value = 1;\n"));
    expect(diff.afterHash).toBe(sha256Hex("const value = 2;\n"));
    expect(diff.beforeHash).not.toBe(diff.afterHash);
  });

  it("applies a patch to file content", async () => {
    const workspaceRoot = createTempWorkspace();
    const filePath = path.join(workspaceRoot, "README.md");
    await fs.writeFile(filePath, "before", "utf-8");

    const service = new FileChangeService();
    const snapshot = await service.createSnapshot(workspaceRoot, filePath);

    const result = await service.applyChange(workspaceRoot, filePath, "after", snapshot.snapshotId);
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.file.content).toBe("after");
    expect(result.diff).toContain("-before");
    expect(result.diff).toContain("+after");
    expect(result.beforeHash).toBe(sha256Hex("before"));
    expect(result.afterHash).toBe(sha256Hex("after"));
    expect(result.afterHash).toBe(sha256Hex(await fs.readFile(filePath, "utf-8")));
  });

  it("creates restore point before applying patch", async () => {
    const workspaceRoot = createTempWorkspace();
    const filePath = path.join(workspaceRoot, "SYSTEM.md");
    await fs.writeFile(filePath, "before", "utf-8");

    const createRestorePoint = vi.fn(async () => ({ id: "rp-1" }));
    const service = new FileChangeService({
      restorePointService: { createRestorePoint } as never
    });
    const snapshot = await service.createSnapshot(workspaceRoot, filePath);

    const result = await service.applyChange(workspaceRoot, filePath, "after", snapshot.snapshotId, {
      reason: "before_patch",
      label: "Before patch apply: SYSTEM.md"
    });

    expect(createRestorePoint).toHaveBeenCalledTimes(1);
    expect(result.restorePointId).toBe("rp-1");
  });

  it("restores a file from snapshot", async () => {
    const workspaceRoot = createTempWorkspace();
    const filePath = path.join(workspaceRoot, "notes.txt");
    await fs.writeFile(filePath, "original", "utf-8");

    const service = new FileChangeService();
    const snapshot = await service.createSnapshot(workspaceRoot, filePath);
    await service.applyChange(workspaceRoot, filePath, "changed", snapshot.snapshotId);

    const restored = await service.restoreSnapshot(workspaceRoot, snapshot.snapshotId);
    expect(restored.restored).toBe(true);
    expect(restored.snapshotId).toBe(snapshot.snapshotId);
    expect(restored.file?.content).toBe("original");
  });

  it("blocks patch operations outside workspace", async () => {
    const workspaceRoot = createTempWorkspace();
    const outsidePath = path.resolve(workspaceRoot, "..", "outside.txt");

    const service = new FileChangeService();

    await expect(service.createSnapshot(workspaceRoot, outsidePath)).rejects.toThrow(
      "Path is outside of current workspace."
    );
    await expect(service.createDiff(workspaceRoot, outsidePath, "x")).rejects.toThrow(
      "Path is outside of current workspace."
    );
    await expect(service.applyChange(workspaceRoot, outsidePath, "x")).rejects.toThrow(
      "Path is outside of current workspace."
    );
    await expect(service.restoreSnapshot(workspaceRoot, "unknown-snapshot")).rejects.toThrow(
      "No snapshot available for this snapshot id."
    );
  });
});
