import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileChangeService } from "./fileChangeService.js";
import { PatchPipelineService } from "./patchPipelineService.js";

describe("PatchPipelineService", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  function createTempWorkspace(): string {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "dbzs-patch-pipeline-"));
    tempDirectories.push(tempRoot);
    return tempRoot;
  }

  it("creates preview diff before apply", async () => {
    const workspaceRoot = createTempWorkspace();
    const filePath = path.join(workspaceRoot, "main.ts");
    await fs.writeFile(filePath, "before\n", "utf-8");

    const pipeline = new PatchPipelineService({
      fileChangeService: new FileChangeService(),
      restorePointService: { restorePoint: vi.fn() } as never
    });

    const preview = await pipeline.createPatchPreview(workspaceRoot, filePath, "after\n");
    expect(preview.diff).toContain("-before");
    expect(preview.diff).toContain("+after");
  });

  it("applies patch with restore point and supports rollback hook", async () => {
    const workspaceRoot = createTempWorkspace();
    const filePath = path.join(workspaceRoot, "main.ts");
    await fs.writeFile(filePath, "before\n", "utf-8");

    const restorePoint = vi.fn(async () => ({ restoredFiles: [filePath], restorePointId: "rp-1" }));
    const createRestorePoint = vi.fn(async () => ({ id: "rp-1" }));
    const fileChangeService = new FileChangeService({
      restorePointService: { createRestorePoint } as never
    });
    const pipeline = new PatchPipelineService({
      fileChangeService,
      restorePointService: { restorePoint } as never
    });

    const applied = await pipeline.applyPatchWithRestorePoint(workspaceRoot, filePath, "after\n");
    expect(applied.file.content).toBe("after\n");
    expect(applied.restorePointId).toBe("rp-1");

    await pipeline.rollbackPatch(workspaceRoot, "rp-1");
    expect(restorePoint).toHaveBeenCalledWith(workspaceRoot, "rp-1");
  });

  it("blocks patch plans that exceed safety limits or lack review approval", async () => {
    const pipeline = new PatchPipelineService({
      fileChangeService: new FileChangeService(),
      restorePointService: { restorePoint: vi.fn() } as never,
      defaultLimits: {
        maxFilesChanged: 1,
        maxPatchSize: 20,
        requireReviewGate: true,
        allowCommit: false
      }
    });

    expect(() =>
      pipeline.validatePatchPlan(
        [
          { filePath: "a.ts", proposedContent: "export const a = 1;\n" },
          { filePath: "b.ts", proposedContent: "export const b = 2;\n" }
        ],
        { reviewGateApproved: true }
      )
    ).toThrow("maxFilesChanged");

    expect(() =>
      pipeline.validatePatchPlan([{ filePath: "a.ts", proposedContent: "x".repeat(50) }], {
        reviewGateApproved: true
      })
    ).toThrow("maxPatchSize");

    expect(() =>
      pipeline.validatePatchPlan([{ filePath: "a.ts", proposedContent: "ok" }], {
        reviewGateApproved: false
      })
    ).toThrow("review gate approval");

    expect(() =>
      pipeline.validatePatchPlan([{ filePath: "a.ts", proposedContent: "ok" }], {
        reviewGateApproved: true,
        allowCommit: true
      })
    ).toThrow("commit is not allowed");
  });
});
