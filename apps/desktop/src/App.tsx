import { lazy, Suspense, type PointerEvent, useEffect, useState } from "react";
import {
  type BackendStartupStatus,
  type BootState,
  type PlannerPlan,
  type WorkspaceFile
} from "@dbzs/shared";
import { useRef } from "react";
import { useAgentRegistryStore } from "@/stores/agentRegistryStore";
import { useDocsAnalysisStore } from "@/stores/docsAnalysisStore";
import { useDebugAgentStore } from "@/stores/debugAgentStore";
import { useEditorStore, isFileEditorTab } from "@/stores/editorStore";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { ContextEngineService } from "@/services/contextEngineService";
import { codeIndexService } from "@/services/codeIndexService";
import { ContextRetrievalService } from "@/services/contextRetrievalService";
import { useProjectKnowledgeStore } from "@/stores/projectKnowledgeStore";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { PlannerAgentPanel } from "@/components/PlannerAgentPanel";
import { TaskOrchestratorPanel } from "@/components/TaskOrchestratorPanel";
import { AutonomousSessionPanel } from "@/components/AutonomousSessionPanel";
import { ReviewAgentPanel } from "@/components/ReviewAgentPanel";
import { GitPanel } from "@/components/GitPanel";
import { useTaskBoardStore } from "@/stores/taskBoardStore";
import { useTestAgentStore } from "@/stores/testAgentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useGitStore } from "@/stores/gitStore";
import { DebugAgentPanel } from "@/components/DebugAgentPanel";
import { DebugLogPanel } from "@/components/DebugLogPanel";
import { DiffPanel } from "@/components/DiffPanel";
import { FileToolsPanel } from "@/components/FileToolsPanel";
import { TerminalPanel } from "@/components/TerminalPanel";
import { BrowserFallback } from "@/components/BrowserFallback";
import { MissionControlPanel } from "@/components/MissionControlPanel";
import { OperationsNotebook } from "@/components/notebook/OperationsNotebook";
import { AgentWorkbench } from "@/components/agent-workbench/AgentWorkbench";
const EditorTabPanel = lazy(() =>
  import("@/components/notebook/EditorTabPanel").then((module) => ({ default: module.EditorTabPanel }))
);
import { RuntimeModelsTab } from "@/components/notebook/RuntimeModelsTab";
import { ModelLabTab } from "@/components/notebook/ModelLabTab";
import { JobsNotebookTab } from "@/components/notebook/JobsNotebookTab";
import { PlatformDiagnosticsPanel } from "@/components/PlatformDiagnosticsPanel";
import { ReviewGatePanel } from "@/components/ReviewGatePanel";
import { ToastContainer } from "@/components/ToastContainer";
import { CommandPalette } from "@/components/CommandPalette";
import { WorkspaceExplorer } from "@/components/WorkspaceExplorer";
import {
  AgentRegistryPanel as AppShellAgentRegistryPanel,
  DocsAnalysisPanel as AppShellDocsAnalysisPanel,
  ProjectMemoryPanel as AppShellProjectMemoryPanel,
  RuntimeChatDetachedPlaceholder as AppShellRuntimeChatDetachedPlaceholder,
  SettingsPanel as AppShellSettingsPanel,
  TestAgentPanel as AppShellTestAgentPanel
} from "@/components/appShellPanels";
import {
  AppShellFooter,
  AppShellRightSidebar
} from "@/components/appShellSections";
import {
  CollapsedPanelButton as AppShellCollapsedPanelButton,
  PanelHeader as AppShellPanelHeader,
  PanelTitle as AppShellPanelTitle,
  ResizeHandle as AppShellResizeHandle,
  StatusPill as AppShellStatusPill
} from "@/components/appShellPrimitives";
import { useAppMenuActions } from "@/hooks/useAppMenuActions";
import {
  useAppGridLayoutVars,
  useAppKeyboardShortcuts,
  useBackendLifecycleSync,
  useRuntimeChatWindowSync,
  useTrackedFrontendBoot,
  useWorkspaceProjectSync
} from "@/hooks/useAppShellLifecycle";
import { useJobSpoolerStore } from "@/stores/jobSpoolerStore";
import { useCommandPaletteStore } from "@/stores/commandPaletteStore";
import { useWorkbenchLayoutStore } from "@/stores/workbenchLayoutStore";
import { backendClient } from "@/services/backendClient";
import { backendUiStatus, formatBootStateForUi } from "@/services/bootUiFormatter";
import { RuntimeChatTab } from "@/components/RuntimeChatTab";
import type { RuntimeChatContextSnapshot } from "@/types/runtimeChatWindow";
import { readStandaloneView } from "@/utils/standaloneView";
import {
  closePlatformDiagnosticsWindow,
  openPlatformDiagnosticsWindow
} from "@/utils/platformDiagnosticsWindow";
import {
  openRuntimeChatWindow
} from "@/utils/runtimeChatWindow";
import { ActivityRail } from "@/components/workbench/ActivityRail";
import { WorkbenchStatusBadge } from "@/components/workbench/WorkbenchStatusBadge";
import { WorkbenchStatusBar } from "@/components/workbench/WorkbenchStatusBar";
import { WorkspaceSidebar } from "@/components/workbench/WorkspaceSidebar";
import { BottomDock } from "@/components/workbench/BottomDock";
import { useWorkbenchLayout } from "@/hooks/useWorkbenchLayout";
import { deriveWorkbenchStatus } from "@/hooks/useWorkbenchStatus";

const MIN_SIDE_PANEL_WIDTH = 220;
const MAX_SIDE_PANEL_WIDTH = 520;
const MIN_TERMINAL_HEIGHT = 128;
const MAX_TERMINAL_HEIGHT = 360;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hasElectronBridge(): boolean {
  return typeof window !== "undefined" && typeof window.dbzs !== "undefined";
}

