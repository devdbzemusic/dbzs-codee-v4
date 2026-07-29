import type {
  AgentCreateRequest,
  AgentHealthInfo,
  BenchmarkResult,
  ModelDownloadTask,
  AgentLogEntry,
  AgentRecord,
  AgentRunOnceRequest,
  AgentRunResult,
  AgentRunnerStatus,
  AgentUpdateRequest,
  CommitAssistantContext,
  CommitMessageSuggestion,
  CommitRequest,
  CommitResult,
  RestorePoint,
  RestorePointReason,
  RestoreResult,
  DocsAnalysisSummary,
  DocsGenerateRequest,
  DocsGenerateResponse,
  AppInfo,
  AppSettings,
  SettingsDiagnostics,
  SettingsPatchRequest,
  SettingsPatchResponse,
  BackendHealth,
  GpuInfo,
  ManualMultimodalPairingRequest,
  ModelIndex,
  MultimodalPair,
  JobArtifact,
  JobArtifactCreateRequest,
  JobClaimRequest,
  JobClaimResponse,
  JobDetail,
  JobEnqueueRequest,
  JobEvent,
  JobRecord,
  JobStatus,
  JobVerification,
  JobVerifyRequest,
  JobWaypointRequest,
  ProjectMemoryEntry,
  ProjectMemoryUpsertRequest,
  RuntimeChatRequest,
  RuntimeChatResponse,
  RuntimeDoctorReport,
  RuntimeDryRunRequest,
  RuntimeDryRunResponse,
  RuntimeLogsResponse,
  RuntimeProbeRequest,
  RuntimeProbeResponse,
  RuntimeStatus,
  GitCommitSuggestion,
  GitDiffSummary,
  GitRepositoryStatus,
  GitStatusEntry,
  TaskBoardItem,
  TaskCreateRequest,
  TaskUpdateRequest,
  ProjectCreationResult,
  WorkspaceFile,
  WorkspaceProjectFile,
  WorkspaceState
} from "@dbzs/shared";
import type { RuntimeChatContextSnapshot } from "@/types/runtimeChatWindow";
import { combineAbortSignals } from "@/services/abortSignals";
import { runClientModelTest } from "@/services/runtimeModelTestService";

