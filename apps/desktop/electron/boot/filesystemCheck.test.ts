import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_FREE_SPACE_BYTES, runFilesystemCheck, type FilesystemCheckInput } from "./filesystemCheck.js";

function baseInput(root: string, overrides: Partial<FilesystemCheckInput> = {}): FilesystemCheckInput {
  return {
    userDataDir: path.join(root, "userData"),
    logDir: path.join(root, "userData", "logs"),
    tempDir: path.join(root, "temp"),
    databaseDir: path.join(root, "userData"),
    modelRoots: [],
    isBackendLaunchAvailable: () => true,
    runtimeExecutableCandidates: [],
    ...overrides
  };
}

describe("runFilesystemCheck", () => {
  it("reports writable dirs, available backend launch, and no model roots as fully healthy", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-fs-check-"));
    const result = await runFilesystemCheck(baseInput(root));

    expect(result.userDataWritable).toBe(true);
    expect(result.logDirWritable).toBe(true);
    expect(result.databaseDirWritable).toBe(true);
    expect(result.backendLaunchAvailable).toBe(true);
    expect(result.runtimeExecutableAvailable).toBe(true); // no candidates configured -> not checkable, treated as available
    expect(result.modelRoots).toEqual([]);
    expect(result.freeSpaceBytes).toBeGreaterThan(0);
  });

  it("creates userData/log/temp/database directories that don't exist yet", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-fs-check-"));
    const input = baseInput(root);
    const result = await runFilesystemCheck(input);

    expect(result.userDataWritable).toBe(true);
    expect(result.logDirWritable).toBe(true);
  });

  it("reports an existing, readable model root", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-fs-check-"));
    const modelsDir = path.join(root, "models");
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(path.join(modelsDir, "model.gguf"), "");

    const result = await runFilesystemCheck(baseInput(root, { modelRoots: [modelsDir] }));

    expect(result.modelRoots).toEqual([{ path: modelsDir, exists: true, readable: true }]);
  });

  it("reports a missing model root as not existing (never throws)", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-fs-check-"));
    const missingDir = path.join(root, "does-not-exist");

    const result = await runFilesystemCheck(baseInput(root, { modelRoots: [missingDir] }));

    expect(result.modelRoots).toEqual([{ path: missingDir, exists: false, readable: false }]);
  });

  it("reports backendLaunchAvailable:false when the injected check says so", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-fs-check-"));
    const result = await runFilesystemCheck(baseInput(root, { isBackendLaunchAvailable: () => false }));

    expect(result.backendLaunchAvailable).toBe(false);
  });

  it("finds a runtime executable candidate that exists and stops at the first match", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-fs-check-"));
    const runtimeDir = path.join(root, "runtime");
    mkdirSync(runtimeDir, { recursive: true });
    const realExe = path.join(runtimeDir, "llama-server.exe");
    writeFileSync(realExe, "");

    const result = await runFilesystemCheck(
      baseInput(root, { runtimeExecutableCandidates: [path.join(root, "nope.exe"), realExe] })
    );

    expect(result.runtimeExecutableAvailable).toBe(true);
  });

  it("reports runtimeExecutableAvailable:false when candidates are configured but none exist", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-fs-check-"));

    const result = await runFilesystemCheck(
      baseInput(root, { runtimeExecutableCandidates: [path.join(root, "nope-a.exe"), path.join(root, "nope-b.exe")] })
    );

    expect(result.runtimeExecutableAvailable).toBe(false);
  });

  it("exposes MIN_FREE_SPACE_BYTES as 500 MB", () => {
    expect(MIN_FREE_SPACE_BYTES).toBe(500 * 1024 * 1024);
  });
});
