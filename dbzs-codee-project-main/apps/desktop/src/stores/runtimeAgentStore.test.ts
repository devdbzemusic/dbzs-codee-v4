import { beforeEach, describe, expect, it } from "vitest";
import type { AppSettings } from "@dbzs/shared";
import { useEditorStore } from "@/stores/editorStore";
import { resetRuntimeKernelForTests } from "@/services/runtimeKernelService";
import type { AgentLoopResult, AgentRunRequest, AgentStep } from "@/runtime/agent/agentContracts";
import type { PatchApprovalCallback } from "@/runtime/agent/agentLoop";
import { RuntimeEventBus } from "@/runtime/core/runtimeEventBus";
import type { ToolRequest, ToolResult } from "@/runtime/tool/toolContracts";
import {
  createRuntimeAgentStore,
  type RuntimeAgentPersistedState
} from "./runtimeAgentStore";

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Condition was not met in time.");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createFakeKernel(
  requestPatchApproval: PatchApprovalCallback,
  finalStatus: AgentLoopResult["status"]
) {
  const events = new RuntimeEventBus();

  return {
    events,
    initialize: async () => undefined,
    runAgent: async (request: AgentRunRequest, signal: AbortSignal): Promise<AgentLoopResult> => {
      if (signal.aborted) {
        return {
          runId: request.runId,
          status: "cancelled",
          appliedPatchPreviewIds: [],
          stepsExecuted: 0,
          toolCallsExecuted: 0
        };
      }

      await events.emit("agent-runtime", "agent.plan.created", { summary: "Testplan" });

      const step: AgentStep = {
        id: "step-1",
        title: "Execute scoped changes",
        objective: request.goal,
        expectedTools: ["apply_patch"]
      };
      const patchResult: ToolResult = {
        requestId: "tool-1",
        toolName: "apply_patch",
        status: "ok",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        output: {
          patchId: "patch-1",
          filePath: ".codee/runtime-agent-proposal.md",
          diff: "--- before\n+++ after\n+proposal",
          afterContent: "# Runtime Change Proposal"
        }
      };
      const toolRequest: ToolRequest = {
        name: "apply_patch",
        actorId: request.actorId,
        requestId: "tool-1",
        workspaceRoot: request.workspaceRoot,
        input: {
          path: ".codee/runtime-agent-proposal.md",
          targetPath: "docs/RUNTIME_ARCHITECTURE_CODEE.md",
          summary: request.goal,
          proposedContent: "# Runtime Change Proposal",
          previewOnly: true
        }
      };

      const approved = await requestPatchApproval(request, step, patchResult, toolRequest);
      const result: AgentLoopResult = {
        runId: request.runId,
        status: approved ? finalStatus : "cancelled",
        appliedPatchPreviewIds: approved ? ["patch-1"] : [],
        stepsExecuted: approved ? 1 : 0,
        toolCallsExecuted: 1,
        lastError: approved ? undefined : "Patch preview rejected"
      };

      await events.emit("agent-runtime", "agent.run.completed", result);
      return result;
    }
  };
}