export interface BackendBridge {
  getAppInfo: () => Promise<AppInfo>;
  getBackendHealth: () => Promise<BackendHealth>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: AppSettings) => Promise<AppSettings>;
  patchSettings?: (request: SettingsPatchRequest) => Promise<SettingsPatchResponse>;
  getSettingsDiagnostics?: () => Promise<SettingsDiagnostics>;
  selectProjectDirectory?: () => Promise<{ projectPath: string; projectName: string } | null>;
  createNewProject?: () => Promise<ProjectCreationResult | null>;
  scanProjectFiles?: (projectPath: string) => Promise<WorkspaceProjectFile[]>;
  readProjectFile?: (filePath: string) => Promise<WorkspaceFile | null>;
  writeProjectFile?: (filePath: string, content: string) => Promise<WorkspaceFile>;
  createWorkspaceFolder?: (folderPath: string) => Promise<{ path: string }>;
  getWorkspaceState?: () => Promise<WorkspaceState>;
  setWorkspaceState?: (state: WorkspaceState) => Promise<WorkspaceState>;
  openSettingsWindow?: () => Promise<{ status: string }>;
  openRuntimeChatWindow?: () => Promise<{ status: string }>;
  closeRuntimeChatWindow?: () => Promise<{ status: string }>;
  openPlatformDiagnosticsWindow?: () => Promise<{ status: string }>;
  closePlatformDiagnosticsWindow?: () => Promise<{ status: string }>;
  publishRuntimeChatContext?: (context: RuntimeChatContextSnapshot) => Promise<{ status: string }>;
  getRuntimeChatContext?: () => Promise<RuntimeChatContextSnapshot | null>;
  onRuntimeChatWindowState?: (listener: (state: import("@/types/runtimeChatWindow").RuntimeChatWindowState) => void) => () => void;
  onRuntimeChatContext?: (listener: (context: RuntimeChatContextSnapshot | null) => void) => () => void;
  getModelIndex: () => Promise<ModelIndex>;
  saveManualMultimodalPairing?: (request: ManualMultimodalPairingRequest) => Promise<MultimodalPair>;
  getRuntimeStatus: () => Promise<RuntimeStatus>;
  startRuntimeModel: (modelId: string) => Promise<RuntimeStatus>;
  stopRuntimeModel: () => Promise<RuntimeStatus>;
  getRuntimeDoctor?: () => Promise<RuntimeDoctorReport>;
  dryRunRuntimeModel?: (payload: RuntimeDryRunRequest) => Promise<RuntimeDryRunResponse>;
  probeRuntimeModel?: (payload: RuntimeProbeRequest) => Promise<RuntimeProbeResponse>;
  getRuntimeLogs?: () => Promise<RuntimeLogsResponse>;
  sendRuntimeChat: (request: RuntimeChatRequest, requestId?: string) => Promise<RuntimeChatResponse>;
  cancelRuntimeChat?: (requestId: string) => Promise<{ status: string }>;
  streamRuntimeChat?: (
    request: RuntimeChatRequest,
    onChunk: (payload: { delta: string; totalLength: number }) => void
  ) => Promise<RuntimeChatResponse>;
  cancelRuntimeChatStream?: () => Promise<{ status: string }>;
  listAgents: () => Promise<AgentRecord[]>;
  getAgent: (agentId: string) => Promise<AgentRecord>;
  createAgent: (request: AgentCreateRequest) => Promise<AgentRecord>;
  updateAgent: (agentId: string, request: AgentUpdateRequest) => Promise<AgentRecord>;
  startAgent: (agentId: string) => Promise<AgentRecord>;
  stopAgent: (agentId: string) => Promise<AgentRecord>;
  deleteAgent: (agentId: string) => Promise<{ status: string; agent_id: string }>;
  listAgentLogs: (agentId: string, limit?: number) => Promise<AgentLogEntry[]>;
  startEnabledAgents?: () => Promise<{ started: string[]; skipped: string[]; failed: string[] }>;
  listJobs?: (status?: JobStatus, limit?: number) => Promise<JobRecord[]>;
  enqueueJob?: (request: JobEnqueueRequest) => Promise<JobRecord>;
  claimNextJob?: (request: JobClaimRequest) => Promise<JobClaimResponse>;
  getJobDetail?: (jobId: string) => Promise<JobDetail>;
  addJobWaypoint?: (jobId: string, request: JobWaypointRequest) => Promise<JobEvent>;
  addJobArtifact?: (jobId: string, request: JobArtifactCreateRequest) => Promise<JobArtifact>;
  verifyJob?: (jobId: string, request: JobVerifyRequest) => Promise<JobVerification>;
  requeueStaleJobs?: () => Promise<{ requeued: number }>;
  clearAllJobs?: () => Promise<{ deleted: number }>;
  pruneFinishedJobs?: () => Promise<{ deleted: number }>;
  listJobTrajectory?: (jobId: string) => Promise<unknown>;
  listRecentTrajectories?: (limit?: number) => Promise<unknown>;
  getAgentRunnerStatus?: () => Promise<AgentRunnerStatus>;
  runAgentOnce?: (request: AgentRunOnceRequest) => Promise<AgentRunResult>;
  getGitRepositoryStatus?: (workspaceRoot: string) => Promise<GitRepositoryStatus>;
  getGitCurrentBranch?: (workspaceRoot: string) => Promise<string>;
  getGitChangedFiles?: (workspaceRoot: string) => Promise<GitStatusEntry[]>;
  getGitDiff?: (workspaceRoot: string, filePath?: string) => Promise<string>;
  getGitDiffSummary?: (workspaceRoot: string) => Promise<GitDiffSummary[]>;
  getGitCommitSuggestion?: (workspaceRoot: string) => Promise<GitCommitSuggestion | null>;
  validateGitRepository?: (workspaceRoot: string) => Promise<boolean>;
  suggestCommitMessages?: (workspaceRoot: string, context?: CommitAssistantContext) => Promise<CommitMessageSuggestion[]>;
  validateCommitRequest?: (workspaceRoot: string, request: CommitRequest) => Promise<{ valid: boolean }>;
  createCommit?: (workspaceRoot: string, request: CommitRequest) => Promise<CommitResult>;
  createRestorePoint?: (
    workspaceRoot: string,
    filePaths: string[],
    reason: RestorePointReason,
    label: string,
    options?: { relatedRunId?: string; relatedChangeIds?: string[] }
  ) => Promise<RestorePoint>;
  listRestorePoints?: (workspaceRoot: string) => Promise<RestorePoint[]>;
  restorePoint?: (workspaceRoot: string, restorePointId: string) => Promise<RestoreResult>;
  deleteRestorePoint?: (workspaceRoot: string, restorePointId: string) => Promise<{ deleted: boolean }>;
  cleanupRestorePoints?: (workspaceRoot: string) => Promise<{ removed: string[] }>;
  listProjectMemory: (workspace: string) => Promise<ProjectMemoryEntry[]>;
  upsertProjectMemory: (request: ProjectMemoryUpsertRequest) => Promise<ProjectMemoryEntry>;
  deleteProjectMemory: (entryId: number) => Promise<{ status: string; id: number }>;
  listTasks: () => Promise<TaskBoardItem[]>;
  createTask: (request: TaskCreateRequest) => Promise<TaskBoardItem>;
  updateTask: (taskId: string, request: TaskUpdateRequest) => Promise<TaskBoardItem>;
  deleteTask: (taskId: string) => Promise<{ status: string }>;
  analyzeDocs: (workspaceRoot: string, maxFiles?: number) => Promise<DocsAnalysisSummary>;
  generateDocs: (request: DocsGenerateRequest) => Promise<DocsGenerateResponse>;
  restartFrontend?: () => Promise<{ status: string; windows: number }>;
  getAgentHealth?: (agentId: string) => Promise<AgentHealthInfo>;
  getGpuInfo?: () => Promise<GpuInfo>;
  linkJobToTask?: (taskId: string, jobId: string) => Promise<TaskBoardItem>;
  unlinkJobFromTask?: (taskId: string, jobId: string) => Promise<TaskBoardItem>;
  runBenchmark?: () => Promise<BenchmarkResult>;
  runModelTest?: () => Promise<import("@dbzs/shared").RuntimeModelTestReport>;
  startModelDownload?: (request: { repo_id: string; filename: string; dest_dir: string }) => Promise<ModelDownloadTask>;
  getModelDownloadStatus?: (taskId: string) => Promise<ModelDownloadTask>;
  listModelDownloads?: () => Promise<ModelDownloadTask[]>;
  listOrchestrationTools?: () => Promise<unknown>;
  prepareOrchestrationContext?: (request: unknown) => Promise<unknown>;
  executeOrchestrationTool?: (request: unknown) => Promise<unknown>;
}

