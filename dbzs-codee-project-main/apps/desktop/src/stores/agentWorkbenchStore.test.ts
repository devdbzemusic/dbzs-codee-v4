import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentRun } from "@dbzs/shared";
import { useAgentWorkbenchStore } from "./agentWorkbenchStore";

const mockAgentWorkbenchService = vi.hoisted(() => ({
  acceptWorkspaceChanges: vi.fn(),
  getRun: vi.fn(),
  getWorkspaceChanges: vi.fn()
}));

vi.mock("@/services/agentWorkbenchService", () => ({
  agentWorkbenchService: mockAgentWorkbenchService
}));

function makeRun(status: AgentRun["status"]): AgentRun {
  return {
    id: "run-1",
    jobId: null,
    workspaceRoot: "C:/demo",
    workspaceName: "demo",
    goal: "Demo",
    status,
    executionMode: "supervised",
    provider: null,
    modelId: null,
    currentStepId: "step-1",
    maxSteps: 3,
    createdAt: "2026-06-20T12:00:00Z",
    updatedAt: "2026-06-20T12:00:00Z",
    startedAt: "2026-06-20T12:00:00Z",
    finishedAt: null,
    pauseReason: null,
    errorMessage: null,
    schemaVersion: "agent-run-v1"
  };
}

describe("agentWorkbenchStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentWorkbenchService.getRun.mockResolvedValue({
      run: makeRun("running"),
      steps: [],
      followUps: []
    });
    mockAgentWorkbenchService.getWorkspaceChanges.mockResolvedValue([]);
    mockAgentWorkbenchService.acceptWorkspaceChanges.mockResolvedValue(makeRun("paused"));
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

  it("merges SSE events by sequence and derives pending reviews", () => {
    const baseEvent: AgentEvent = {
      sequence: 1,
      id: "evt-1",
      runId: "run-1",
      stepId: "step-1",
      eventType: "run.started",
      severity: "info",
      summary: "Run started",
      payload: {},
      createdAt: "2026-06-20T12:00:00Z"
    };

    useAgentWorkbenchStore.setState({
      selectedRunId: "run-1",
      selectedRun: {
        ...makeRun("running")
      },
      events: [baseEvent]
    });

    useAgentWorkbenchStore.getState().ingestEvent({
      sequence: 2,
      id: "evt-2",
      runId: "run-1",
      stepId: "step-2",
      eventType: "file.change_proposed",
      severity: "warning",
      summary: "Patch waiting for review",
      payload: {
        file_path: "src/example.ts",
        review_gate_id: "gate-1",
        risk_level: "medium",
        diff: "+change"
      },
      createdAt: "2026-06-20T12:00:05Z"
    });

    const state = useAgentWorkbenchStore.getState();
    expect(state.events).toHaveLength(2);
    expect(state.pendingReviews[0]).toMatchObject({
      gateId: "gate-1",
      filePath: "src/example.ts",
      riskLevel: "medium"
    });
  });

  it("tracks command summaries from command events", () => {
    useAgentWorkbenchStore.getState().ingestEvent({
      sequence: 3,
      id: "evt-3",
      runId: "run-1",
      stepId: null,
      eventType: "command.completed",
      severity: "info",
      summary: "pnpm test passed",
      payload: {},
      createdAt: "2026-06-20T12:01:00Z"
    });

    expect(useAgentWorkbenchStore.getState().lastCommandSummary).toBe("pnpm test passed");
  });

  it("refreshes workspace drift files every time a review run is refreshed", async () => {
    mockAgentWorkbenchService.getRun.mockResolvedValue({
      run: makeRun("workspace_review_required"),
      steps: [],
      followUps: []
    });
    mockAgentWorkbenchService.getWorkspaceChanges.mockResolvedValue(["src/new.ts"]);
    useAgentWorkbenchStore.setState({
      selectedRunId: "run-1",
      selectedRun: makeRun("workspace_review_required"),
      workspaceChangeFiles: ["src/old.ts"]
    });

    await useAgentWorkbenchStore.getState().refreshSelectedRun();

    expect(mockAgentWorkbenchService.getWorkspaceChanges).toHaveBeenCalledWith("run-1");
    expect(useAgentWorkbenchStore.getState().workspaceChangeFiles).toEqual(["src/new.ts"]);
  });

  it("reloads workspace drift files after accept mismatches", async () => {
    mockAgentWorkbenchService.getRun.mockResolvedValue({
      run: makeRun("workspace_review_required"),
      steps: [],
      followUps: []
    });
    mockAgentWorkbenchService.getWorkspaceChanges.mockResolvedValue(["src/current.ts"]);
    mockAgentWorkbenchService.acceptWorkspaceChanges.mockRejectedValue(new Error("workspace_changes_mismatch (409)"));
    useAgentWorkbenchStore.setState({
      selectedRunId: "run-1",
      selectedRun: makeRun("workspace_review_required"),
      workspaceChangeFiles: ["src/stale.ts"]
    });

    await useAgentWorkbenchStore.getState().acceptWorkspaceChangesForSelectedRun();

    expect(mockAgentWorkbenchService.acceptWorkspaceChanges).toHaveBeenCalledWith("run-1", ["src/current.ts"]);
    expect(mockAgentWorkbenchService.getWorkspaceChanges).toHaveBeenCalledTimes(2);
    expect(useAgentWorkbenchStore.getState().workspaceChangeFiles).toEqual(["src/current.ts"]);
    expect(useAgentWorkbenchStore.getState().error).toContain("workspace_changes_mismatch");
  });
});
