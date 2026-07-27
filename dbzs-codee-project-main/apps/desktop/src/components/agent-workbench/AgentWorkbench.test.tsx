import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkbench } from "./AgentWorkbench";
import { useAgentWorkbenchStore } from "@/stores/agentWorkbenchStore";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock("@/services/agentWorkbenchService", () => ({
  agentWorkbenchService: {
    getBackendUrl: () => "http://127.0.0.1:8876",
    listRuns: vi.fn().mockResolvedValue([
      {
        id: "run-1",
        jobId: null,
        workspaceRoot: "C:/demo",
        workspaceName: "demo",
        goal: "Implement Agent Workbench",
        status: "running",
        executionMode: "supervised",
        provider: null,
        modelId: "local-model",
        currentStepId: "step-1",
        maxSteps: 5,
        createdAt: "2026-06-20T12:00:00Z",
        updatedAt: "2026-06-20T12:01:00Z",
        startedAt: "2026-06-20T12:00:10Z",
        finishedAt: null,
        pauseReason: null,
        errorMessage: null,
        schemaVersion: "agent-run-v1"
      }
    ]),
    getRun: vi.fn().mockResolvedValue({
      run: {
        id: "run-1",
        jobId: null,
        workspaceRoot: "C:/demo",
        workspaceName: "demo",
        goal: "Implement Agent Workbench",
        status: "running",
        executionMode: "supervised",
        provider: null,
        modelId: "local-model",
        currentStepId: "step-1",
        maxSteps: 5,
        createdAt: "2026-06-20T12:00:00Z",
        updatedAt: "2026-06-20T12:01:00Z",
        startedAt: "2026-06-20T12:00:10Z",
        finishedAt: null,
        pauseReason: null,
        errorMessage: null,
        schemaVersion: "agent-run-v1"
      },
      steps: [
        {
          id: "step-1",
          runId: "run-1",
          ordinal: 1,
          title: "Analyze workspace",
          description: "Scan project structure",
          status: "active",
          role: "planner",
          dependsOn: [],
          attemptCount: 1,
          maxAttempts: 3,
          inputSummary: null,
          outputSummary: null,
          createdAt: "2026-06-20T12:00:00Z",
          startedAt: "2026-06-20T12:00:10Z",
          finishedAt: null,
          errorMessage: null
        }
      ],
      followUps: []
    }),
    acceptResumeBaseline: vi.fn(),
    getWorkspaceChanges: vi.fn().mockResolvedValue([]),
    acceptWorkspaceChanges: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({
      schemaVersion: "agent-event-v1",
      events: [
        {
          sequence: 1,
          id: "evt-1",
          runId: "run-1",
          stepId: "step-1",
          eventType: "step.started",
          severity: "info",
          summary: "Analyze workspace",
          payload: {},
          createdAt: "2026-06-20T12:00:10Z"
        }
      ]
    })
  }
}));

vi.mock("@/services/agentWorkbenchSse", () => ({
  connectAgentWorkbenchSse: vi.fn(),
  disconnectAgentWorkbenchSse: vi.fn(),
  getAgentWorkbenchSseSequence: vi.fn().mockReturnValue(0)
}));

vi.mock("@/services/agentHostExecutor", () => ({
  agentHostExecutor: {
    getStatus: vi.fn().mockReturnValue({
      state: "running",
      executorId: "desktop-primary",
      lastActionId: null,
      lastActionType: null,
      lastError: null,
      processedCount: 0
    }),
    setStatusListener: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  }
}));

describe("AgentWorkbench", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAgentWorkbenchStore.setState({
      runs: [],
      selectedRunId: null,
      selectedRun: null,
      steps: [],
      events: [],
      followUps: [],
      pendingReviews: [],
      workspaceChangeFiles: [],
      selectedReviewGateId: null,
      activityFilter: "all",
      outputTab: "agent",
      sseConnected: false,
      isLoadingRuns: false,
      isLoadingDetail: false,
      isMutating: false,
      error: null,
      newRunGoal: "",
      lastCommandSummary: null
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders workbench shell and loads runs", async () => {
    await act(async () => {
      root.render(
        <AgentWorkbench
          onOpenFile={vi.fn()}
          workspaceName="demo"
          workspaceRoot="C:/demo"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Runs");
    expect(container.textContent).toContain("Implement Agent Workbench");
    expect(container.textContent).toContain("Activity Stream");
  });
});
