import { describe, expect, it } from "vitest";
import type { WorkspaceProjectFile } from "@dbzs/shared";
import {
  allFolderIds,
  buildTree,
  buildWorkspaceRows,
  countFolder,
  flattenTree,
  getUniqueExtensions,
  parentRel,
  siblingPath,
  toAbsPath
} from "./workspaceTree";

const files: WorkspaceProjectFile[] = [
  { path: "C:/repo/src/App.tsx", relativePath: "src/App.tsx", name: "App.tsx", language: "typescript" },
  { path: "C:/repo/src/components/Button.tsx", relativePath: "src/components/Button.tsx", name: "Button.tsx", language: "typescript" },
  { path: "C:/repo/README.md", relativePath: "README.md", name: "README.md", language: "markdown" },
  { path: "C:/repo/package.json", relativePath: "package.json", name: "package.json", language: "json" }
];

describe("workspaceTree", () => {
  it("builds a sorted folder-first tree", () => {
    const tree = buildTree(files);

    expect(tree.map((node) => `${node.type}:${node.path}`)).toEqual([
      "folder:src",
      "file:package.json",
      "file:README.md"
    ]);
    expect(tree[0]?.children.map((node) => `${node.type}:${node.path}`)).toEqual([
      "folder:src/components",
      "file:src/App.tsx"
    ]);
  });

  it("flattens while respecting collapsed folders", () => {
    const tree = buildTree(files);

    expect(flattenTree(tree, new Set()).map((node) => node.path)).toContain("src/components/Button.tsx");
    expect(flattenTree(tree, new Set(["src"])).map((node) => node.path)).toEqual([
      "src",
      "package.json",
      "README.md"
    ]);
  });

  it("filters rows by extension and file query", () => {
    const rows = buildWorkspaceRows(files, {
      collapsed: new Set(),
      query: "button",
      typeFilter: "tsx"
    });

    expect(rows.map((node) => node.path)).toEqual(["src/components/Button.tsx"]);
  });

  it("counts folder children recursively and lists folder ids", () => {
    const tree = buildTree(files);
    const src = tree.find((node) => node.path === "src");

    expect(src && countFolder(src)).toEqual({ files: 2, folders: 1 });
    expect(allFolderIds(tree)).toEqual(["src", "src/components"]);
  });

  it("normalizes path helpers across Windows-style roots", () => {
    expect(toAbsPath("C:\\repo", "src/App.tsx")).toBe("C:\\repo\\src\\App.tsx");
    expect(parentRel("src\\components\\Button.tsx")).toBe("src/components");
    expect(siblingPath("src/App.tsx", "index.ts")).toBe("src/index.ts");
  });

  it("extracts sorted unique extensions", () => {
    expect(getUniqueExtensions(files)).toEqual(["json", "md", "tsx"]);
  });
});
