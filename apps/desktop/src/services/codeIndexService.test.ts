import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodeIndexService } from "./codeIndexService";

const workspaceRoot = "D:/Dev/repo/dbzs-codee";

describe("CodeIndexService", () => {
  let filesByPath: Record<string, { content: string; language: string; name: string }>;
  let workspaceFiles: Array<{ path: string; relativePath: string; name: string; language: string }>;

  beforeEach(() => {
    filesByPath = {};
    workspaceFiles = [
      {
        path: `${workspaceRoot}/apps/desktop/src/services/userService.ts`,
        relativePath: "apps/desktop/src/services/userService.ts",
        name: "userService.ts",
        language: "typescript"
      },
      {
        path: `${workspaceRoot}/apps/desktop/src/components/UserPanel.tsx`,
        relativePath: "apps/desktop/src/components/UserPanel.tsx",
        name: "UserPanel.tsx",
        language: "typescript"
      },
      {
        path: `${workspaceRoot}/apps/desktop/src/hooks/useWorkspace.ts`,
        relativePath: "apps/desktop/src/hooks/useWorkspace.ts",
        name: "useWorkspace.ts",
        language: "typescript"
      }
    ];

    filesByPath[workspaceFiles[0].path] = {
      name: workspaceFiles[0].name,
      language: "typescript",
      content: [
        "import { apiClient } from '../core/apiClient';",
        "export interface UserDto { id: string }",
        "export type UserId = string;",
        "export class UserService {",
        "  getUser(): UserDto { return { id: '1' }; }",
        "}",
        "export function fetchUserService(): UserService {",
        "  return new UserService();",
        "}"
      ].join("\n")
    };

    filesByPath[workspaceFiles[1].path] = {
      name: workspaceFiles[1].name,
      language: "typescript",
      content: [
        "import { UserService, fetchUserService } from '../services/userService';",
        "export const UserPanel = () => {",
        "  const service = fetchUserService();",
        "  return <div>{service.getUser().id}</div>;",
        "};"
      ].join("\n")
    };

    filesByPath[workspaceFiles[2].path] = {
      name: workspaceFiles[2].name,
      language: "typescript",
      content: [
        "import { useMemo } from 'react';",
        "import { UserService } from '../services/userService';",
        "export function useWorkspaceService() {",
        "  return useMemo(() => new UserService(), []);",
        "}"
      ].join("\n")
    };

    window.dbzs = {
      getAppInfo: vi.fn(),
      getBackendHealth: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      openFileDialog: vi.fn(),
      saveFile: vi.fn(),
      getModelIndex: vi.fn(),
      getRuntimeStatus: vi.fn(),
      startRuntimeModel: vi.fn(),
      stopRuntimeModel: vi.fn(),
      sendRuntimeChat: vi.fn(),
      listAgents: vi.fn().mockResolvedValue([]),
      getAgent: vi.fn(),
      createAgent: vi.fn(),
      updateAgent: vi.fn(),
      startAgent: vi.fn(),
      stopAgent: vi.fn(),
      deleteAgent: vi.fn(),
      listAgentLogs: vi.fn().mockResolvedValue([]),
      listProjectMemory: vi.fn().mockResolvedValue([]),
      upsertProjectMemory: vi.fn(),
      deleteProjectMemory: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      analyzeDocs: vi.fn(),
      generateDocs: vi.fn(),
      scanProjectFiles: vi.fn().mockResolvedValue(workspaceFiles),
      readProjectFile: vi.fn().mockImplementation(async (filePath: string) => {
        const found = filesByPath[filePath];
        if (!found) {
          return null;
        }

        return {
          path: filePath,
          name: found.name,
          content: found.content,
          language: found.language
        };
      }),
      writeProjectFile: vi.fn().mockImplementation(async (filePath: string, content: string) => ({
        path: filePath,
        name: filePath.split("/").at(-1) ?? "code-index.json",
        content,
        language: "json"
      }))
    };
  });

  it("analysiert Imports, Exports und Symbole", async () => {
    const service = new CodeIndexService();
    const files = await service.buildWorkspaceIndex(workspaceRoot);

    const userServiceFile = files.find((entry) => entry.path.endsWith("services/userService.ts"));
    expect(userServiceFile).toBeDefined();
    expect(userServiceFile?.imports).toEqual(expect.arrayContaining(["../core/apiClient"]));
    expect(userServiceFile?.exports).toEqual(expect.arrayContaining(["UserDto", "UserId", "UserService", "fetchUserService"]));
    expect(userServiceFile?.symbols.some((symbol) => symbol.type === "interface" && symbol.name === "UserDto")).toBe(true);
    expect(userServiceFile?.symbols.some((symbol) => symbol.type === "service" && symbol.name === "UserService")).toBe(true);
  });

  it("erkennt React Components und Hooks", async () => {
    const service = new CodeIndexService();
    await service.buildWorkspaceIndex(workspaceRoot);

    const components = service.findSymbol("UserPanel");
    expect(components[0]?.matchedSymbols).toContain("UserPanel");

    const hooks = service.findSymbol("useWorkspaceService");
    expect(hooks[0]?.matchedSymbols).toContain("useWorkspaceService");
  });

  it("findet related files ueber Imports und Symbole", async () => {
    const service = new CodeIndexService();
    await service.buildWorkspaceIndex(workspaceRoot);

    const related = service.findRelatedFiles("apps/desktop/src/services/userService.ts");
    expect(related.length).toBeGreaterThan(0);
    expect(related.some((entry) => entry.filePath.includes("UserPanel.tsx"))).toBe(true);
  });

  it("liefert leere Ergebnisse wenn nichts passt", async () => {
    const service = new CodeIndexService();
    await service.buildWorkspaceIndex(workspaceRoot);

    expect(service.searchCode("does-not-exist-query")).toEqual([]);
    expect(service.findSymbol("NeverSymbol")).toEqual([]);
  });

  it("leert den Index beim Wechsel zu einem Workspace ohne Index", async () => {
    const service = new CodeIndexService();
    await service.buildWorkspaceIndex(workspaceRoot);
    expect(service.findSymbol("UserService")).not.toEqual([]);

    const workspaceB = "D:/Dev/repo/stringlab";
    vi.mocked(window.dbzs.scanProjectFiles!).mockResolvedValueOnce([]);
    await service.buildWorkspaceIndex(workspaceB);

    expect(service.getIndexedFiles()).toEqual([]);
    expect(service.findSymbol("UserService")).toEqual([]);
  });

  it("verwirft beschaedigte und workspace-fremde Persistenz", async () => {
    const service = new CodeIndexService();
    const workspaceB = "D:/Dev/repo/stringlab";
    const indexPath = `${workspaceB}/.codee/code-index.json`;
    vi.mocked(window.dbzs.scanProjectFiles!).mockResolvedValue([]);
    vi.mocked(window.dbzs.readProjectFile!).mockImplementation(async (filePath: string) => {
      if (filePath === indexPath) {
        return {
          path: filePath,
          name: "code-index.json",
          language: "json",
          content: JSON.stringify({
            schemaVersion: 1,
            workspaceRoot,
            files: [{
              path: "src/old.ts",
              language: "typescript",
              imports: [],
              exports: [],
              symbols: [],
              updatedAt: new Date().toISOString()
            }],
            updatedAt: new Date().toISOString()
          })
        };
      }
      return null;
    });

    await service.buildWorkspaceIndex(workspaceB);
    expect(service.getIndexedFiles()).toEqual([]);

    vi.mocked(window.dbzs.readProjectFile!).mockResolvedValueOnce({
      path: indexPath,
      name: "code-index.json",
      language: "json",
      content: "{kaputt"
    });
    await service.buildWorkspaceIndex(workspaceB);
    expect(service.getIndexedFiles()).toEqual([]);
  });

  it("laesst einen langsamen Build A den schnellen Build B nicht ueberschreiben", async () => {
    const service = new CodeIndexService();
    const workspaceB = "D:/Dev/repo/stringlab";
    const bFile = {
      path: `${workspaceB}/src/stringLab.ts`,
      relativePath: "src/stringLab.ts",
      name: "stringLab.ts",
      language: "typescript"
    };
    let releaseWorkspaceA: ((files: typeof workspaceFiles) => void) | undefined;

    vi.mocked(window.dbzs.scanProjectFiles!).mockImplementation((root: string) => {
      if (root === workspaceRoot) {
        return new Promise((resolve) => {
          releaseWorkspaceA = resolve;
        });
      }
      return Promise.resolve([bFile]);
    });
    vi.mocked(window.dbzs.readProjectFile!).mockImplementation(async (filePath: string) => {
      if (filePath === bFile.path) {
        return {
          path: bFile.path,
          name: bFile.name,
          language: bFile.language,
          content: "export function createStringLabFeature() { return true; }"
        };
      }
      const found = filesByPath[filePath];
      return found ? { path: filePath, ...found } : null;
    });

    const buildA = service.buildWorkspaceIndex(workspaceRoot);
    await Promise.resolve();
    const buildB = service.buildWorkspaceIndex(workspaceB);
    await buildB;
    releaseWorkspaceA?.(workspaceFiles);
    await buildA;

    expect(service.getIndexedFiles().map((file) => file.path)).toEqual(["src/stringLab.ts"]);
    expect(service.findSymbol("UserService")).toEqual([]);
  });

  it("schliesst interne Dateien aus dem Index aus", async () => {
    const internal = {
      path: `${workspaceRoot}/.codee/resources/foo.ts`,
      relativePath: ".codee/resources/foo.ts",
      name: "foo.ts",
      language: "typescript"
    };
    workspaceFiles.push(internal);
    filesByPath[internal.path] = {
      name: internal.name,
      language: internal.language,
      content: "export const shouldNeverLeak = true;"
    };

    const service = new CodeIndexService();
    await service.buildWorkspaceIndex(workspaceRoot);

    expect(service.getIndexedFiles().some((file) => file.path.includes(".codee"))).toBe(false);
  });
});
