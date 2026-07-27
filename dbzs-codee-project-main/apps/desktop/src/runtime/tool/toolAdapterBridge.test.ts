import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopToolAdapterBridge } from "./toolAdapterBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const workspaceRoot = "D:/repo";

describe("DesktopToolAdapterBridge workspace policy", () => {
  beforeEach(() => {
    const files = [
      {
        path: `${workspaceRoot}/src/App.tsx`,
        relativePath: "src/App.tsx",
        name: "App.tsx",
        language: "typescript"
      },
      {
        path: `${workspaceRoot}/.codee/resources/old.ts`,
        relativePath: ".codee/resources/old.ts",
        name: "old.ts",
        language: "typescript"
      }
    ];
    useWorkspaceStore.setState({
      files,
      state: {
        projectPath: workspaceRoot,
        projectName: "repo",
        lastOpenedAt: null,
        maxFileScanCount: 2500
      }
    });
    window.dbzs = {
      readProjectFile: vi.fn().mockResolvedValue({
        path: files[0]!.path,
        name: files[0]!.name,
        language: files[0]!.language,
        content: "export const App = true;"
      })
    } as unknown as typeof window.dbzs;
  });

  it("verbirgt interne Dateien in list_files, Suche und grep", async () => {
    const adapter = new DesktopToolAdapterBridge();

    await expect(adapter.listFiles(undefined, true)).resolves.toEqual(["src/App.tsx"]);
    await expect(adapter.searchWorkspace("old", 10)).resolves.toEqual([]);
    await expect(adapter.grep("App|old", undefined, 10)).resolves.toEqual([
      "src/App.tsx:1:export const App = true;"
    ]);
  });

  it("blockiert direkte interne Reads ohne bestaetigten Zugriff", async () => {
    const adapter = new DesktopToolAdapterBridge();
    await expect(adapter.readFile(".codee/resources/old.ts")).rejects.toThrow("excluded");
    expect(window.dbzs.readProjectFile).not.toHaveBeenCalled();
  });
});