function deriveBootAwareBackendStatus(
  bootState: BootState | null,
  backendStartupStatus: BackendStartupStatus | null
): BackendStartupStatus | null {
  if (!bootState) {
    return backendStartupStatus;
  }

  const port = backendStartupStatus?.port ?? 8876;
  const ownership = backendStartupStatus?.ownership ?? "unknown";
  const instanceId = backendStartupStatus?.instanceId ?? null;
  const currentPhase = bootState.phases.find((phase) => phase.id === bootState.currentPhaseId) ?? null;
  const backendLivePhase = bootState.phases.find((phase) => phase.id === "backend-live") ?? null;
  const backendReadyPhase = bootState.phases.find((phase) => phase.id === "backend-ready") ?? null;

  if (backendReadyPhase?.state === "success" || bootState.status === "ready") {
    return {
      state: "ready",
      message: backendReadyPhase?.message || "Backend vollständig bereit.",
      port,
      ownership,
      instanceId
    };
  }

  if (bootState.status === "degraded") {
    return {
      state: "degraded",
      message: backendReadyPhase?.message || "Backend bereit, aber mit eingeschränkten optionalen Komponenten.",
      port,
      ownership,
      instanceId
    };
  }

  if (
    bootState.status === "starting" &&
    (currentPhase != null ||
      backendLivePhase?.state === "running" ||
      backendLivePhase?.state === "waiting" ||
      backendLivePhase?.state === "success")
  ) {
    return {
      state: backendLivePhase?.state === "success" ? "live" : "starting",
      message:
        currentPhase?.message ||
        backendLivePhase?.message ||
        backendStartupStatus?.message ||
        "Backend startet…",
      port,
      ownership,
      instanceId
    };
  }

  return backendStartupStatus;
}

export function App() {
  if (!hasElectronBridge()) {
    return <BrowserFallback />;
  }

  return <AppShell />;
}

