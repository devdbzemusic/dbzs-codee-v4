import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCanonicalWorkspacePath } from "./workspacePathGuard.js";

describe("resolveCanonicalWorkspacePath", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  function workspace(): string {
    // Use realpathSync.native so the Windows native API expands 8.3 short-path
    // components (e.g. RUNNER~1 → runneradmin).  The non-native realpathSync
    // does not expand 8.3 names, but resolveCanonicalWorkspacePath uses the
    // async fs.realpath which does; using .native here ensures both sides of
    // every toBe() assertion share the same canonical long-form path.
    const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "dbzs-path-")));
    roots.push(root);
    return root;
  }

  it("accepts an existing child", async () => {
    const root = workspace();
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", "a.ts"), "export {};");
    await expect(resolveCanonicalWorkspacePath(root, path.join(root, "src", "a.ts"))).resolves.toBe(path.join(root, "src", "a.ts"));
  });

  it("rejects lexical traversal", async () => {
    const root = workspace();
    await expect(resolveCanonicalWorkspacePath(root, path.join(root, "..", "escape.txt"), { allowMissing: true })).rejects.toThrow("PATH_OUTSIDE_WORKSPACE");
  });

  it("resolves a relative path against the workspace root", async () => {
    const root = workspace();
    mkdirSync(path.join(root, "src"), { recursive: true });
    const target = path.join(root, "src", "a.ts");
    writeFileSync(target, "export {};");

    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      await expect(resolveCanonicalWorkspacePath(root, "src/a.ts")).resolves.toBe(target);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("rejects symlink escapes to an external directory", async () => {
    const root = workspace();
    const externalDir = workspace();
    const linkedDir = path.join(root, "linked");
    symlinkSync(externalDir, linkedDir, process.platform === "win32" ? "junction" : "dir");

    await expect(resolveCanonicalWorkspacePath(root, path.join(root, "linked", "secret.txt"), { allowMissing: true })).rejects.toThrow("SYMLINK_ESCAPE");
  });

  it("allows missing files under an existing parent", async () => {
    const root = workspace();
    mkdirSync(path.join(root, "src"), { recursive: true });
    await expect(resolveCanonicalWorkspacePath(root, path.join(root, "src", "new-file.ts"), { allowMissing: true })).resolves.toBe(path.join(root, "src", "new-file.ts"));
  });

  it("rejects absolute paths outside the workspace", async () => {
    const root = workspace();
    const externalFile = path.join(os.tmpdir(), "dbzs-outside.txt");
    writeFileSync(externalFile, "x");
    await expect(resolveCanonicalWorkspacePath(root, externalFile, { allowMissing: true })).rejects.toThrow("PATH_OUTSIDE_WORKSPACE");
  });

  it("rejects a workspace root that is not a directory", async () => {
    const root = workspace();
    const filePath = path.join(root, "workspace.txt");
    writeFileSync(filePath, "x");
    await expect(resolveCanonicalWorkspacePath(filePath, ".", { allowMissing: true })).rejects.toThrow("INVALID_WORKSPACE_ROOT");
  });
});