beforeEach(() => {
  resetRuntimeKernelForTests();
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    isBusy: false,
    error: null,
    activeTab: null,
    lastActiveFileTabId: null,
    lastSavedAt: null,
    hasWorkspacePatchUndo: false,
    snapshots: {},
    pendingChanges: {},
    proposedChanges: {},
    appliedChanges: [],
    activePendingChange: null,
    conflictNavigationTarget: null
  });

  window.dbzs = {
    getAppInfo: async () => ({ name: "dbzs", version: "0.1.0", platform: "test", backendUrl: "http://localhost" }),
    getBackendHealth: async () => ({ status: "ok", apiBaseUrl: "http://localhost", timestamp: new Date().toISOString() }),
    getSettings: async () => ({
      telemetryEnabled: false,
      backendApiBaseUrl: "http://localhost",
      defaultProvider: "local",
      defaultModel: null,
      localRuntimeCommand: "",
      localRuntimeArgs: [],
      localRuntimeModelPath: null,
      plannerModel: null,
      coderModel: null,
      reviewerModel: null,
      allowBackgroundAgents: false,
      maxFileScanCount: 1000,
      maxAgentRuntimeSeconds: 120,
      maxAutonomousSteps: 10,
      maxDebugRetries: 2,
      maxFailedTaskRetries: 2,
      safeMode: true,
      localOnly: true
    }),
    updateSettings: async (settings: AppSettings) => settings,
    openFileDialog: async () => null,
    createWorkspaceFileSnapshot: async (filePath: string) => ({
      snapshotId: `snap-${filePath}`,
      filePath,
      existed: true
    }),
    createWorkspaceDiff: async (filePath: string, proposedContent: string) => ({
      snapshotId: `snap-${filePath}`,
      beforeContent: "before",
      afterContent: proposedContent,
      diff: `--- before\n+++ after\n+${proposedContent.slice(0, 20)}`
    }),
    applyWorkspacePatch: async (filePath: string, content: string, snapshotId?: string) => ({
      snapshotId: snapshotId ?? `snap-${filePath}`,
      diff: `--- before\n+++ after\n+${content.slice(0, 20)}`,
      file: {
        path: filePath,
        name: filePath.split(/[\\/]/).at(-1) ?? filePath,
        language: filePath.endsWith(".md") ? "markdown" : "typescript",
        content
      }
    }),
    readProjectFile: async (filePath: string) => ({
      path: filePath,
      name: filePath.split(/[\\/]/).at(-1) ?? filePath,
      language: filePath.endsWith(".md") ? "markdown" : "typescript",
      content: "export const runtime = true;"
    }),
    saveFile: async () => {
      throw new Error("unused");
    },
    getModelIndex: async () => ({ summary: { total: 0, gguf_total: 0, ollama_total: 0, llama_server_ready: 0, ollama_ready: 0, coding_candidates: 0 }, models: [] }),
    getRuntimeStatus: async () => ({ state: "stopped", provider: null, model_id: null, model_name: null, port: null, pid: null, endpoint: null, message: "" }),
    startRuntimeModel: async () => ({ state: "running", provider: "local", model_id: null, model_name: null, port: null, pid: null, endpoint: null, message: "" }),
    stopRuntimeModel: async () => ({ state: "stopped", provider: null, model_id: null, model_name: null, port: null, pid: null, endpoint: null, message: "" }),
    sendRuntimeChat: async () => ({ message: { role: "assistant", content: "" }, model_id: null, model_name: null }),
    listAgents: async () => [],
    getAgent: async () => {
      throw new Error("unused");
    },
    createAgent: async () => {
      throw new Error("unused");
    },
    updateAgent: async () => {
      throw new Error("unused");
    },
    startAgent: async () => {
      throw new Error("unused");
    },
    stopAgent: async () => {
      throw new Error("unused");
    },
    deleteAgent: async () => ({ status: "ok", agent_id: "" }),
    listAgentLogs: async () => [],
    listProjectMemory: async () => [],
    upsertProjectMemory: async () => {
      throw new Error("unused");
    },
    deleteProjectMemory: async () => ({ status: "ok", id: 1 }),
    listTasks: async () => [],
    createTask: async () => {
      throw new Error("unused");
    },
    updateTask: async () => {
      throw new Error("unused");
    },
    deleteTask: async () => ({ status: "ok" }),
    analyzeDocs: async () => ({ markdown: "", summary: "" }),
    generateDocs: async () => ({ markdown: "" }),
    getRuntimeAgentState: async () => null,
    setRuntimeAgentState: async (
      _workspaceRoot: string,
      state: RuntimeAgentPersistedState
    ) => state
  } as unknown as typeof window.dbzs;
});