function AppShell() {
  useAppMenuActions();

  const { backendHealth, backendStartupStatus, error, isLoading, loadInitialState, setBackendStartupStatus, setError, settings } =
    useSettingsStore();

  const {
    activePendingChange,
    activeTab,
    applyPendingChange,
    closeTab,
    discardPendingChange,
    error: editorError,
    isBusy: editorBusy,
    openFile,
    openWorkspaceFile,
    proposedChanges,
    rejectProposedChange,
    restoreSnapshot,
    saveActiveFile,
    saveActiveFileAs,
    selectTab,
    tabs,
    updateActiveContent
  } = useEditorStore();
  const {
    error: modelIndexError,
    index: modelIndex,
    isLoading: modelIndexLoading,
    loadModelIndex,
    primaryCodingModel
  } = useModelIndexStore();
  const {
    error: runtimeError,
    isLoading: runtimeLoading,
    loadStatus: loadRuntimeStatus,
    startModel,
    status: runtimeStatus,
    stopModel
  } = useRuntimeStore();
  const { jobs, loadJobs } = useJobSpoolerStore();
  const {
    agents,
    createAgent,
    error: agentRegistryError,
    isLoading: agentRegistryLoading,
    isLoadingLogs: agentRegistryLoadingLogs,
    isMutating: agentRegistryMutating,
    loadAgents,
    loadSelectedAgentLogs,
    logs: agentLogs,
    deleteSelectedAgent,
    setSelectedAgentEnabled,
    selectAgent,
    selectedAgent,
    selectedAgentId,
    startSelectedAgent,
    stopSelectedAgent,
    updateAgent
  } = useAgentRegistryStore();
  const {
    addKnownIssue,
    addRecentTask,
    markImportantFile,
    memory: projectMemory,
    error: projectMemoryError,
    isLoading: projectMemoryLoading,
    isMutating: projectMemoryMutating,
    loadMemory: loadProjectMemory,
    refreshMemory: refreshProjectMemory,
    setDetectedWorkspaceData
  } = useProjectKnowledgeStore();
  const {
    createTask,
    deleteTask,
    error: taskBoardError,
    isLoading: taskBoardLoading,
    isMutating: taskBoardMutating,
    linkJob: linkJobToTask,
    loadTasks,
    moveTask,
    tasks,
    unlinkJob: unlinkJobFromTask
  } = useTaskBoardStore();
  const {
    error: workspaceError,
    files: workspaceFiles,
    hasLoadedState: workspaceStateLoaded,
    isLoading: workspaceLoading,
    loadWorkspaceState,
    openProjectDirectory,
    scanFiles,
    state: workspaceState,
    updateWorkspaceState
  } = useWorkspaceStore();
  const {
    analyze: analyzeDocs,
    error: docsAnalysisError,
    generate: generateDocs,
    isLoading: docsAnalysisLoading,
    markdown: docsMarkdown,
    setWorkspaceRoot: setDocsWorkspaceRoot,
    summary: docsSummary,
    workspaceRoot: docsWorkspaceRoot
  } = useDocsAnalysisStore();
  const {
    allowedCommands,
    currentRun: testAgentCurrentRun,
    error: testAgentError,
    history: testAgentHistory,
    loadAllowedCommands,
    logs: testAgentLogs,
    runCommand: runTestAgentCommand,
    runRecommendedChecks,
    stage: testAgentStage,
    stopCurrentRun,
    summary: testAgentSummary
  } = useTestAgentStore();
  const {
    currentBranch,
    repositoryStatus: gitRepositoryStatus,
    diffSummary: gitDiffSummary,
    selectedDiff: gitSelectedDiff,
    refreshGitStatus
  } = useGitStore();
  const {
    analyses: debugAnalyses,
    affectedFiles: debugAffectedFiles,
    error: debugAgentError,
    inspectLatestRun,
    isAnalyzing: debugIsAnalyzing,
    lastRun: debugLastRun,
    rawLogs: debugRawLogs,
    stderr: debugStderr,
    stdout: debugStdout,
    summary: debugSummary,
    generateFixSuggestions
  } = useDebugAgentStore();
  const [leftPanelWidth, setLeftPanelWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  const [terminalHeight, setTerminalHeight] = useState(188);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [rightSidebarMode, setRightSidebarMode] = useState<"agents" | "debug-log">("agents");
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [standaloneView, setStandaloneView] = useState(readStandaloneView);
  const [runtimeChatWindowOpen, setRuntimeChatWindowOpen] = useState(false);
  const [sharedChatContext, setSharedChatContext] = useState<RuntimeChatContextSnapshot | null>(null);
  const [bootState, setBootState] = useState<BootState | null>(null);
  const trackedFrontendBootRunRef = useRef<string | null>(null);
  const [plannerPlan, setPlannerPlan] = useState<PlannerPlan | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [relatedFileQuery, setRelatedFileQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ filePath: string; reason: string; matchedSymbols: string[]; score: number }>>([]);
  const [symbolResults, setSymbolResults] = useState<Array<{ filePath: string; reason: string; matchedSymbols: string[]; score: number }>>([]);
  const [relatedResults, setRelatedResults] = useState<Array<{ filePath: string; reason: string; matchedSymbols: string[]; score: number }>>([]);
  const [indexBuildBusy, setIndexBuildBusy] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const activeTrackedFrontendPhase = (() => {
    const trackedPhaseIds = new Set([
      "frontend-bridge",
      "frontend-config-sync",
      "workspace-restore",
      "agents-roles-models"
    ]);
    const current = bootState?.currentPhaseId
      ? bootState.phases.find((phase) => phase.id === bootState.currentPhaseId && trackedPhaseIds.has(phase.id))
      : null;
    if (current && (current.state === "running" || current.state === "retrying")) {
      return current;
    }
    return bootState?.phases.find((phase) => trackedPhaseIds.has(phase.id) && phase.state === "running") ?? null;
  })();
  const trackedFrontendPhaseKey = activeTrackedFrontendPhase
    ? `${activeTrackedFrontendPhase.id}:${activeTrackedFrontendPhase.retryCount}:${activeTrackedFrontendPhase.startedAt ?? 0}:${activeTrackedFrontendPhase.state}`
    : null;
  const contextEngine = projectMemory ? new ContextEngineService(projectMemory, workspaceFiles) : null;
  const retrievalService = new ContextRetrievalService(codeIndexService, projectMemory);
  const runtimeContextSummary = contextEngine ? contextEngine.buildAgentContext("coder") : null;
  const semanticContext = retrievalService.getRelevantContext("coder service implementation test review debug");
  const plannerRelevantFiles = retrievalService.getRelevantFiles("planner architecture task orchestration").map((entry) => entry.filePath);
  const debugRelevantFiles = retrievalService.getRelevantFiles("debug test runtime error typecheck").map((entry) => entry.filePath);
  const reviewRelevantFiles = retrievalService.getRelevantFiles("review quality risk regression security").map((entry) => entry.filePath);
  const runtimeContextHint = runtimeContextSummary
    ? [
        "[Project Memory]",
        runtimeContextSummary.projectSummary,
        `Known issues: ${runtimeContextSummary.knownIssues.map((issue) => issue.title).join(", ") || "keine"}`,
        `Relevant files: ${runtimeContextSummary.relevantFiles.slice(0, 12).join(", ") || "keine"}`
      ].join("\n")
    : null;
  const runtimeWorkspaceContext = workspaceState.projectPath
    ? {
        rootPath: workspaceState.projectPath,
        name: workspaceState.projectName ?? "Workspace",
        fileTree: runtimeContextSummary?.relevantFiles ?? semanticContext.files.map((entry) => entry.filePath).slice(0, 60),
        sampledFiles: (runtimeContextSummary?.relevantFiles ?? semanticContext.files.map((entry) => entry.filePath))
          .slice(0, 6)
          .map((relativePath) => {
            const descriptor = workspaceFiles.find((file) => file.relativePath === relativePath || file.path === relativePath);
            return {
              path: descriptor?.path ?? relativePath,
              relativePath: descriptor?.relativePath ?? relativePath,
              language: descriptor?.language ?? "text",
              content: ""
            };
          })
      }
    : null;

  const settingsOnlyMode = standaloneView === "settings";
  const runtimeChatOnlyMode = standaloneView === "runtime-chat";
  const platformDiagnosticsOnlyMode = standaloneView === "platform-diagnostics";
  const activeFileForChat =
    activeTab && isFileEditorTab(activeTab)
      ? activeTab
      : sharedChatContext?.activeFile ?? null;
  const chatWorkspaceRoot = runtimeChatOnlyMode
    ? sharedChatContext?.workspaceRoot ?? workspaceState.projectPath
    : workspaceState.projectPath;
  const chatWorkspaceName = runtimeChatOnlyMode
    ? sharedChatContext?.workspaceName ?? workspaceState.projectName
    : workspaceState.projectName;
  const chatWorkspaceFiles = runtimeChatOnlyMode
    ? sharedChatContext?.workspaceFiles ?? workspaceFiles
    : workspaceFiles;
  const chatContextHint = runtimeChatOnlyMode
    ? sharedChatContext?.contextHint ?? runtimeContextHint
    : runtimeContextHint;

  const effectiveBackendStartupStatus = deriveBootAwareBackendStatus(bootState, backendStartupStatus);

  useEffect(() => {
    if (!plannerPlan) {
      return;
    }

    void addRecentTask({
      id: plannerPlan.id,
      title: plannerPlan.goal,
      summary: plannerPlan.summary,
      affectedFiles: plannerPlan.tasks.flatMap((task) => task.affectedFiles).slice(0, 12),
      createdAt: plannerPlan.createdAt
    });
  }, [addRecentTask, plannerPlan]);

  const openCommandPalette = useCommandPaletteStore((s) => s.openPalette);
  const workbenchShellMode = useWorkbenchLayoutStore((state) => state.shellMode);
  const workbenchRailItem = useWorkbenchLayoutStore((state) => state.activeRailItem);
  const setWorkbenchShellMode = useWorkbenchLayoutStore((state) => state.setShellMode);
  const setWorkbenchRailItem = useWorkbenchLayoutStore((state) => state.setActiveRailItem);
  const workbenchActiveDockTab = useWorkbenchLayoutStore((state) => state.activeDockTab);
  const setWorkbenchDockTab = useWorkbenchLayoutStore((state) => state.setActiveDockTab);

  const wbLayout = useWorkbenchLayout();

  const handleOpenRuntimeChatWindow = async () => {
    try {
      await openRuntimeChatWindow();
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "Runtime-Chat-Fenster konnte nicht geoeffnet werden."
      );
    }
  };

  const backendOnline = backendHealth?.status === "ok";
  const openJobCount = jobs.filter((job) =>
    ["queued", "claimed", "waiting_verification"].includes(job.status)
  ).length;
  const runningJobCount = jobs.filter((job) => job.status === "running").length;
  const failedJobCount = jobs.filter((job) => job.status === "failed").length;
  const reloadBackend = async () => {
    try {
      setError(null);
      const reload = window.dbzs.reloadBackend;
      if (!reload) {
        throw new Error("reloadBackend is unavailable.");
      }
      await reload();
      await loadInitialState();
      await loadModelIndex();
      await loadRuntimeStatus();
      await loadTasks();
      await loadAgents();
      await loadJobs();
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : "Backend reload failed.");
    }
  };
  const backendStatusLabel = backendOnline
    ? "ok"
    : backendStartupStatus?.state === "starting"
      ? "startet..."
      : backendStartupStatus?.state === "failed"
        ? `offline (${backendStartupStatus.message ?? "Fehler"})`
        : "offline";
  const readyLocalModels =
    (modelIndex?.summary.llama_server_ready ?? 0) + (modelIndex?.summary.ollama_ready ?? 0);

  const { items: statusItems, workspaceLabel } = deriveWorkbenchStatus({
    backendStartupStatus: effectiveBackendStartupStatus,
    runtimeState: runtimeStatus?.state,
    runtimeProvider: runtimeStatus?.provider ?? null,
    readyLocalModels,
    totalModels: modelIndex?.summary.total,
    modelIndexLoading,
    workspaceName: workspaceState.projectName
  });
  const visibleLeftWidth = leftPanelCollapsed ? 44 : leftPanelWidth;
  const visibleRightWidth = rightPanelCollapsed ? 44 : rightPanelWidth;
  const visibleTerminalHeight = terminalCollapsed ? 42 : terminalHeight;
  const pendingProposedChanges = Object.values(proposedChanges)
    .filter((change) => change.status === "pending")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const appliedProposedChanges = Object.values(proposedChanges)
    .filter((change) => change.status === "applied")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const debugPendingProposedChanges = pendingProposedChanges.filter((change) => change.agentId === "debug-agent");
  const appliedProposedChangeSignature = appliedProposedChanges
    .map((change) => `${change.id}:${change.status}:${change.createdAt}`)
    .join("|");

  useEffect(() => {
    void inspectLatestRun({
      workspaceRoot: workspaceState.projectPath,
      workspaceFiles,
      projectMemory,
      runtimeStatus,
      commandRuns: [...testAgentHistory, ...(testAgentCurrentRun ? [testAgentCurrentRun] : [])],
      commandLogs: testAgentLogs,
      recentAppliedProposedChanges: appliedProposedChanges.slice(-5)
    });
  }, [
    appliedProposedChangeSignature,
    inspectLatestRun,
    runtimeStatus,
    testAgentCurrentRun,
    testAgentHistory,
    testAgentLogs,
    projectMemory,
    workspaceFiles,
    workspaceState.projectPath
  ]);

  useRuntimeChatWindowSync({
    activeTab: activeTab && isFileEditorTab(activeTab) ? activeTab : null,
    platformDiagnosticsOnlyMode,
    runtimeChatOnlyMode,
    settingsOnlyMode,
    runtimeContextHint,
    setBootState,
    setRuntimeChatWindowOpen,
    setSharedChatContext,
    workspaceFiles,
    workspaceProjectName: workspaceState.projectName,
    workspaceProjectPath: workspaceState.projectPath
  });

  useTrackedFrontendBoot({
    activeTrackedFrontendPhase,
    trackedFrontendPhaseKey,
    trackedFrontendBootRunRef,
    loadAgents,
    loadAllowedCommands,
    loadInitialState,
    loadJobs,
    loadModelIndex,
    loadRuntimeStatus,
    loadTasks,
    loadWorkspaceState
  });

  useBackendLifecycleSync({
    backendHealthStatus: backendHealth?.status,
    loadAgents,
    loadInitialState,
    loadJobs,
    loadModelIndex,
    loadProjectMemory,
    loadRuntimeStatus,
    loadTasks,
    refreshGitStatus,
    setBackendStartupStatus
  });

  useWorkspaceProjectSync({
    activeTab,
    loadProjectMemory,
    refreshGitStatus,
    setDetectedWorkspaceData,
    setDocsWorkspaceRoot,
    setIndexBuildBusy,
    setIndexError,
    settingsMaxFileScanCount: settings.maxFileScanCount,
    setStandaloneView,
    updateWorkspaceState,
    workspaceFiles,
    workspaceStateLoaded,
    workspaceProjectPath: workspaceState.projectPath
  });

  useAppKeyboardShortcuts({
    handleOpenRuntimeChatWindow,
    openCommandPalette,
    openFile,
    saveActiveFile,
    saveActiveFileAs
  });

  useAppGridLayoutVars(visibleLeftWidth, visibleRightWidth, visibleTerminalHeight);

  if (settingsOnlyMode) {
    return (
      <main className="h-screen overflow-y-auto bg-dbzs-bg px-6 py-6 text-dbzs-text">
        <div className="mx-auto max-w-4xl space-y-4">
          <AppShellPanelTitle title="Settings" description="Allgemein, Modelle, Backend, Agenten und Workspace" />
          <AppShellSettingsPanel compact={false} />
        </div>
      </main>
    );
  }

  if (runtimeChatOnlyMode) {
    return (
      <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-dbzs-bg text-dbzs-text">
        <RuntimeChatTab
          activeFile={activeFileForChat}
          contextHint={chatContextHint}
          detached
          status={runtimeStatus}
          backendStartupStatus={backendStartupStatus}
          workspaceFiles={chatWorkspaceFiles}
          workspaceName={chatWorkspaceName}
          workspaceRoot={chatWorkspaceRoot}
        />
      </main>
    );
  }

  if (platformDiagnosticsOnlyMode) {
    return (
      <main className="h-screen overflow-y-auto bg-dbzs-bg px-4 py-4 text-dbzs-text">
        <PlatformDiagnosticsPanel detached onClose={() => void closePlatformDiagnosticsWindow()} />
      </main>
    );
  }

  const startSidePanelResize =
    (side: "left" | "right") => (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = side === "left" ? leftPanelWidth : rightPanelWidth;

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth =
          side === "left"
            ? clamp(startWidth + delta, MIN_SIDE_PANEL_WIDTH, MAX_SIDE_PANEL_WIDTH)
            : clamp(startWidth - delta, MIN_SIDE_PANEL_WIDTH, MAX_SIDE_PANEL_WIDTH);

        if (side === "left") {
          setLeftPanelWidth(nextWidth);
        } else {
          setRightPanelWidth(nextWidth);
        }
      };

      const stopResize = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
    };

  const startTerminalResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = terminalHeight;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      setTerminalHeight(
        clamp(startHeight - (moveEvent.clientY - startY), MIN_TERMINAL_HEIGHT, MAX_TERMINAL_HEIGHT)
      );
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
  };

  return (
    <main
      className={`flex h-screen min-h-0 flex-col overflow-hidden bg-dbzs-bg text-dbzs-text ${
        workbenchShellMode === "neural-workbench" ? "dbzs-workbench-mode" : ""
      }`}
    >
      <div className="app-shell-grid grid min-h-0 flex-1 overflow-hidden">
        <header className="flex items-center justify-between border-b border-dbzs-border bg-dbzs-panel px-5">
          <div className="flex items-center gap-4">
            <div className="grid h-9 w-9 place-items-center border border-dbzs-cyan/50 bg-dbzs-cyan/10 text-sm font-semibold text-dbzs-cyan">
              D
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-normal">DBZS Code Assistant</h1>
              <p className="text-xs text-dbzs-muted">Lokale AI-Desktop-Foundation - Phase 1</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {workbenchShellMode === "neural-workbench" ? (
              <button
                className="hidden border border-dbzs-border bg-dbzs-panelSoft px-2.5 py-1 text-xs text-dbzs-muted hover:border-dbzs-cyan/50 hover:text-dbzs-cyan xl:inline-flex"
                onClick={openCommandPalette}
                type="button"
              >
                Quick Open <kbd className="ml-2 font-mono text-[10px]">Ctrl K</kbd>
              </button>
            ) : null}
            <button
              className="border border-dbzs-border bg-dbzs-panelSoft px-2.5 py-1 text-xs text-dbzs-muted hover:border-dbzs-cyan/50 hover:text-dbzs-cyan"
              onClick={() =>
                setWorkbenchShellMode(
                  workbenchShellMode === "neural-workbench" ? "classic" : "neural-workbench"
                )
              }
              type="button"
            >
              {workbenchShellMode === "neural-workbench" ? "Classic" : "Neural"}
            </button>
            <button
              className="flex items-center gap-1.5 rounded border border-dbzs-border bg-dbzs-panelSoft px-2.5 py-1 text-xs text-dbzs-muted hover:bg-dbzs-cyan/10 hover:text-dbzs-cyan hover:border-dbzs-cyan/30 transition-all mr-2"
              onClick={() => window.dbzs?.openSettingsWindow?.()}
              title="Einstellungen oeffnen (Ctrl+,)"
              type="button"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.991a6.936 6.936 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0Z" />
              </svg>
              <span>Einstellungen</span>
            </button>
            <AppShellStatusPill label="Desktop" tone="green" value="bereit" />
            <AppShellStatusPill
              label="Backend"
              tone={
                backendUiStatus(effectiveBackendStartupStatus) === "ready"
                  ? "green"
                  : backendUiStatus(effectiveBackendStartupStatus) === "starting" ||
                      backendUiStatus(effectiveBackendStartupStatus) === "degraded"
                    ? "amber"
                    : "red"
              }
              value={formatBootStateForUi(effectiveBackendStartupStatus).replace(/^Backend:\s*/, "")}
            />
            <AppShellStatusPill
              label="Modelle"
              tone={runtimeStatus?.state === "running" ? "green" : readyLocalModels ? "amber" : "red"}
              value={
                runtimeStatus?.state === "running"
                  ? `${runtimeStatus.provider ?? "runtime"} aktiv`
                  : modelIndex
                  ? `${readyLocalModels}/${modelIndex.summary.total} bereit`
                  : modelIndexLoading
                    ? "indexiere"
                    : "nicht geladen"
              }
            />
          </div>
        </header>

        <section className="app-main-grid grid min-h-0 overflow-hidden">
          {workbenchShellMode === "neural-workbench" ? (
            <ActivityRail
              activeItem={workbenchRailItem}
              branchLabel={currentBranch || gitRepositoryStatus?.currentBranch || "workspace"}
              onSelect={setWorkbenchRailItem}
            />
          ) : null}
          <aside className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-dbzs-border bg-dbzs-panel">
            {leftPanelCollapsed ? (
              <AppShellCollapsedPanelButton
                label="Workspace oeffnen"
                onClick={() => setLeftPanelCollapsed(false)}
                side="left"
              />
            ) : (
              <>
                <AppShellPanelHeader
                  description="Projekt, Dateien und Ordner verwalten."
                  onCollapse={() => setLeftPanelCollapsed(true)}
                  title="Workspace"
                />
                <div className="panel-scroll min-h-0">
                  <WorkspaceExplorer embeddedInPanel />
                {workspaceError ? (
                  <p className="border-t border-dbzs-border px-4 py-2 text-xs text-dbzs-red">{workspaceError}</p>
                ) : null}
                <details className="border-t border-dbzs-border px-4 py-2">
                  <summary className="cursor-pointer text-xs font-medium uppercase text-dbzs-muted">Semantic Search</summary>
                  <div className="mt-2 space-y-2 pb-2">
                    <p className="text-[11px] text-dbzs-muted">
                      Index: {indexBuildBusy ? "baue..." : `${codeIndexService.getIndexedFiles().length} Dateien`}.
                    </p>
                    {indexError ? <p className="text-[11px] text-dbzs-red">{indexError}</p> : null}
                    <input
                      className="w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
                      onChange={(event) => setSearchQuery(event.currentTarget.value)}
                      placeholder="Globale Code-Suche"
                      value={searchQuery}
                    />
                    <button
                      className="w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text"
                      onClick={() => setSearchResults(retrievalService.getRelevantFiles(searchQuery).slice(0, 10))}
                      type="button"
                    >
                      Suche ausfuehren
                    </button>
                    <div className="space-y-1">
                      {[...searchResults, ...symbolResults, ...relatedResults]
                        .slice(0, 8)
                        .map((result) => (
                          <button
                            className="w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-left"
                            key={`${result.filePath}:${result.reason}`}
                            onClick={() => {
                              const descriptor = workspaceFiles.find(
                                (file) => file.relativePath === result.filePath || file.path === result.filePath
                              );
                              void openWorkspaceFile(descriptor?.path ?? result.filePath);
                            }}
                            type="button"
                          >
                            <div className="truncate text-[11px] text-dbzs-text">{result.filePath}</div>
                          </button>
                        ))}
                    </div>
                  </div>
                </details>
                <div className="border-t border-dbzs-border px-4 py-2 pb-4">
                  <h3 className="text-xs font-medium uppercase text-dbzs-muted">Offene Dateien</h3>
                  <div className="mt-2 space-y-1">
                    {tabs.length === 0 ? (
                      <p className="text-xs leading-5 text-dbzs-muted">Noch keine Datei geoeffnet.</p>
                    ) : (
                      tabs.map((tab) => (
                        <button
                          className={`w-full border px-3 py-2 text-left text-xs ${
                            activeTab?.id === tab.id
                              ? "border-dbzs-cyan/60 bg-dbzs-cyan/10 text-dbzs-text"
                              : "border-dbzs-border bg-dbzs-panelSoft text-dbzs-muted"
                          }`}
                          key={tab.id}
                          onClick={() => selectTab(tab.id)}
                          type="button"
                        >
                          {tab.isDirty ? "* " : ""}
                          {tab.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
                </div>
              </>
            )}
            {!leftPanelCollapsed ? (
              <AppShellResizeHandle
                label="Workspace-Breite anpassen"
                onPointerDown={startSidePanelResize("left")}
                side="right"
              />
            ) : null}
          </aside>

          <OperationsNotebook
            editorTabHasFiles={tabs.some((tab) => tab.isDirty)}
            agentWorkbench={
              <AgentWorkbench
                onOpenFile={(filePath) => {
                  void openWorkspaceFile(filePath);
                }}
                workspaceName={workspaceState.projectName}
                workspaceRoot={workspaceState.projectPath}
              />
            }
            cdee={
              runtimeChatWindowOpen ? (
                <AppShellRuntimeChatDetachedPlaceholder onFocus={() => void handleOpenRuntimeChatWindow()} />
              ) : (
                <div className="h-full min-h-0 overflow-hidden p-2">
                  <RuntimeChatTab
                    activeFile={activeTab && isFileEditorTab(activeTab) ? activeTab : null}
                    contextHint={runtimeContextHint}
                    status={runtimeStatus}
                    backendStartupStatus={backendStartupStatus}
                    workspaceFiles={workspaceFiles}
                    workspaceName={workspaceState.projectName}
                    workspaceRoot={workspaceState.projectPath}
                  />
                </div>
              )
            }
            editor={
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center p-8 text-sm text-dbzs-muted">
                    Editor wird geladen ...
                  </div>
                }
              >
                <EditorTabPanel
                  activePendingChange={activePendingChange}
                  activeTab={activeTab && isFileEditorTab(activeTab) ? activeTab : null}
                  applyPendingChange={applyPendingChange}
                  closeTab={closeTab}
                  discardPendingChange={discardPendingChange}
                  editorBusy={editorBusy}
                  editorFontSize={settings.editorFontSize}
                  editorTheme={settings.theme}
                  openFile={openFile}
                  restoreSnapshot={restoreSnapshot}
                  saveActiveFile={saveActiveFile}
                  saveActiveFileAs={saveActiveFileAs}
                  selectTab={selectTab}
                  tabs={tabs.filter(isFileEditorTab)}
                  updateActiveContent={updateActiveContent}
                />
              </Suspense>
            }
            jobs={
              <JobsNotebookTab
                error={taskBoardError}
                isLoading={taskBoardLoading}
                isMutating={taskBoardMutating}
                onCreate={createTask}
                onDelete={deleteTask}
                onLinkJob={linkJobToTask}
                onMove={moveTask}
                onRefresh={loadTasks}
                onUnlinkJob={unlinkJobFromTask}
                tasks={tasks}
              />
            }
            missionControl={
              <div className="h-full min-h-0 overflow-y-auto">
                <MissionControlPanel
                  backendError={error}
                  backendOnline={backendOnline}
                  backendStartupStatus={backendStartupStatus}
                  electronBridgeActive={hasElectronBridge()}
                  failedJobCount={failedJobCount}
                  modelIndexError={modelIndexError}
                  modelIndexLoading={modelIndexLoading}
                  modelTotal={modelIndex?.summary.total ?? null}
                  onOpenWorkspace={() => void openProjectDirectory()}
                  onReloadBackend={() => void reloadBackend()}
                  onReloadModels={() => void loadModelIndex()}
                  onScanWorkspace={() => void scanFiles()}
                  onLoadGpu={() => backendClient.getGpuInfo().catch(() => null)}
                  onRunBenchmark={() => backendClient.runBenchmark().catch(() => null)}
                  onStopRuntime={() => void stopModel()}
                  openJobCount={openJobCount}
                  readyLlamaCount={modelIndex?.summary.llama_server_ready ?? 0}
                  readyModelCount={readyLocalModels}
                  readyOllamaCount={modelIndex?.summary.ollama_ready ?? 0}
                  runningJobCount={runningJobCount}
                  runtimeMessage={runtimeStatus?.message ?? null}
                  runtimeModelName={runtimeStatus?.model_name ?? runtimeStatus?.model_id ?? null}
                  runtimeState={runtimeStatus?.state ?? null}
                  workspaceFileCount={workspaceFiles.length}
                  workspaceName={workspaceState.projectName}
                  workspacePath={workspaceState.projectPath}
                />
              </div>
            }
            modelLab={<ModelLabTab />}
            runtime={<RuntimeModelsTab />}
          />

          <AppShellRightSidebar
            collapsed={rightPanelCollapsed}
            fillBody={rightSidebarMode === "debug-log"}
            modeToggle={
              <div className="flex border border-dbzs-border text-[10px]">
                <button
                  className={`flex-1 px-2 py-1 ${rightSidebarMode === "agents" ? "bg-dbzs-cyan/10 text-dbzs-cyan" : "text-dbzs-muted hover:text-dbzs-text"}`}
                  onClick={() => setRightSidebarMode("agents")}
                  type="button"
                >
                  Agents
                </button>
                <button
                  className={`flex-1 border-l border-dbzs-border px-2 py-1 ${rightSidebarMode === "debug-log" ? "bg-dbzs-cyan/10 text-dbzs-cyan" : "text-dbzs-muted hover:text-dbzs-text"}`}
                  onClick={() => setRightSidebarMode("debug-log")}
                  type="button"
                >
                  Debug Log
                </button>
              </div>
            }
            onCollapse={() => setRightPanelCollapsed(true)}
            onExpand={() => setRightPanelCollapsed(false)}
            onResize={startSidePanelResize("right")}
          >
            {rightSidebarMode === "debug-log" ? (
              <DebugLogPanel />
            ) : (
              <>
              <DebugAgentPanel
                analyses={debugAnalyses}
                affectedFiles={debugAffectedFiles}
                error={debugAgentError}
                generatedProposedChanges={debugPendingProposedChanges}
                isAnalyzing={debugIsAnalyzing}
                lastRun={debugLastRun}
                onApplyProposedChange={(filePath) => {
                  void applyPendingChange(filePath);
                }}
                onGenerateFixSuggestions={() => {
                  void generateFixSuggestions({
                    workspaceRoot: workspaceState.projectPath,
                    workspaceFiles,
                    projectMemory,
                    gitRepositoryStatus,
                    gitDiffSummary,
                    latestDiff: gitSelectedDiff,
                    relevantFiles: debugRelevantFiles,
                    runtimeStatus,
                    commandRuns: [...testAgentHistory, ...(testAgentCurrentRun ? [testAgentCurrentRun] : [])],
                    commandLogs: testAgentLogs,
                    recentAppliedProposedChanges: appliedProposedChanges.slice(-5)
                  });
                }}
                onRejectProposedChange={rejectProposedChange}
                onShowProposedDiff={(filePath) => {
                  void openWorkspaceFile(filePath);
                }}
                rawLogs={debugRawLogs}
                stdout={debugStdout}
                stderr={debugStderr}
                summary={debugSummary}
              />
              <PlannerAgentPanel
                agents={agents}
                onPlanCreated={setPlannerPlan}
                projectMemory={projectMemory}
                relevantFiles={plannerRelevantFiles}
                gitRepositoryStatus={gitRepositoryStatus}
                gitDiffSummary={gitDiffSummary}
                workspaceFiles={workspaceFiles}
                workspaceName={workspaceState.projectName}
                workspaceRoot={workspaceState.projectPath}
              />
              <TaskOrchestratorPanel
                appliedChanges={appliedProposedChanges}
                latestTestRun={testAgentCurrentRun}
                pendingChanges={pendingProposedChanges}
                plannerPlan={plannerPlan}
              />
              <AutonomousSessionPanel
                appliedChanges={appliedProposedChanges}
                latestTestRun={testAgentCurrentRun}
                pendingChanges={pendingProposedChanges}
                plannerPlan={plannerPlan}
                workspaceFiles={workspaceFiles}
                workspaceName={workspaceState.projectName}
                workspaceRoot={workspaceState.projectPath}
              />
              <ReviewAgentPanel
                pendingChanges={pendingProposedChanges}
                appliedChanges={appliedProposedChanges}
                projectMemory={projectMemory}
                relevantFiles={reviewRelevantFiles}
                gitRepositoryStatus={gitRepositoryStatus}
                gitDiffSummary={gitDiffSummary}
              />
              <AppShellTestAgentPanel
                allowedCommands={allowedCommands}
                currentRun={testAgentCurrentRun}
                error={testAgentError}
                logs={testAgentLogs}
                onRunCommand={(commandId) => {
                  if (!workspaceState.projectPath) {
                    return;
                  }
                  void runTestAgentCommand(workspaceState.projectPath, commandId);
                }}
                onRunRecommended={() => {
                  if (!workspaceState.projectPath) {
                    return;
                  }
                  void runRecommendedChecks(workspaceState.projectPath, workspaceFiles);
                }}
                onStop={() => {
                  void stopCurrentRun();
                }}
                stage={testAgentStage}
                summary={testAgentSummary}
              />
              <AppShellAgentRegistryPanel
                agents={agents}
                createAgent={createAgent}
                pendingProposedChanges={pendingProposedChanges}
                isLoading={agentRegistryLoading}
                isLoadingLogs={agentRegistryLoadingLogs}
                isMutating={agentRegistryMutating}
                logs={agentLogs}
                onApplyProposedChange={(filePath) => {
                  void applyPendingChange(filePath);
                }}
                onShowProposedDiff={(filePath) => {
                  void openWorkspaceFile(filePath);
                }}
                onRejectProposedChange={rejectProposedChange}
                deleteSelectedAgent={deleteSelectedAgent}
                loadSelectedAgentLogs={loadSelectedAgentLogs}
                onRefresh={loadAgents}
                onSelect={selectAgent}
                selectedAgent={selectedAgent}
                selectedAgentId={selectedAgentId}
                setSelectedAgentEnabled={setSelectedAgentEnabled}
                startSelectedAgent={startSelectedAgent}
                stopSelectedAgent={stopSelectedAgent}
                updateAgent={updateAgent}
              />
              <AppShellProjectMemoryPanel
                error={projectMemoryError}
                isLoading={projectMemoryLoading}
                isMutating={projectMemoryMutating}
                memory={projectMemory}
                onAddKnownIssue={addKnownIssue}
                onAddRecentTask={addRecentTask}
                onMarkImportantFile={markImportantFile}
                onRefresh={refreshProjectMemory}
              />
              <ReviewGatePanel />
              <AppShellDocsAnalysisPanel
                error={docsAnalysisError}
                isLoading={docsAnalysisLoading}
                markdown={docsMarkdown}
                onAnalyze={analyzeDocs}
                onGenerate={generateDocs}
                setWorkspaceRoot={setDocsWorkspaceRoot}
                summary={docsSummary}
                workspaceRoot={docsWorkspaceRoot}
              />
              <TerminalPanel />
              <DiffPanel />
              <FileToolsPanel />
              <AppShellSettingsPanel compact />
              </>
            )}
          </AppShellRightSidebar>
        </section>

        <AppShellFooter
          onResize={startTerminalResize}
          onToggleTerminal={() => setTerminalCollapsed((value) => !value)}
          rightPanelCollapsed={rightPanelCollapsed}
          systemLoading={isLoading}
          terminalCollapsed={terminalCollapsed}
          terminalContent={(
            <div className="panel-scroll mx-4 space-y-3 pb-3">
              <div className="border border-dbzs-border bg-[#05080c] p-3 font-mono text-xs text-dbzs-muted">
                <p>{">"} DBZS Phase 1 gestartet</p>
                <p>{">"} Backend Health: {backendStatusLabel}</p>
                {error ? <p className="text-dbzs-red">{">"} Fehler: {error}</p> : null}
                {editorError ? <p className="text-dbzs-red">{">"} Editor: {editorError}</p> : null}
                {modelIndexError ? <p className="text-dbzs-red">{">"} Modelle: {modelIndexError}</p> : null}
                {runtimeError ? <p className="text-dbzs-red">{">"} Runtime: {runtimeError}</p> : null}
                {agentRegistryError ? <p className="text-dbzs-red">{">"} Agents: {agentRegistryError}</p> : null}
                {projectMemoryError ? <p className="text-dbzs-red">{">"} Memory: {projectMemoryError}</p> : null}
                {taskBoardError ? <p className="text-dbzs-red">{">"} Tasks: {taskBoardError}</p> : null}
                {docsAnalysisError ? <p className="text-dbzs-red">{">"} Docs: {docsAnalysisError}</p> : null}
              </div>
              <GitPanel />
            </div>
          )}
        />
        {workbenchShellMode === "neural-workbench" ? (
          <WorkbenchStatusBar items={statusItems} workspaceLabel={workspaceLabel} />
        ) : null}
      </div>
      <ToastContainer />
      <CommandPalette />
    </main>
  );
}