function bridge(): BackendBridge {
  if (!window.dbzs) {
    throw new Error("DBZS preload bridge is unavailable.");
  }

  return window.dbzs;
}

export const backendClient = {
  getAppInfo: () => bridge().getAppInfo(),
  getBackendHealth: () => bridge().getBackendHealth(),
  getSettings: () => bridge().getSettings(),
  updateSettings: (settings: AppSettings) => bridge().updateSettings(settings),
  patchSettings: (request: SettingsPatchRequest) => {
    const patch = bridge().patchSettings;
    if (!patch) {
      return Promise.reject(new Error("patchSettings is unavailable."));
    }
    return patch(request);
  },
  getSettingsDiagnostics: () => {
    const load = bridge().getSettingsDiagnostics;
    if (!load) {
      return Promise.reject(new Error("getSettingsDiagnostics is unavailable."));
    }
    return load();
  },
  selectProjectDirectory: () => {
    const method = bridge().selectProjectDirectory;
    if (!method) {
      return Promise.reject(new Error("selectProjectDirectory is unavailable."));
    }
    return method();
  },
  createNewProject: () => {
    const method = bridge().createNewProject;
    if (!method) {
      return Promise.reject(new Error("createNewProject is unavailable."));
    }
    return method();
  },
  scanProjectFiles: (projectPath: string) => {
    const method = bridge().scanProjectFiles;
    if (!method) {
      return Promise.reject(new Error("scanProjectFiles is unavailable."));
    }
    return method(projectPath);
  },
  readProjectFile: (filePath: string) => {
    const method = bridge().readProjectFile;
    if (!method) {
      return Promise.reject(new Error("readProjectFile is unavailable."));
    }
    return method(filePath);
  },
  writeProjectFile: (filePath: string, content: string) => {
    const method = bridge().writeProjectFile;
    if (!method) {
      return Promise.reject(new Error("writeProjectFile is unavailable."));
    }
    return method(filePath, content);
  },
  createWorkspaceFolder: (folderPath: string) => {
    const method = bridge().createWorkspaceFolder;
    if (!method) {
      return Promise.reject(new Error("createWorkspaceFolder is unavailable."));
    }
    return method(folderPath);
  },
  getWorkspaceState: () => {
    const method = bridge().getWorkspaceState;
    if (!method) {
      return Promise.reject(new Error("getWorkspaceState is unavailable."));
    }
    return method();
  },
  setWorkspaceState: (state: WorkspaceState) => {
    const method = bridge().setWorkspaceState;
    if (!method) {
      return Promise.reject(new Error("setWorkspaceState is unavailable."));
    }
    return method(state);
  },
  openSettingsWindow: () => {
    const method = bridge().openSettingsWindow;
    if (!method) {
      return Promise.reject(new Error("openSettingsWindow is unavailable."));
    }
    return method();
  },
  openRuntimeChatWindow: () => {
    const method = bridge().openRuntimeChatWindow;
    if (!method) {
      return Promise.reject(new Error("openRuntimeChatWindow is unavailable."));
    }
    return method();
  },
  closeRuntimeChatWindow: () => {
    const method = bridge().closeRuntimeChatWindow;
    if (!method) {
      return Promise.reject(new Error("closeRuntimeChatWindow is unavailable."));
    }
    return method();
  },
  openPlatformDiagnosticsWindow: () => {
    const method = bridge().openPlatformDiagnosticsWindow;
    if (!method) {
      return Promise.reject(new Error("openPlatformDiagnosticsWindow is unavailable."));
    }
    return method();
  },
  closePlatformDiagnosticsWindow: () => {
    const method = bridge().closePlatformDiagnosticsWindow;
    if (!method) {
      return Promise.reject(new Error("closePlatformDiagnosticsWindow is unavailable."));
    }
    return method();
  },
  publishRuntimeChatContext: (context: RuntimeChatContextSnapshot) => {
    const method = bridge().publishRuntimeChatContext;
    if (!method) {
      return Promise.reject(new Error("publishRuntimeChatContext is unavailable."));
    }
    return method(context);
  },
  getRuntimeChatContext: () => {
    const method = bridge().getRuntimeChatContext;
    if (!method) {
      return Promise.reject(new Error("getRuntimeChatContext is unavailable."));
    }
    return method();
  },
  getModelIndex: () => bridge().getModelIndex(),
  saveManualMultimodalPairing: (request: ManualMultimodalPairingRequest) => {
    const method = bridge().saveManualMultimodalPairing;
    if (!method) {
      return Promise.reject(new Error("saveManualMultimodalPairing is unavailable."));
    }
    return method(request);
  },
  getRuntimeStatus: () => bridge().getRuntimeStatus(),
  startRuntimeModel: (modelId: string) => bridge().startRuntimeModel(modelId),
  stopRuntimeModel: () => bridge().stopRuntimeModel(),
  getRuntimeDoctor: () => {
    const method = bridge().getRuntimeDoctor;
    if (!method) {
      return Promise.reject(new Error("getRuntimeDoctor is unavailable."));
    }
    return method();
  },
  dryRunRuntimeModel: (payload: RuntimeDryRunRequest) => {
    const method = bridge().dryRunRuntimeModel;
    if (!method) {
      return Promise.reject(new Error("dryRunRuntimeModel is unavailable."));
    }
    return method(payload);
  },
  probeRuntimeModel: (payload: RuntimeProbeRequest) => {
    const method = bridge().probeRuntimeModel;
    if (!method) {
      return Promise.reject(new Error("probeRuntimeModel is unavailable."));
    }
    return method(payload);
  },
  getRuntimeLogs: () => {
    const method = bridge().getRuntimeLogs;
    if (!method) {
      return Promise.reject(new Error("getRuntimeLogs is unavailable."));
    }
    return method();
  },
  sendRuntimeChat: (request: RuntimeChatRequest, signal?: AbortSignal) => {
    const requestId = crypto.randomUUID();

    const endpointTimeout = 60_000;
    let timeoutController: AbortController | undefined;
    let timeoutSignal: AbortSignal | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (endpointTimeout > 0) {
      timeoutController = new AbortController();
      timeoutId = setTimeout(() => {
        timeoutController?.abort(new Error(`Runtime chat timeout after ${endpointTimeout}ms`));
      }, endpointTimeout);
      timeoutSignal = timeoutController.signal;
    }

    const combined = combineAbortSignals([signal, timeoutSignal]);

    let abortListener: ((this: AbortSignal) => void) | undefined;
    if (combined.signal.aborted) {
      if (timeoutId) clearTimeout(timeoutId);
      combined.cleanup();
      return Promise.reject(combined.signal.reason ?? new DOMException("Aborted", "AbortError"));
    }

    abortListener = function() {
      void bridge().cancelRuntimeChat?.(requestId);
    };
    combined.signal.addEventListener("abort", abortListener, { once: true });

    const promise = bridge().sendRuntimeChat(request, requestId);

    return promise.finally(() => {
      if (abortListener) {
        combined.signal.removeEventListener("abort", abortListener);
      }
      combined.cleanup();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (combined.signal.aborted) {
        bridge().cancelRuntimeChat?.(requestId);
      }
    });
  },
  streamRuntimeChat: (
    request: RuntimeChatRequest,
    onChunk: (payload: { delta: string; totalLength: number }) => void,
    signal?: AbortSignal
  ) => {
    const method = bridge().streamRuntimeChat;
    if (!method) {
      return Promise.reject(new Error("streamRuntimeChat is unavailable."));
    }

    // Requirement 4: Streaming Abort over Electron
    // If signal already aborted, reject immediately
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }

    // Add abort listener to call bridge().cancelRuntimeChatStream() on abort
    let abortListener: ((this: AbortSignal) => void) | undefined;
    if (signal) {
      abortListener = function() {
        bridge().cancelRuntimeChatStream?.();
      };
      signal.addEventListener("abort", abortListener);
    }

    // Note: Signal handling is at this level, not passed to bridge (can't serialize through IPC)
    const promise = method(request, onChunk);

    // Clean up listener in finally block
    return promise.finally(() => {
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
    });
  },
  cancelRuntimeChatStream: () => {
    const method = bridge().cancelRuntimeChatStream;
    if (!method) {
      return Promise.reject(new Error("cancelRuntimeChatStream is unavailable."));
    }
    return method();
  },
  cancelRuntimeChat: (requestId: string) => {
    const method = bridge().cancelRuntimeChat;
    if (!method) {
      return Promise.reject(new Error("cancelRuntimeChat is unavailable."));
    }
    return method(requestId);
  },
  listAgents: () => bridge().listAgents(),
  getAgent: (agentId: string) => bridge().getAgent(agentId),
  createAgent: (request: AgentCreateRequest) => bridge().createAgent(request),
  updateAgent: (agentId: string, request: AgentUpdateRequest) => bridge().updateAgent(agentId, request),
  startAgent: (agentId: string) => bridge().startAgent(agentId),
  stopAgent: (agentId: string) => bridge().stopAgent(agentId),
  deleteAgent: (agentId: string) => bridge().deleteAgent(agentId),
  listAgentLogs: (agentId: string, limit?: number) => bridge().listAgentLogs(agentId, limit),
  startEnabledAgents: () => {
    const method = bridge().startEnabledAgents;
    if (!method) {
      return Promise.reject(new Error("startEnabledAgents is unavailable."));
    }
    return method();
  },
  listJobs: (status?: JobStatus, limit?: number) => {
    const method = bridge().listJobs;
    if (!method) {
      return Promise.reject(new Error("listJobs is unavailable."));
    }
    return method(status, limit);
  },
  enqueueJob: (request: JobEnqueueRequest) => {
    const method = bridge().enqueueJob;
    if (!method) {
      return Promise.reject(new Error("enqueueJob is unavailable."));
    }
    return method(request);
  },
  claimNextJob: (request: JobClaimRequest) => {
    const method = bridge().claimNextJob;
    if (!method) {
      return Promise.reject(new Error("claimNextJob is unavailable."));
    }
    return method(request);
  },
  getJobDetail: (jobId: string) => {
    const method = bridge().getJobDetail;
    if (!method) {
      return Promise.reject(new Error("getJobDetail is unavailable."));
    }
    return method(jobId);
  },
  addJobWaypoint: (jobId: string, request: JobWaypointRequest) => {
    const method = bridge().addJobWaypoint;
    if (!method) {
      return Promise.reject(new Error("addJobWaypoint is unavailable."));
    }
    return method(jobId, request);
  },
  addJobArtifact: (jobId: string, request: JobArtifactCreateRequest) => {
    const method = bridge().addJobArtifact;
    if (!method) {
      return Promise.reject(new Error("addJobArtifact is unavailable."));
    }
    return method(jobId, request);
  },
  verifyJob: (jobId: string, request: JobVerifyRequest) => {
    const method = bridge().verifyJob;
    if (!method) {
      return Promise.reject(new Error("verifyJob is unavailable."));
    }
    return method(jobId, request);
  },
  requeueStaleJobs: () => {
    const method = bridge().requeueStaleJobs;
    if (!method) {
      return Promise.reject(new Error("requeueStaleJobs is unavailable."));
    }
    return method();
  },
  clearAllJobs: () => {
    const method = bridge().clearAllJobs;
    if (!method) {
      return Promise.reject(new Error("clearAllJobs is unavailable."));
    }
    return method();
  },
  pruneFinishedJobs: () => {
    const method = bridge().pruneFinishedJobs;
    if (!method) {
      return Promise.reject(new Error("pruneFinishedJobs is unavailable."));
    }
    return method();
  },
  listJobTrajectory: (jobId: string) => {
    const method = bridge().listJobTrajectory;
    if (!method) {
      return Promise.reject(new Error("listJobTrajectory is unavailable."));
    }
    return method(jobId);
  },
  listRecentTrajectories: (limit?: number) => {
    const method = bridge().listRecentTrajectories;
    if (!method) {
      return Promise.reject(new Error("listRecentTrajectories is unavailable."));
    }
    return method(limit);
  },
  getAgentRunnerStatus: () => {
    const method = bridge().getAgentRunnerStatus;
    if (!method) {
      return Promise.reject(new Error("getAgentRunnerStatus is unavailable."));
    }
    return method();
  },
  runAgentOnce: (request: AgentRunOnceRequest) => {
    const method = bridge().runAgentOnce;
    if (!method) {
      return Promise.reject(new Error("runAgentOnce is unavailable."));
    }
    return method(request);
  },
  getGitRepositoryStatus: (workspaceRoot: string) => {
    const method = bridge().getGitRepositoryStatus;
    if (!method) {
      return Promise.reject(new Error("getGitRepositoryStatus is unavailable."));
    }
    return method(workspaceRoot);
  },
  getGitCurrentBranch: (workspaceRoot: string) => {
    const method = bridge().getGitCurrentBranch;
    if (!method) {
      return Promise.reject(new Error("getGitCurrentBranch is unavailable."));
    }
    return method(workspaceRoot);
  },
  getGitChangedFiles: (workspaceRoot: string) => {
    const method = bridge().getGitChangedFiles;
    if (!method) {
      return Promise.reject(new Error("getGitChangedFiles is unavailable."));
    }
    return method(workspaceRoot);
  },
  getGitDiff: (workspaceRoot: string, filePath?: string) => {
    const method = bridge().getGitDiff;
    if (!method) {
      return Promise.reject(new Error("getGitDiff is unavailable."));
    }
    return method(workspaceRoot, filePath);
  },
  getGitDiffSummary: (workspaceRoot: string) => {
    const method = bridge().getGitDiffSummary;
    if (!method) {
      return Promise.reject(new Error("getGitDiffSummary is unavailable."));
    }
    return method(workspaceRoot);
  },
  getGitCommitSuggestion: (workspaceRoot: string) => {
    const method = bridge().getGitCommitSuggestion;
    if (!method) {
      return Promise.reject(new Error("getGitCommitSuggestion is unavailable."));
    }
    return method(workspaceRoot);
  },
  validateGitRepository: (workspaceRoot: string) => {
    const method = bridge().validateGitRepository;
    if (!method) {
      return Promise.reject(new Error("validateGitRepository is unavailable."));
    }
    return method(workspaceRoot);
  },
  suggestCommitMessages: (workspaceRoot: string, context?: CommitAssistantContext) => {
    const method = bridge().suggestCommitMessages;
    if (!method) {
      return Promise.reject(new Error("suggestCommitMessages is unavailable."));
    }
    return method(workspaceRoot, context);
  },
  validateCommitRequest: (workspaceRoot: string, request: CommitRequest) => {
    const method = bridge().validateCommitRequest;
    if (!method) {
      return Promise.reject(new Error("validateCommitRequest is unavailable."));
    }
    return method(workspaceRoot, request);
  },
  createCommit: (workspaceRoot: string, request: CommitRequest) => {
    const method = bridge().createCommit;
    if (!method) {
      return Promise.reject(new Error("createCommit is unavailable."));
    }
    return method(workspaceRoot, request);
  },
  createRestorePoint: (
    workspaceRoot: string,
    filePaths: string[],
    reason: RestorePointReason,
    label: string,
    options?: { relatedRunId?: string; relatedChangeIds?: string[] }
  ) => {
    const method = bridge().createRestorePoint;
    if (!method) {
      return Promise.reject(new Error("createRestorePoint is unavailable."));
    }
    return method(workspaceRoot, filePaths, reason, label, options);
  },
  listRestorePoints: (workspaceRoot: string) => {
    const method = bridge().listRestorePoints;
    if (!method) {
      return Promise.reject(new Error("listRestorePoints is unavailable."));
    }
    return method(workspaceRoot);
  },
  restorePoint: (workspaceRoot: string, restorePointId: string) => {
    const method = bridge().restorePoint;
    if (!method) {
      return Promise.reject(new Error("restorePoint is unavailable."));
    }
    return method(workspaceRoot, restorePointId);
  },
  deleteRestorePoint: (workspaceRoot: string, restorePointId: string) => {
    const method = bridge().deleteRestorePoint;
    if (!method) {
      return Promise.reject(new Error("deleteRestorePoint is unavailable."));
    }
    return method(workspaceRoot, restorePointId);
  },
  cleanupRestorePoints: (workspaceRoot: string) => {
    const method = bridge().cleanupRestorePoints;
    if (!method) {
      return Promise.reject(new Error("cleanupRestorePoints is unavailable."));
    }
    return method(workspaceRoot);
  },
  listProjectMemory: (workspace: string) => bridge().listProjectMemory(workspace),
  upsertProjectMemory: (request: ProjectMemoryUpsertRequest) => bridge().upsertProjectMemory(request),
  deleteProjectMemory: (entryId: number) => bridge().deleteProjectMemory(entryId),
  listTasks: () => bridge().listTasks(),
  createTask: (request: TaskCreateRequest) => bridge().createTask(request),
  updateTask: (taskId: string, request: TaskUpdateRequest) => bridge().updateTask(taskId, request),
  deleteTask: (taskId: string) => bridge().deleteTask(taskId),
  analyzeDocs: (workspaceRoot: string, maxFiles?: number) => bridge().analyzeDocs(workspaceRoot, maxFiles),
  generateDocs: (request: DocsGenerateRequest) => bridge().generateDocs(request),
  restartFrontend: () => {
    const method = bridge().restartFrontend;
    if (!method) {
      return Promise.reject(new Error("restartFrontend is unavailable."));
    }
    return method();
  },
  getAgentHealth: (agentId: string) => {
    const method = bridge().getAgentHealth;
    if (!method) {
      return Promise.reject(new Error("getAgentHealth is unavailable."));
    }
    return method(agentId);
  },
  getGpuInfo: () => {
    const method = bridge().getGpuInfo;
    if (!method) {
      return Promise.reject(new Error("getGpuInfo is unavailable."));
    }
    return method();
  },
  linkJobToTask: (taskId: string, jobId: string) => {
    const method = bridge().linkJobToTask;
    if (!method) {
      return Promise.reject(new Error("linkJobToTask is unavailable."));
    }
    return method(taskId, jobId);
  },
  unlinkJobFromTask: (taskId: string, jobId: string) => {
    const method = bridge().unlinkJobFromTask;
    if (!method) {
      return Promise.reject(new Error("unlinkJobFromTask is unavailable."));
    }
    return method(taskId, jobId);
  },
  runBenchmark: () => {
    const method = bridge().runBenchmark;
    if (!method) {
      return Promise.reject(new Error("runBenchmark is unavailable."));
    }
    return method();
  },
  runModelTest: async () => {
    const bridgeMethod = bridge().runModelTest;
    if (bridgeMethod) {
      return bridgeMethod();
    }

    return runClientModelTest();
  },
  startModelDownload: (request: { repo_id: string; filename: string; dest_dir: string }) => {
    const method = bridge().startModelDownload;
    if (!method) {
      return Promise.reject(new Error("startModelDownload is unavailable."));
    }
    return method(request);
  },
  getModelDownloadStatus: (taskId: string) => {
    const method = bridge().getModelDownloadStatus;
    if (!method) {
      return Promise.reject(new Error("getModelDownloadStatus is unavailable."));
    }
    return method(taskId);
  },
  listModelDownloads: () => {
    const method = bridge().listModelDownloads;
    if (!method) {
      return Promise.reject(new Error("listModelDownloads is unavailable."));
    }
    return method();
  },
  listOrchestrationTools: () => {
    const method = bridge().listOrchestrationTools;
    if (!method) {
      return Promise.reject(new Error("listOrchestrationTools is unavailable."));
    }
    return method() as Promise<import("@/types/orchestration").ToolCatalogResponse>;
  },
  prepareOrchestrationContext: (request: import("@/types/orchestration").ContextPrepareRequest) => {
    const method = bridge().prepareOrchestrationContext;
    if (!method) {
      return Promise.reject(new Error("prepareOrchestrationContext is unavailable."));
    }
    return method(request) as Promise<import("@/types/orchestration").ContextPrepareResponse>;
  },
  executeOrchestrationTool: (request: import("@/types/orchestration").ToolExecutionRequest) => {
    const method = bridge().executeOrchestrationTool;
    if (!method) {
      return Promise.reject(new Error("executeOrchestrationTool is unavailable."));
    }
    return method(request) as Promise<import("@/types/orchestration").ToolExecutionResponse>;
  }
};
