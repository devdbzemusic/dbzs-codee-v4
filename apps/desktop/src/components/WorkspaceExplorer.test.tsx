import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { WorkspaceExplorer } from "./WorkspaceExplorer";
import { useEditorStore } from "@/stores/editorStore";
import { useGitStore } from "@/stores/gitStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

describe("WorkspaceExplorer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.dbzs = {
      ...(window.dbzs ?? {}),
      listReviewArtifacts: vi.fn().mockResolvedValue([]),
      promptTextInput: vi.fn()
    };
    useWorkspaceStore.setState({
      state: {
        projectPath: "C:/repo",
        projectName: "repo",
        lastOpenedAt: null,
        maxFileScanCount: 2500
      },
      files: [
        { path: "C:/repo/src/App.tsx", relativePath: "src/App.tsx", name: "App.tsx", language: "typescript" },
        { path: "C:/repo/README.md", relativePath: "README.md", name: "README.md", language: "markdown" }
      ],
      isLoading: false,
      hasLoadedState: true,
      status: "ready",
      error: null
    });
    useEditorStore.setState({
      activeTab: null,
      openWorkspaceFile: vi.fn()
    } as Partial<ReturnType<typeof useEditorStore.getState>>);
    useGitStore.setState({ changedEntries: [] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
  });

  it("renders workspace rows and collapses folders", () => {
    act(() => {
      root.render(<WorkspaceExplorer embeddedInPanel />);
    });

    expect(container.textContent).toContain("Explorer");
    expect(container.textContent).toContain("src");
    expect(container.textContent).toContain("App.tsx");
    expect(container.textContent).toContain("README.md");

    const srcRow = Array.from(container.querySelectorAll("[role='treeitem']")).find(
      (item) => item.textContent?.includes("src")
    );
    expect(srcRow).toBeTruthy();

    act(() => {
      srcRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("App.tsx");
    expect(container.textContent).toContain("README.md");
  });
});
