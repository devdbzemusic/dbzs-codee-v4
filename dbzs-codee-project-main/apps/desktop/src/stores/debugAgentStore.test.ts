import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "./editorStore";
import { useDebugAgentStore } from "./debugAgentStore";

const debugSendChatMock = vi.fn().mockResolvedValue({
  message: {
    role: "assistant",
    content: JSON.stringify({
      changes: [
        {
          filePath: "apps/desktop/src/App.tsx",
          proposedContent: "export function App() { return null; }\n",
          reason: "Fix missing import"
        }
      ]
    })
  },
  model_id: "debugger",
  model_name: "Debugger"
});

vi.mock("@/services/agentRunService", () => ({
  agentRunService: {
    sendChat: (...args: unknown[]) => debugSendChatMock(...args)
  }
}));

beforeEach(() => {
  debugSendChatMock.mockClear();
  useDebugAgentStore.setState({
    analyses: [],
    summary: "",
    affectedFiles: [],
    rawLogs: "",
    stdout: "",
    stderr: "",
    lastRun: null,
    generatedProposedChanges: [],
    isAnalyzing: false,
    error: null
  });

  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    isBusy: false,
    error: null,
    snapshots: {},
    pendingChanges: {},
    proposedChanges: {},
    appliedChanges: [],
    activePendingChange: null
  });

  window.dbzs = {
    getAppInfo: vi.fn(),
    getBackendHealth: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    openFileDialog: vi.fn(),
    saveFile: vi.fn(),
    createWorkspaceFileSnapshot: vi.fn().mockResolvedValue({
      snapshotId: "snap-1",
      filePath: "D:/Dev/repo/dbzs-codee/apps/desktop/src/App.tsx",
      existed: true
    }),
    createWorkspaceDiff: vi.fn().mockResolvedValue({
      snapshotId: "snap-1",
      beforeContent: "old",
      afterContent: "new",
      diff: "--- before\n+++ after\n-old\n+new"
    }),
    applyWorkspacePatch: vi.fn(),
    restoreWorkspaceSnapshot: vi.fn(),
    getModelIndex: vi.fn(),
    getRuntimeStatus: vi.fn(),
    startRuntimeModel: vi.fn(),
    stopRuntimeModel: vi.fn(),
    sendRuntimeChat: vi.fn().mockResolvedValue({
      message: {
        role: "assistant",
        content: JSON.stringify({
          changes: [
            {
              filePath: "apps/desktop/src/App.tsx",
              proposedContent: "export const App = () => null;",
              reason: "TS2304 beheben"
            }
          ]
        })
      },
      model_id: "coder",
      model_name: "Coder"
    }),
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
    readProjectFile: vi.fn().mockResolvedValue({
      path: "D:/Dev/repo/dbzs-codee/apps/desktop/src/App.tsx",
      name: "App.tsx",
      content: "export function App() { return null; }",
      language: "tsx"
    })
  };
});

describe("useDebugAgentStore", () => {
  it("speichert DebugAnalysen aus den letzten Logs", async () => {
    await useDebugAgentStore.getState().inspectLatestRun({
      workspaceRoot: "D:/Dev/repo/dbzs-codee",
      workspaceFiles: [
        {
          path: "D:/Dev/repo/dbzs-codee/apps/desktop/src/App.tsx",
          relativePath: "apps/desktop/src/App.tsx",
          name: "App.tsx",
          language: "tsx"
        }
      ],
      runtimeStatus: {
        state: "running",
        provider: "llama.cpp",
        model_id: "coder",
        model_name: "Coder",
        port: 8081,
        pid: 42,
        endpoint: "http://127.0.0.1:8081",
        message: ""
      },
      commandRuns: [
        {
          runId: "run-1",
          commandId: "pnpm_typecheck",
          label: "Typecheck",
          status: "failed",
          exitCode: 1,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          timedOut: false,
          cancelled: false
        }
      ],
      commandLogs: {
        runId: "run-1",
        stdout: "src/App.tsx(12,3): error TS2304: Cannot find name 'DebugPanel'.",
        stderr: "",
      },
      recentAppliedProposedChanges: []
    });

    const state = useDebugAgentStore.getState();
    expect(state.analyses).toHaveLength(1);
    expect(state.summary).toContain("TS2304");
    expect(state.affectedFiles).toContain("src/App.tsx");
  });

  it("erzeugt sichere ProposedChanges aus einer Debug-Analyse", async () => {
    await useDebugAgentStore.getState().generateFixSuggestions({
      workspaceRoot: "D:/Dev/repo/dbzs-codee",
      workspaceFiles: [
        {
          path: "D:/Dev/repo/dbzs-codee/apps/desktop/src/App.tsx",
          relativePath: "apps/desktop/src/App.tsx",
          name: "App.tsx",
          language: "tsx"
        }
      ],
      runtimeStatus: {
        state: "running",
        provider: "llama.cpp",
        model_id: "coder",
        model_name: "Coder",
        port: 8081,
        pid: 42,
        endpoint: "http://127.0.0.1:8081",
        message: ""
      },
      commandRuns: [
        {
          runId: "run-1",
          commandId: "pnpm_typecheck",
          label: "Typecheck",
          status: "failed",
          exitCode: 1,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          timedOut: false,
          cancelled: false
        }
      ],
      commandLogs: {
        runId: "run-1",
        stdout: "src/App.tsx(12,3): error TS2304: Cannot find name 'DebugPanel'.",
        stderr: ""
      },
      recentAppliedProposedChanges: []
    });

    expect(debugSendChatMock).toHaveBeenCalled();
    expect(useDebugAgentStore.getState().generatedProposedChanges).toHaveLength(1);
    expect(useEditorStore.getState().pendingChanges["D:/Dev/repo/dbzs-codee/apps/desktop/src/App.tsx"]?.source).toBe("agent");
  });
});