describe("runtimeAgentStore", () => {
  it("hydrates persisted proposal and timeline state", async () => {
    const persisted = {
      pendingApproval: {
        id: "approval-1",
        runId: "run-1",
        stepId: "step-1",
        stepTitle: "Execute scoped changes",
        proposalFilePath: ".codee/runtime-agent-proposal.md",
        targetFilePath: "docs/RUNTIME_ARCHITECTURE_CODEE.md",
        summary: "Review runtime architecture",
        diff: "--- before\n+++ after",
        proposedContent: "# Runtime Change Proposal",
        createdAt: new Date().toISOString()
      },
      pendingApplyApproval: null,
      timeline: [
        {
          id: "timeline-1",
          title: "Approval angefordert",
          description: "Execute scoped changes",
          createdAt: new Date().toISOString()
        }
      ],
      lastResult: null,
      updatedAt: new Date().toISOString()
    };

    const useStore = createRuntimeAgentStore({
      createKernel: (requestPatchApproval) => createFakeKernel(requestPatchApproval, "completed"),
      loadPersistedState: async () => persisted
    });

    await useStore.getState().loadPersistedState("D:/repo");

    expect(useStore.getState().pendingApproval?.targetFilePath).toBe("docs/RUNTIME_ARCHITECTURE_CODEE.md");
    expect(useStore.getState().timeline).toHaveLength(1);
  });

  it("surfaces pending approval, materializes concrete changes and resumes after approve", async () => {
    const savedStates: string[] = [];
    const useStore = createRuntimeAgentStore({
      createKernel: (requestPatchApproval) => createFakeKernel(requestPatchApproval, "completed"),
      materializeApprovedProposal: async (approval, workspaceRoot) => [
        {
          id: "change-1",
          agentId: "runtime-agent",
          filePath: `${workspaceRoot}/docs/RUNTIME_ARCHITECTURE_CODEE.md`,
          proposedContent: `# Updated\n\n${approval.summary}`,
          reason: "Runtime Agent Follow-Apply",
          createdAt: new Date().toISOString(),
          status: "pending"
        }
      ],
      savePersistedState: async (_workspaceRoot, state) => {
        savedStates.push(`${state.pendingApproval ? "pending" : "clear"}:${state.timeline.length}`);
      }
    });

    const pendingRun = useStore.getState().runGoal("Review runtime architecture", "D:/repo");
    await waitFor(() => useStore.getState().pendingApproval !== null);

    expect(useStore.getState().pendingApproval?.targetFilePath).toBe("docs/RUNTIME_ARCHITECTURE_CODEE.md");

    await useStore.getState().approvePendingApproval();
    await pendingRun;

    expect(useStore.getState().lastResult?.status).toBe("completed");
    expect(useStore.getState().pendingApproval).toBeNull();
    expect(useStore.getState().pendingApplyApproval?.filePaths).toEqual([
      "D:/repo/docs/RUNTIME_ARCHITECTURE_CODEE.md"
    ]);
    expect(useEditorStore.getState().pendingChanges["D:/repo/docs/RUNTIME_ARCHITECTURE_CODEE.md"]?.source).toBe("agent");
    expect(savedStates.some((entry) => entry.startsWith("clear:"))).toBe(true);
  });

  it("applies materialized runtime-agent changes after apply approval", async () => {
    const applyPreparedChanges = async () => {
      await useEditorStore.getState().applyPendingChange("D:/repo/docs/RUNTIME_ARCHITECTURE_CODEE.md");
    };
    const useStore = createRuntimeAgentStore({
      createKernel: (requestPatchApproval) => createFakeKernel(requestPatchApproval, "completed"),
      materializeApprovedProposal: async (approval, workspaceRoot) => [
        {
          id: "change-1",
          agentId: "runtime-agent",
          filePath: `${workspaceRoot}/docs/RUNTIME_ARCHITECTURE_CODEE.md`,
          proposedContent: `# Updated\n\n${approval.summary}`,
          reason: "Runtime Agent Follow-Apply",
          createdAt: new Date().toISOString(),
          status: "pending"
        }
      ],
      applyPreparedChanges
    });

    const pendingRun = useStore.getState().runGoal("Apply runtime architecture change", "D:/repo");
    await waitFor(() => useStore.getState().pendingApproval !== null);
    await useStore.getState().approvePendingApproval();
    await pendingRun;

    await useStore.getState().approvePendingApplyApproval();

    expect(useStore.getState().pendingApplyApproval).toBeNull();
    expect(useEditorStore.getState().pendingChanges["D:/repo/docs/RUNTIME_ARCHITECTURE_CODEE.md"]).toBeUndefined();
  });

  it("marks the run as cancelled after reject", async () => {
    const useStore = createRuntimeAgentStore({
      createKernel: (requestPatchApproval) => createFakeKernel(requestPatchApproval, "completed")
    });

    const pendingRun = useStore.getState().runGoal("Reject runtime proposal", "D:/repo");
    await waitFor(() => useStore.getState().pendingApproval !== null);

    useStore.getState().rejectPendingApproval();
    await pendingRun;

    expect(useStore.getState().lastResult?.status).toBe("cancelled");
    expect(useStore.getState().timeline[0]?.title).toBe("Lauf beendet");
  });
});
