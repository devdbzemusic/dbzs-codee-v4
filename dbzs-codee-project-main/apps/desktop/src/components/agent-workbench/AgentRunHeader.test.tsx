import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@dbzs/shared";
import { AgentRunHeader } from "./AgentRunHeader";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeRun(status: AgentRun["status"]): AgentRun {
  return {
    id: "run-1",
    jobId: null,
    workspaceRoot: "C:/demo",
    workspaceName: "demo",
    goal: "Review Resume State",
    status,
    executionMode: "supervised",
    provider: null,
    modelId: "local-model",
    currentStepId: null,
    maxSteps: 5,
    createdAt: "2026-07-13T06:00:00Z",
    updatedAt: "2026-07-13T06:00:00Z",
    startedAt: null,
    finishedAt: null,
    pauseReason: null,
    errorMessage: null,
    schemaVersion: "agent-run-v1"
  };
}

describe("AgentRunHeader", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("exposes explicit resume-baseline acceptance for migration review runs", () => {
    const onAcceptResumeBaseline = vi.fn();

    act(() => {
      root.render(
        <AgentRunHeader
          currentStepTitle={null}
          isMutating={false}
          onAcceptResumeBaseline={onAcceptResumeBaseline}
          onAcceptWorkspaceChanges={vi.fn()}
          onOpenEditor={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
          run={makeRun("migration_review_required")}
          workspaceChangeFiles={[]}
        />
      );
    });

    expect(container.textContent).toContain("Resume-Baseline fehlt");
    const button = [...container.querySelectorAll("button")].find(
      (entry) => entry.textContent === "Baseline akzeptieren"
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAcceptResumeBaseline).toHaveBeenCalledTimes(1);
  });

  it("shows changed files and exposes explicit workspace-baseline acceptance", () => {
    const onAcceptWorkspaceChanges = vi.fn();

    act(() => {
      root.render(
        <AgentRunHeader
          currentStepTitle={null}
          isMutating={false}
          onAcceptResumeBaseline={vi.fn()}
          onAcceptWorkspaceChanges={onAcceptWorkspaceChanges}
          onOpenEditor={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
          run={makeRun("workspace_review_required")}
          workspaceChangeFiles={["src/app.ts", "tests/app.test.ts"]}
        />
      );
    });

    expect(container.textContent).toContain("Workspace-Änderungen prüfen");
    expect(container.textContent).toContain("src/app.ts");
    const button = [...container.querySelectorAll("button")].find(
      (entry) => entry.textContent === "Workspace-Änderungen akzeptieren"
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAcceptWorkspaceChanges).toHaveBeenCalledTimes(1);
  });
});
