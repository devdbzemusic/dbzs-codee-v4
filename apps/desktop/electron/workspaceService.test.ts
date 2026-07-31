import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createProjectWorkflow,
  ensurePathInsideWorkspace,
  loadWorkspaceState,
  normalizeContextPathsForActiveWorkspace,
  scanProjectFiles
} from "./workspaceService.js";

function relativePaths(files: Array<{ relativePath: string }>): string[] {
  return files.map((file) => file.relativePath).sort();
}

describe("workspaceService", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  function createTempWorkspace(): string {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "dbzs-workspace-"));
    tempDirectories.push(tempRoot);
    return tempRoot;
  }

  it("blocks file paths outside workspace", () => {
    const root = "D:/workspace/project";
    expect(() => ensurePathInsideWorkspace(root, "D:/workspace/project/src/index.ts")).not.toThrow();
    expect(() => ensurePathInsideWorkspace(root, "D:/workspace/other/file.ts")).toThrow(
      "Path is outside of current workspace."
    );
  });

  it("allows relative paths and dotdot-prefixed names inside the workspace", async () => {
    const tempRoot = createTempWorkspace();
    const filePath = path.join(tempRoot, "src", "index.ts");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "export {};", "utf-8");

    expect(() => ensurePathInsideWorkspace(tempRoot, "src/index.ts")).not.toThrow();
    expect(() => ensurePathInsideWorkspace(tempRoot, "..foo/file.ts")).not.toThrow();
    expect(() => ensurePathInsideWorkspace(tempRoot, "../escape.txt")).toThrow("Path is outside of current workspace.");
  });

  it("blocks a missing target below an escaping symlink parent", async () => {
    const tempRoot = createTempWorkspace();
    const outside = createTempWorkspace();
    const link = path.join(tempRoot, "outside-link");
    await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => ensurePathInsideWorkspace(tempRoot, "outside-link/missing.txt")).toThrow(
      "Path is outside of current workspace."
    );
  });

  it("normalizes context paths only for the active workspace root", async () => {
    const tempRoot = createTempWorkspace();
    const otherRoot = createTempWorkspace();
    await fs.mkdir(path.join(tempRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "src", "main.ts"), "export {};", "utf-8");

    expect(normalizeContextPathsForActiveWorkspace(tempRoot, tempRoot, ["src\\main.ts"])).toEqual(["src/main.ts"]);
    expect(() => normalizeContextPathsForActiveWorkspace(tempRoot, otherRoot, ["src/main.ts"])).toThrow(
      "[WORKSPACE_INVALID]"
    );
    expect(() => normalizeContextPathsForActiveWorkspace(tempRoot, tempRoot, ["../outside.ts"])).toThrow(
      "Path is outside of current workspace."
    );
  });

  it("finds root files", async () => {
    const tempRoot = createTempWorkspace();
    await fs.writeFile(path.join(tempRoot, "README.md"), "# Test", "utf-8");

    const files = await scanProjectFiles(tempRoot, 100);

    expect(relativePaths(files)).toEqual(["README.md"]);
  });

  it("finds nested source files", async () => {
    const tempRoot = createTempWorkspace();
    await fs.mkdir(path.join(tempRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "src", "index.ts"), "export {};", "utf-8");

    const files = await scanProjectFiles(tempRoot, 100);

    expect(relativePaths(files)).toEqual(["src/index.ts"]);
  });

  it("finds UI files in nested folders", async () => {
    const tempRoot = createTempWorkspace();
    await fs.mkdir(path.join(tempRoot, "ui"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "ui", "App.tsx"), "export function App() { return null; }", "utf-8");

    const files = await scanProjectFiles(tempRoot, 100);

    expect(relativePaths(files)).toEqual(["ui/App.tsx"]);
  });

  it("finds files without extension", async () => {
    const tempRoot = createTempWorkspace();
    await fs.writeFile(path.join(tempRoot, "Dockerfile"), "FROM node:20", "utf-8");

    const files = await scanProjectFiles(tempRoot, 100);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      relativePath: "Dockerfile",
      language: "plaintext"
    });
  });

  it("ignores known large/system directories when scanning", async () => {
    const tempRoot = createTempWorkspace();

    await fs.mkdir(path.join(tempRoot, "src"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "node_modules", "dep"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, ".git"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, ".codee", "resources"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "restore-points"), { recursive: true });

    await fs.writeFile(path.join(tempRoot, "src", "main.ts"), "export {};", "utf-8");
    await fs.writeFile(path.join(tempRoot, "node_modules", "dep", "index.js"), "", "utf-8");
    await fs.writeFile(path.join(tempRoot, ".git", "HEAD"), "", "utf-8");
    await fs.writeFile(path.join(tempRoot, ".codee", "resources", "old.ts"), "", "utf-8");
    await fs.writeFile(path.join(tempRoot, "restore-points", "snapshot.ts"), "", "utf-8");

    const files = await scanProjectFiles(tempRoot, 100);

    expect(relativePaths(files)).toEqual(["src/main.ts"]);
  });

  it("ignores virtual environment directories", async () => {
    const tempRoot = createTempWorkspace();
    await fs.mkdir(path.join(tempRoot, "app"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, ".venv", "Lib"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "venv", "Lib"), { recursive: true });

    await fs.writeFile(path.join(tempRoot, "app", "main.py"), "print('ok')", "utf-8");
    await fs.writeFile(path.join(tempRoot, ".venv", "Lib", "ignored.py"), "", "utf-8");
    await fs.writeFile(path.join(tempRoot, "venv", "Lib", "ignored.py"), "", "utf-8");

    const files = await scanProjectFiles(tempRoot, 100);

    expect(relativePaths(files)).toEqual(["app/main.py"]);
  });

  it("returns an empty list for an empty workspace", async () => {
    const tempRoot = createTempWorkspace();

    const files = await scanProjectFiles(tempRoot, 100);

    expect(files).toEqual([]);
  });

  it("throws a clear error for missing workspaces", async () => {
    const tempRoot = createTempWorkspace();
    const missingRoot = path.join(tempRoot, "missing");

    await expect(scanProjectFiles(missingRoot, 100)).rejects.toThrow(
      "Workspace path does not exist or is not a directory"
    );
  });

  it("respects max file count", async () => {
    const tempRoot = createTempWorkspace();
    await fs.writeFile(path.join(tempRoot, "a.ts"), "", "utf-8");
    await fs.writeFile(path.join(tempRoot, "b.ts"), "", "utf-8");

    const files = await scanProjectFiles(tempRoot, 1);

    expect(files).toHaveLength(1);
  });

  it("loads workspace state from UTF-8 BOM JSON", async () => {
    const tempRoot = createTempWorkspace();
    const stateFilePath = path.join(tempRoot, "workspace-state.json");
    const rawState = JSON.stringify(
      {
        projectPath: "D:/Dev/repo/dbzs-codee",
        projectName: "dbzs-codee",
        lastOpenedAt: "2026-05-11T18:00:00.000Z",
        maxFileScanCount: 5000
      },
      null,
      2
    );

    await fs.writeFile(stateFilePath, `\uFEFF${rawState}`, "utf-8");

    await expect(loadWorkspaceState(stateFilePath)).resolves.toEqual({
      projectPath: "D:/Dev/repo/dbzs-codee",
      projectName: "dbzs-codee",
      lastOpenedAt: "2026-05-11T18:00:00.000Z",
      maxFileScanCount: 5000
    });
  });

  it("creates a TypeScript project workflow scaffold", async () => {
    const tempRoot = createTempWorkspace();

    const result = await createProjectWorkflow(tempRoot, "Mein DBZS Projekt", "typescript");

    expect(result).toMatchObject({
      projectName: "Mein-DBZS-Projekt",
      workflow: "dbzs-typescript"
    });
    await expect(fs.readFile(path.join(result.projectPath, "README.md"), "utf-8")).resolves.toContain("Mein DBZS Projekt");
    await expect(fs.readFile(path.join(result.projectPath, "package.json"), "utf-8")).resolves.toContain("\"build\"");
    await expect(fs.readFile(path.join(result.projectPath, ".codee", "project.json"), "utf-8")).resolves.toContain("dbzs-typescript");
    const protectedPaths = JSON.parse(
      await fs.readFile(path.join(result.projectPath, ".codee", "protected-paths.json"), "utf-8")
    ) as { protectedPaths?: Array<{ path?: string }>; examples?: Array<{ path?: string }> };
    expect(protectedPaths.protectedPaths?.map((entry) => entry.path)).toContain(".codee/restore-points/");
    expect(protectedPaths.examples?.map((entry) => entry.path)).toContain("docs/ARCHITECTURE.md");
    expect(protectedPaths.examples?.map((entry) => entry.path)).toContain("Plaene/**");
    expect(result.createdFiles).toContain("src/index.ts");
    expect(result.createdFiles).toContain(".codee/protected-paths.json");
  });

  it("creates a Python runtime workflow scaffold", async () => {
    const tempRoot = createTempWorkspace();

    const result = await createProjectWorkflow(tempRoot, "Runtime Lab", "python");

    expect(result.workflow).toBe("python-runtime");
    await expect(fs.readFile(path.join(result.projectPath, "pyproject.toml"), "utf-8")).resolves.toContain("requires-python");
    await expect(fs.readFile(path.join(result.projectPath, "app", "main.py"), "utf-8")).resolves.toContain("Runtime Lab");
    expect(result.createdFiles).toContain("tests/test_smoke.py");
  });

  it("does not overwrite an existing non-empty project directory", async () => {
    const tempRoot = createTempWorkspace();
    const existing = path.join(tempRoot, "Existing");
    await fs.mkdir(existing, { recursive: true });
    await fs.writeFile(path.join(existing, "README.md"), "# Existing", "utf-8");

    await expect(createProjectWorkflow(tempRoot, "Existing", "empty")).rejects.toThrow("Project target is not empty");
  });
});
