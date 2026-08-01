import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTreeNode } from "@/services/workspaceTree";
import { buildWorkspaceExplorerCommands } from "./workspaceExplorerCommands";

const fileNode: WorkspaceTreeNode = {
  id: "C:/repo/src/App.tsx",
  name: "App.tsx",
  path: "src/App.tsx",
  depth: 1,
  type: "file",
  language: "typescript",
  children: [],
  file: {
    path: "C:/repo/src/App.tsx",
    relativePath: "src/App.tsx",
    name: "App.tsx",
    language: "typescript"
  }
};

const folderNode: WorkspaceTreeNode = {
  id: "src",
  name: "src",
  path: "src",
  depth: 0,
  type: "folder",
  children: []
};

function handlers() {
  return {
    open: vi.fn(),
    newFile: vi.fn(),
    newFolder: vi.fn(),
    rename: vi.fn(),
    move: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
    copyRelativePath: vi.fn(),
    copyAbsolutePath: vi.fn(),
    reveal: vi.fn(),
    pin: vi.fn(),
    sendToAgent: vi.fn(),
    preparePatch: vi.fn()
  };
}

describe("workspaceExplorerCommands", () => {
  it("exposes file-specific commands for file targets", () => {
    const commands = buildWorkspaceExplorerCommands(
      { target: fileNode, hasWorkspace: true, targetPinned: false, folderCollapsed: false },
      handlers()
    );

    expect(commands.map((command) => command.id)).toEqual([
      "open",
      "newFile",
      "newFolder",
      "rename",
      "move",
      "pin",
      "duplicate",
      "copyRelativePath",
      "copyAbsolutePath",
      "preparePatch",
      "sendToAgent",
      "reveal",
      "delete"
    ]);
    expect(commands.find((command) => command.id === "pin")?.label).toBe("Anpinnen");
    expect(commands.every((command) => !command.disabled)).toBe(true);
  });

  it("omits file-only commands for folder targets", () => {
    const commands = buildWorkspaceExplorerCommands(
      { target: folderNode, hasWorkspace: true, targetPinned: false, folderCollapsed: true },
      handlers()
    );

    expect(commands.map((command) => command.id)).not.toContain("duplicate");
    expect(commands.map((command) => command.id)).not.toContain("preparePatch");
    expect(commands.find((command) => command.id === "open")?.label).toBe("Ordner aufklappen");
  });

  it("disables workspace-required commands without an active workspace", () => {
    const commands = buildWorkspaceExplorerCommands(
      { target: null, hasWorkspace: false, targetPinned: false, folderCollapsed: false },
      handlers()
    );

    expect(commands.find((command) => command.id === "newFile")?.disabled).toBe(true);
    expect(commands.find((command) => command.id === "newFolder")?.disabled).toBe(true);
    expect(commands.find((command) => command.id === "reveal")?.disabled).toBe(true);
  });
});
