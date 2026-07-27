import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitPanel } from "./GitPanel";
import { useGitStore } from "@/stores/gitStore";

declare global {
  // React checks this flag to know whether act() is supported by the test environment.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll("button"));
  return (buttons.find((button) => button.textContent?.trim() === text) as HTMLButtonElement | undefined) ?? null;
}

describe("GitPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useGitStore.setState({
      repositoryStatus: {
        isRepository: true,
        workspaceRoot: "D:/repo",
        currentBranch: "feature/git-intelligence",
        hasUpstream: true,
        aheadCount: 3,
        behindCount: 1,
        hasUncommittedChanges: true,
        entries: [
          {
            filePath: "src/App.tsx",
            status: "modified"
          }
        ],
        updatedAt: new Date().toISOString()
      },
      currentBranch: "feature/git-intelligence",
      changedEntries: [
        {
          filePath: "src/App.tsx",
          status: "modified"
        }
      ],
      diffSummary: [
        {
          filePath: "src/App.tsx",
          additions: 10,
          deletions: 4,
          summary: "10 additions, 4 deletions"
        }
      ],
      selectedFilePath: "src/App.tsx",
      selectedDiff: "diff --git a/src/App.tsx b/src/App.tsx",
      commitSuggestion: {
        title: "feat: update app shell",
        body: "Align shell and git intelligence panel",
        affectedFiles: ["src/App.tsx"],
        riskLevel: "medium"
      },
      commitSuggestions: [],
      selectedCommitSuggestionId: null,
      draftCommitTitle: "",
      draftCommitBody: "",
      selectedCommitFiles: ["src/App.tsx"],
      commitWarnings: [],
      lastCommitHash: null,
      isCommitting: false,
      restorePoints: [],
      isRestorePointsLoading: false,
      restorePointsError: null,
      busyRestorePointId: null,
      isLoading: false,
      error: null,
      refreshGitStatus: vi.fn(async () => {}),
      selectDiffFile: vi.fn(async () => {}),
      generateCommitSuggestions: vi.fn(async () => {}),
      selectCommitSuggestion: vi.fn(),
      setDraftCommitTitle: vi.fn(),
      setDraftCommitBody: vi.fn(),
      toggleCommitFile: vi.fn(),
      selectAllCommitFiles: vi.fn(),
      createCommit: vi.fn(async () => {}),
      refreshRestorePoints: vi.fn(async () => {}),
      createManualRestorePoint: vi.fn(async () => {}),
      restoreFromPoint: vi.fn(async () => {}),
      deleteRestorePoint: vi.fn(async () => {}),
      cleanupRestorePoints: vi.fn(async () => {})
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
    vi.restoreAllMocks();
  });

  it("zeigt branch, geaenderte dateien und commit-vorschlag", async () => {
    await act(async () => {
      root.render(<GitPanel />);
    });

    expect(container.textContent).toContain("Git Intelligence");
    expect(container.textContent).toContain("Branch: feature/git-intelligence");
    expect(container.textContent).toContain("Upstream: ja");
    expect(container.textContent).toContain("Divergence: ↑3 / ↓1");
    expect(container.textContent).toContain("Changed Files: 1");
    expect(container.textContent).toContain("feat: update app shell");
  });

  it("triggert refresh beim mount und ueber den button", async () => {
    const refreshMock = vi.fn(async () => {});
    useGitStore.setState({ refreshGitStatus: refreshMock });

    await act(async () => {
      root.render(<GitPanel />);
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);

    const refreshButton = findButtonByText(container, "Git Status aktualisieren");
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("laedt datei-diff bei file-auswahl", async () => {
    const selectMock = vi.fn(async () => {});
    useGitStore.setState({ selectDiffFile: selectMock });

    await act(async () => {
      root.render(<GitPanel />);
    });

    const fileButton = findButtonByText(container, "src/App.tsx (+10/-4)");
    expect(fileButton).not.toBeNull();

    await act(async () => {
      fileButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(selectMock).toHaveBeenCalledWith("src/App.tsx");
  });

  it("zeigt fehler falls store einen fehler liefert", async () => {
    useGitStore.setState({ error: "Git unavailable" });

    await act(async () => {
      root.render(<GitPanel />);
    });

    expect(container.textContent).toContain("Git unavailable");
  });
});
