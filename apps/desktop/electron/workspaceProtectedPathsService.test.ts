import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceProtectedPathsService } from "./workspaceProtectedPathsService";

const tempRoots: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dbzs-protected-paths-"));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, ".codee"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("WorkspaceProtectedPathsService", () => {
  it("liest Datei- und Ordnersperren aus .codee/protected-paths.json", async () => {
    const workspaceRoot = await createWorkspace();
    await fs.writeFile(
      path.join(workspaceRoot, ".codee", "protected-paths.json"),
      JSON.stringify({
        protectedPaths: [
          "docs/ARCHITECTURE.md",
          { path: "Plaene/", reason: "Planungsdokumente nur nach Freigabe" }
        ]
      }),
      "utf-8"
    );

    const service = new WorkspaceProtectedPathsService();

    await expect(service.findProtectedPathMatch(workspaceRoot, "docs/ARCHITECTURE.md")).resolves.toMatchObject({
      entry: { path: "docs/ARCHITECTURE.md", scope: "file" }
    });
    await expect(service.findProtectedPathMatch(workspaceRoot, "docs/OTHER.md")).resolves.toBeNull();
    await expect(service.findProtectedPathMatch(workspaceRoot, "Plaene/09-plan.md")).resolves.toMatchObject({
      entry: { path: "Plaene", scope: "tree" }
    });
  });

  it("blockiert ungueltige Schutzpfade im Config-File", async () => {
    const workspaceRoot = await createWorkspace();
    await fs.writeFile(
      path.join(workspaceRoot, ".codee", "protected-paths.json"),
      JSON.stringify(["../outside.md"]),
      "utf-8"
    );

    const service = new WorkspaceProtectedPathsService();
    await expect(service.loadProtectedPaths(workspaceRoot)).rejects.toThrow("[WORKSPACE_PROTECTED_PATH_INVALID]");
  });

  it("interpretiert glob-artige /** Eintraege als Ordnerbaum-Sperre", async () => {
    const workspaceRoot = await createWorkspace();
    await fs.writeFile(
      path.join(workspaceRoot, ".codee", "protected-paths.json"),
      JSON.stringify(["docs/**"]),
      "utf-8"
    );

    const service = new WorkspaceProtectedPathsService();
    await expect(service.findProtectedPathMatch(workspaceRoot, "docs/notes/todo.md")).resolves.toMatchObject({
      entry: { path: "docs", scope: "tree" }
    });
  });
});
