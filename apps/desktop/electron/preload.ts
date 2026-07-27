import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AgentCreateRequest,
  AgentPatchApplyResult,
  AgentPatchPreview,
  AgentPatchProposal,
  AgentLogEntry,
  AgentRecord,
  AgentRunOnceRequest,
  AgentRunResult,
  AgentRunnerStatus,
  AgentUpdateRequest,
  DocsAnalysisSummary,
  DocsGenerateRequest,
  DocsGenerateResponse,
  CommitAssistantContext,
  CommitMessageSuggestion,
  CommitRequest,
  CommitResult,
  RestorePoint,
  RestorePointReason,
  RestoreResult,
  AllowedCommand,
  CommandRunLogs,
  CommandRunStatus,
  TerminalCommandRequest,
  AppInfo,
  AppSettings,
  BackendHealth,
  BackendStartupStatus,
  BootState,
  ModelIndex,
  ProjectMemoryEntry,
  ProjectMemoryUpsertRequest,
  ProjectCreationResult,
  RuntimeChatRequest,
  RuntimeChatResponse,
  RuntimeStatus,
  GitCommitSuggestion,
  GitDiffSummary,
  GitRepositoryStatus,
  GitStatusEntry,
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
  TaskBoardItem,
  TaskCreateRequest,
  TaskUpdateRequest,
  SaveFileRequest,
  SaveFileAsRequest,
  WorkspaceFile,
  ReviewArtifactSummary,
  WorkspaceProjectFile,
  WorkspaceState,
  AgentWebSearchRequest,
  AgentWebSearchResult,
  AgentWebFetchRequest,
  AgentWebDocument
} from "@dbzs/shared";
import type {
  ActiveSkillCapsule,
  CodeeSkillManifestV1,
  CodeeSkillPackage,
  SkillArtifactReference,
  SkillArtifactWriteRequest,
  SkillPackageReloadResult,
  SkillRun,
  SkillRunValidation
} from "../src/runtime/skill/skillContracts";

const api = {
  getAppInfo: () => ipcRenderer.invoke("dbzs:app-info") as Promise<AppInfo>,
  getBackendHealth: () => ipcRenderer.invoke("dbzs:backend-health") as Promise<BackendHealth>,
  getSettings: () => ipcRenderer.invoke("dbzs:settings:get") as Promise<AppSettings>,
  updateSettings: (settings: AppSettings) =>
    ipcRenderer.invoke("dbzs:settings:update", settings) as Promise<AppSettings>,
  patchSettings: (request: import("@dbzs/shared").SettingsPatchRequest) =>
    ipcRenderer.invoke("dbzs:settings:patch", request) as Promise<
      import("@dbzs/shared").SettingsPatchResponse
    >,
  getSettingsDiagnostics: () =>
    ipcRenderer.invoke("dbzs:settings:diagnostics") as Promise<
      import("@dbzs/shared").SettingsDiagnostics
    >,
  openFileDialog: () => ipcRenderer.invoke("dbzs:file:open-dialog") as Promise<WorkspaceFile | null>,
  saveFile: (request: SaveFileRequest) =>
    ipcRenderer.invoke("dbzs:file:save", request) as Promise<WorkspaceFile>,
  saveFileAsDialog: (request: SaveFileAsRequest) =>
    ipcRenderer.invoke("dbzs:file:save-as-dialog", request) as Promise<WorkspaceFile | null>,
  selectProjectDirectory: () =>
    ipcRenderer.invoke("dbzs:workspace:select-project-directory") as Promise<{ projectPath: string; projectName: string } | null>,
  createNewProject: () =>
    ipcRenderer.invoke("dbzs:workspace:create-new-project") as Promise<ProjectCreationResult | null>,
  scanProjectFiles: (projectPath: string) =>
    ipcRenderer.invoke("dbzs:workspace:scan-project-files", projectPath) as Promise<WorkspaceProjectFile[]>,
  readProjectFile: (filePath: string) =>
    ipcRenderer.invoke("dbzs:workspace:read-project-file", filePath) as Promise<WorkspaceFile>,
  listReviewArtifacts: (workspaceRoot: string) =>
    ipcRenderer.invoke("dbzs:reviews:list-artifacts", workspaceRoot) as Promise<ReviewArtifactSummary[]>,
  openReviewArtifact: (
    workspaceRoot: string,
    reviewId: string,
    kind: "report" | "findings"
  ) =>
    ipcRenderer.invoke(
      "dbzs:reviews:open-artifact",
      workspaceRoot,
      reviewId,
      kind
    ) as Promise<WorkspaceFile>,
  revealReviewArtifacts: (workspaceRoot: string, reviewId: string) =>
    ipcRenderer.invoke(
      "dbzs:reviews:reveal-artifacts",
      workspaceRoot,
      reviewId
    ) as Promise<{ status: string }>,
  writeProjectFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("dbzs:workspace:write-project-file", filePath, content) as Promise<WorkspaceFile>,
  reloadSkillPackages: (workspaceRoot?: string) =>
    ipcRenderer.invoke("dbzs:skills:reload", workspaceRoot) as Promise<SkillPackageReloadResult>,
  importSkillPackage: () =>
    ipcRenderer.invoke("dbzs:skills:import") as Promise<CodeeSkillPackage | null>,
  saveSkillRun: (
    workspaceRoot: string,
    run: SkillRun,
    manifest: CodeeSkillManifestV1,
    capsules: ActiveSkillCapsule[],
    instructions: string,
    validation?: SkillRunValidation
  ) => ipcRenderer.invoke(
    "dbzs:skill-runs:save",
    workspaceRoot,
    run,
    manifest,
    capsules,
    instructions,
    validation
  ) as Promise<void>,
  listSkillRuns: (workspaceRoot: string) =>
    ipcRenderer.invoke("dbzs:skill-runs:list", workspaceRoot) as Promise<SkillRun[]>,
  writeSkillArtifact: (workspaceRoot: string, request: SkillArtifactWriteRequest) =>
    ipcRenderer.invoke("dbzs:skill-runs:artifact", workspaceRoot, request) as Promise<SkillArtifactReference>,
  approveSkillRunArtifacts: (workspaceRoot: string, skillRunId: string) =>
    ipcRenderer.invoke("dbzs:skill-runs:approve-artifacts", workspaceRoot, skillRunId) as Promise<SkillRun>,
  setSkillRunStatus: (
    workspaceRoot: string,
    skillRunId: string,
    status: "awaiting_user" | "cancelled"
  ) => ipcRenderer.invoke(
    "dbzs:skill-runs:set-status",
    workspaceRoot,
    skillRunId,
    status
  ) as Promise<SkillRun>,
  createWorkspaceFolder: (folderPath: string) =>
    ipcRenderer.invoke("dbzs:workspace:create-folder", folderPath) as Promise<{ path: string }>,
  renameWorkspacePath: (sourcePath: string, destinationPath: string) =>
    ipcRenderer.invoke("dbzs:workspace:rename-path", sourcePath, destinationPath) as Promise<{
      from: string;
      to: string;
    }>,
  deleteWorkspacePath: (targetPath: string) =>
    ipcRenderer.invoke("dbzs:workspace:delete-path", targetPath) as Promise<{ hasUndo: boolean }>,
  restoreLastDeletedWorkspacePath: () =>
    ipcRenderer.invoke("dbzs:workspace:restore-last-deleted") as Promise<{ restoredPath: string | null }>,
  undoLastWorkspaceWrite: (filePath: string) =>
    ipcRenderer.invoke("dbzs:workspace:undo-last-write", filePath) as Promise<{
      file: WorkspaceFile | null;
      hasUndo: boolean;
    }>,
  createWorkspaceFileSnapshot: (filePath: string) =>
    ipcRenderer.invoke("dbzs:workspace:file-change:create-snapshot", filePath) as Promise<{
      snapshotId: string;
      filePath: string;
      existed: boolean;
    }>,
  createWorkspaceDiff: (filePath: string, proposedContent: string) =>
    ipcRenderer.invoke("dbzs:workspace:file-change:create-diff", filePath, proposedContent) as Promise<{
      snapshotId: string;
      beforeContent: string;
      afterContent: string;
      diff: string;
    }>,
  applyWorkspacePatch: (
    filePath: string,
    newContent: string,
    snapshotId?: string,
    restoreOptions?: {
      reason?: RestorePointReason;
      label?: string;
      relatedRunId?: string;
      relatedChangeIds?: string[];
    }
  ) =>
    ipcRenderer.invoke("dbzs:workspace:file-change:apply-patch", filePath, newContent, snapshotId, restoreOptions) as Promise<{
      snapshotId: string;
      file: WorkspaceFile;
      diff: string;
      restorePointId?: string;
    }>,
  restoreWorkspaceSnapshot: (snapshotId: string) =>
    ipcRenderer.invoke("dbzs:workspace:file-change:restore-snapshot", snapshotId) as Promise<{
      restored: boolean;
      snapshotId: string;
      file: WorkspaceFile | null;
    }>,
  createPatchPreview: (filePath: string, proposedContent: string) =>
    ipcRenderer.invoke("dbzs:workspace:patch-pipeline:preview", filePath, proposedContent) as Promise<{
      snapshotId: string;
      beforeContent: string;
      afterContent: string;
      diff: string;
    }>,
  applyPatchWithRestorePoint: (
    filePath: string,
    proposedContent: string,
    reason?: RestorePointReason
  ) =>
    ipcRenderer.invoke("dbzs:workspace:patch-pipeline:apply", filePath, proposedContent, reason) as Promise<{
      snapshotId: string;
      file: WorkspaceFile;
      diff: string;
      restorePointId?: string;
    }>,
  rollbackPatch: (restorePointId: string) =>
    ipcRenderer.invoke("dbzs:workspace:patch-pipeline:rollback", restorePointId) as Promise<RestoreResult>,
  previewAgentPatch: (proposal: AgentPatchProposal) =>
    ipcRenderer.invoke("dbzs:agent-patch:preview", proposal) as Promise<AgentPatchPreview>,
  approveAgentPatch: (proposalId: string, approvalVersion: string) =>
    ipcRenderer.invoke("dbzs:agent-patch:approve", proposalId, approvalVersion) as Promise<AgentPatchPreview>,
  rejectAgentPatch: (proposalId: string) =>
    ipcRenderer.invoke("dbzs:agent-patch:reject", proposalId) as Promise<AgentPatchPreview>,
  applyAgentPatch: (proposalId: string) =>
    ipcRenderer.invoke("dbzs:agent-patch:apply", proposalId) as Promise<AgentPatchApplyResult>,
  rollbackAgentPatch: (restorePointId: string) =>
    ipcRenderer.invoke("dbzs:agent-patch:rollback", restorePointId) as Promise<AgentPatchApplyResult>,
  normalizeWorkspaceContextPaths: (workspaceRoot: string, candidates: string[]) =>
    ipcRenderer.invoke("dbzs:workspace:normalize-context-paths", workspaceRoot, candidates) as Promise<string[]>,
  openInSystemExplorer: (targetPath?: string) =>
    ipcRenderer.invoke("dbzs:shell:open-in-explorer", targetPath) as Promise<{ status: string }>,
  promptTextInput: (request: {
    title: string;
    label: string;
    value: string;
    confirmText?: string;
    cancelText?: string;
  }) => ipcRenderer.invoke("dbzs:ui:prompt-text-input", request) as Promise<string | null>,
  terminalExec: (request: TerminalCommandRequest) =>
    ipcRenderer.invoke("dbzs:terminal:exec", request) as Promise<{
      stdout: string;
      stderr: string;
      code: number;
    }>,
  terminalSessionStart: (sessionId: string, cwd?: string) =>
    ipcRenderer.invoke("dbzs:terminal:session:start", sessionId, cwd) as Promise<{ started: boolean; reason?: string }>,
  terminalSessionWrite: (sessionId: string, input: string) =>
    ipcRenderer.invoke("dbzs:terminal:session:write", sessionId, input) as Promise<{ written: boolean }>,
  terminalSessionKill: (sessionId: string) =>
    ipcRenderer.invoke("dbzs:terminal:session:kill", sessionId) as Promise<{ killed: boolean }>,
  onTerminalOutput: (callback: (sessionId: string, data: string, stream: "stdout" | "stderr") => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, data: string, stream: "stdout" | "stderr") =>
      callback(sessionId, data, stream);
    ipcRenderer.on("dbzs:terminal:output", handler);
    return () => ipcRenderer.removeListener("dbzs:terminal:output", handler);
  },
  onTerminalExit: (callback: (sessionId: string, code: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, code: number) => callback(sessionId, code);
    ipcRenderer.on("dbzs:terminal:exit", handler);
    return () => ipcRenderer.removeListener("dbzs:terminal:exit", handler);
  },
  listAllowedCommands: () =>
    ipcRenderer.invoke("dbzs:commands:allowed") as Promise<AllowedCommand[]>,
  executeSafeCommand: (workspaceRoot: string, commandId: string) =>
    ipcRenderer.invoke("dbzs:commands:execute", workspaceRoot, commandId) as Promise<CommandRunStatus>,
  cancelSafeCommand: (runId: string) =>
    ipcRenderer.invoke("dbzs:commands:cancel", runId) as Promise<{ cancelled: boolean }>,
  getSafeCommandRunStatus: (runId: string) =>
    ipcRenderer.invoke("dbzs:commands:status", runId) as Promise<CommandRunStatus>,
  streamSafeCommandLogs: (runId: string) =>
    ipcRenderer.invoke("dbzs:commands:logs", runId) as Promise<CommandRunLogs>,
  executeWebSearch: (request: AgentWebSearchRequest) =>
    ipcRenderer.invoke("dbzs:research:search", request) as Promise<AgentWebSearchResult>,
  executeWebFetch: (request: AgentWebFetchRequest) =>
    ipcRenderer.invoke("dbzs:research:fetch", request) as Promise<AgentWebDocument>,
  getGitRepositoryStatus: (workspaceRoot: string) =>
    ipcRenderer.invoke("dbzs:git:repository-status", workspaceRoot) as Promise<GitRepositoryStatus>,
  getGitCurrentBranch: (workspaceRoot: string) =>
    ipcRenderer.invoke("dbzs:git:current-branch", workspaceRoot) as Promise<string>,
  getGitChangedFiles: (workspaceRoot: string) =>
    ipcRenderer.invoke("dbzs:git:changed-files", workspaceRoot) as Promise<GitStatusEntry[]>,
  getGitDiff: (workspaceRoot: string, filePath?: string) =>
    ipcRenderer.invoke("dbzs:git:diff", workspaceRoot, filePath) as Promise<string>,
  getGitDiffSummary: (workspaceRoot: string) =>
    ipcRenderer.invoke("dbzs:git:diff-summary", workspaceRoot) as Promise<GitDiffSummary[]>,
  getGitCommitSuggestion: (workspaceRoot: string) =>
    ipcRenderer.invoke("dbzs:git:commit-suggestion", workspaceRoot) as Promise<GitCommitSuggestion | null>,
  validateGitRepository: (workspaceRoot: string) =>
    ipcRenderer.invoke("dbzs:git:validate-repository", workspaceRoot) as Promise<boolean>,
  suggestCommitMessages: (workspaceRoot: string, context?: CommitAssistantContext) =>
    ipcRenderer.invoke("dbzs:commit-assistant:suggestions", workspaceRoot, context) as Promise<CommitMessageSuggestion[]>,
  validateCommitRequest: (workspaceRoot: string, request: CommitRequest) =>
    ipcRenderer.invoke("dbzs:commit-assistant:validate", workspaceRoot, request) as Promise<{ valid: boolean }>,
  createCommit: (workspaceRoot: string, request: CommitRequest) =>
    ipcRenderer.invoke("dbzs:commit-assistant:create", workspaceRoot, request) as Promise<CommitResult>,
  createRestorePoint: (
    workspaceRoot: string,
    filePaths: string[],
    reason: RestorePointReason,
    label: string,
    options?: { relatedRunId?: string; relatedChangeIds?: string[] }
  ) =>
    ipcRenderer.invoke("dbzs:restore-points:create", workspaceRoot, filePaths, reason, label, options) as Promise<RestorePoint>,
  listRestorePoints: (workspaceRoot: string) =>
    ipcRenderer.invoke("dbzs:restore-points:list", workspaceRoot) as Promise<RestorePoint[]>,
  restorePoint: (workspaceRoot: string, restorePointId: string) =>
    ipcRenderer.invoke("dbzs:restore-points:restore", workspaceRoot, restorePointId) as Promise<RestoreResult>,
  deleteRestorePoint: (workspaceRoot: string, restorePointId: string) =>
    ipcRenderer.invoke("dbzs:restore-points:delete", workspaceRoot, restorePointId) as Promise<{ deleted: boolean }>,
  cleanupRestorePoints: (workspaceRoot: string) =>
    ipcRenderer.invoke("dbzs:restore-points:cleanup", workspaceRoot) as Promise<{ removed: string[] }>,
  getWorkspaceState: () => ipcRenderer.invoke("dbzs:workspace:get-state") as Promise<WorkspaceState>,
  setWorkspaceState: (state: WorkspaceState) =>
    ipcRenderer.invoke("dbzs:workspace:set-state", state) as Promise<WorkspaceState>,
  openSettingsWindow: () =>
    ipcRenderer.invoke("dbzs:settings:open-window") as Promise<{ status: string }>,
  openRuntimeChatWindow: () =>
    ipcRenderer.invoke("dbzs:runtime-chat:open-window") as Promise<{ status: string }>,
  closeRuntimeChatWindow: () =>
    ipcRenderer.invoke("dbzs:runtime-chat:close-window") as Promise<{ status: string }>,
  openPlatformDiagnosticsWindow: () =>
    ipcRenderer.invoke("dbzs:platform-diagnostics:open-window") as Promise<{ status: string }>,
  closePlatformDiagnosticsWindow: () =>
    ipcRenderer.invoke("dbzs:platform-diagnostics:close-window") as Promise<{ status: string }>,
  publishRuntimeChatContext: (context: {
    activeFile: WorkspaceFile | null;
    contextHint: string | null;
    workspaceRoot: string | null;
    workspaceName: string | null;
    workspaceFiles: WorkspaceProjectFile[];
  }) => ipcRenderer.invoke("dbzs:runtime-chat:publish-context", context) as Promise<{ status: string }>,
  getRuntimeChatContext: () =>
    ipcRenderer.invoke("dbzs:runtime-chat:get-context") as Promise<{
      activeFile: WorkspaceFile | null;
      contextHint: string | null;
      workspaceRoot: string | null;
      workspaceName: string | null;
      workspaceFiles: WorkspaceProjectFile[];
    } | null>,
  onRuntimeChatWindowState: (listener: (state: { open: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { open: boolean }) => {
      listener(state);
    };
    ipcRenderer.on("dbzs:runtime-chat:window-state", handler);
    return () => {
      ipcRenderer.removeListener("dbzs:runtime-chat:window-state", handler);
    };
  },
  onRuntimeChatContext: (
    listener: (context: {
      activeFile: WorkspaceFile | null;
      contextHint: string | null;
      workspaceRoot: string | null;
      workspaceName: string | null;
      workspaceFiles: WorkspaceProjectFile[];
    } | null) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      context: {
        activeFile: WorkspaceFile | null;
        contextHint: string | null;
        workspaceRoot: string | null;
        workspaceName: string | null;
        workspaceFiles: WorkspaceProjectFile[];
      } | null
    ) => {
      listener(context);
    };
    ipcRenderer.on("dbzs:runtime-chat:context", handler);
    return () => {
      ipcRenderer.removeListener("dbzs:runtime-chat:context", handler);
    };
  },
  getModelIndex: () => ipcRenderer.invoke("dbzs:models:index") as Promise<ModelIndex>,
  getRuntimeStatus: () => ipcRenderer.invoke("dbzs:runtime:status") as Promise<RuntimeStatus>,
  startRuntimeModel: (modelId: string) =>
    ipcRenderer.invoke("dbzs:runtime:start", modelId) as Promise<RuntimeStatus>,
  stopRuntimeModel: () => ipcRenderer.invoke("dbzs:runtime:stop") as Promise<RuntimeStatus>,
  sendRuntimeChat: (request: RuntimeChatRequest, requestId?: string) =>
    ipcRenderer.invoke("dbzs:runtime:chat", request, requestId) as Promise<RuntimeChatResponse>,
  streamRuntimeChat: (
    request: RuntimeChatRequest,
    onChunk: (payload: { delta: string; totalLength: number }) => void
  ) => {
    const handler = (_event: IpcRendererEvent, payload: { delta: string; totalLength: number }) => {
      onChunk(payload);
    };
    ipcRenderer.on("dbzs:runtime:chat-stream-chunk", handler);
    return (
      ipcRenderer.invoke("dbzs:runtime:chat-stream", request) as Promise<RuntimeChatResponse>
    ).finally(() => {
      ipcRenderer.removeListener("dbzs:runtime:chat-stream-chunk", handler);
    });
  },
  cancelRuntimeChatStream: () => ipcRenderer.invoke("dbzs:runtime:chat-stream:cancel") as Promise<{ status: string }>,
  cancelRuntimeChat: (requestId: string) => ipcRenderer.invoke("dbzs:runtime:chat:cancel", requestId) as Promise<{ status: string }>,
  runBenchmark: () => ipcRenderer.invoke("dbzs:runtime:benchmark") as Promise<import("@dbzs/shared").BenchmarkResult>,
  runModelTest: () => ipcRenderer.invoke("dbzs:runtime:model-test") as Promise<import("@dbzs/shared").RuntimeModelTestReport>,
  getRuntimeDoctor: () => ipcRenderer.invoke("dbzs:runtime:doctor") as Promise<import("@dbzs/shared").RuntimeDoctorReport>,
  dryRunRuntimeModel: (payload: import("@dbzs/shared").RuntimeDryRunRequest) =>
    ipcRenderer.invoke("dbzs:runtime:doctor-dry-run", payload) as Promise<import("@dbzs/shared").RuntimeDryRunResponse>,
  probeRuntimeModel: (payload: import("@dbzs/shared").RuntimeProbeRequest) =>
    ipcRenderer.invoke("dbzs:runtime:doctor-probe", payload) as Promise<import("@dbzs/shared").RuntimeProbeResponse>,
  getRuntimeLogs: () => ipcRenderer.invoke("dbzs:runtime:logs") as Promise<import("@dbzs/shared").RuntimeLogsResponse>,
  listJobs: (status?: JobStatus, limit?: number) =>
    ipcRenderer.invoke("dbzs:job-spooler:list", status, limit) as Promise<JobRecord[]>,
  enqueueJob: (request: JobEnqueueRequest) =>
    ipcRenderer.invoke("dbzs:job-spooler:enqueue", request) as Promise<JobRecord>,
  claimNextJob: (request: JobClaimRequest) =>
    ipcRenderer.invoke("dbzs:job-spooler:claim", request) as Promise<JobClaimResponse>,
  getJobDetail: (jobId: string) =>
    ipcRenderer.invoke("dbzs:job-spooler:detail", jobId) as Promise<JobDetail>,
  addJobWaypoint: (jobId: string, request: JobWaypointRequest) =>
    ipcRenderer.invoke("dbzs:job-spooler:waypoint", jobId, request) as Promise<JobEvent>,
  addJobArtifact: (jobId: string, request: JobArtifactCreateRequest) =>
    ipcRenderer.invoke("dbzs:job-spooler:artifact", jobId, request) as Promise<JobArtifact>,
  verifyJob: (jobId: string, request: JobVerifyRequest) =>
    ipcRenderer.invoke("dbzs:job-spooler:verify", jobId, request) as Promise<JobVerification>,
  requeueStaleJobs: () =>
    ipcRenderer.invoke("dbzs:job-spooler:requeue-stale") as Promise<{ requeued: number }>,
  clearAllJobs: () =>
    ipcRenderer.invoke("dbzs:job-spooler:clear-all") as Promise<{ deleted: number }>,
  pruneFinishedJobs: () =>
    ipcRenderer.invoke("dbzs:job-spooler:prune-finished") as Promise<{ deleted: number }>,
  listJobTrajectory: (jobId: string) =>
    ipcRenderer.invoke("dbzs:trajectories:job", jobId) as Promise<unknown>,
  listRecentTrajectories: (limit?: number) =>
    ipcRenderer.invoke("dbzs:trajectories:recent", limit) as Promise<unknown>,
  getAgentRunnerStatus: () =>
    ipcRenderer.invoke("dbzs:agent-runner:status") as Promise<AgentRunnerStatus>,
  runAgentOnce: (request: AgentRunOnceRequest) =>
    ipcRenderer.invoke("dbzs:agent-runner:run-once", request) as Promise<AgentRunResult>,
  listAgents: () => ipcRenderer.invoke("dbzs:agents:list") as Promise<AgentRecord[]>,
  getAgent: (agentId: string) => ipcRenderer.invoke("dbzs:agents:get", agentId) as Promise<AgentRecord>,
  createAgent: (request: AgentCreateRequest) =>
    ipcRenderer.invoke("dbzs:agents:create", request) as Promise<AgentRecord>,
  updateAgent: (agentId: string, request: AgentUpdateRequest) =>
    ipcRenderer.invoke("dbzs:agents:update", agentId, request) as Promise<AgentRecord>,
  startAgent: (agentId: string) => ipcRenderer.invoke("dbzs:agents:start", agentId) as Promise<AgentRecord>,
  stopAgent: (agentId: string) => ipcRenderer.invoke("dbzs:agents:stop", agentId) as Promise<AgentRecord>,
  deleteAgent: (agentId: string) =>
    ipcRenderer.invoke("dbzs:agents:delete", agentId) as Promise<{ status: string; agent_id: string }>,
  listAgentLogs: (agentId: string, limit = 100) =>
    ipcRenderer.invoke("dbzs:agents:logs", agentId, limit) as Promise<AgentLogEntry[]>,
  listProjectMemory: (workspace: string) =>
    ipcRenderer.invoke("dbzs:project-memory:list", workspace) as Promise<ProjectMemoryEntry[]>,
  upsertProjectMemory: (request: ProjectMemoryUpsertRequest) =>
    ipcRenderer.invoke("dbzs:project-memory:upsert", request) as Promise<ProjectMemoryEntry>,
  deleteProjectMemory: (entryId: number) =>
    ipcRenderer.invoke("dbzs:project-memory:delete", entryId) as Promise<{ status: string; id: number }>,
  listTasks: () => ipcRenderer.invoke("dbzs:task-board:list") as Promise<TaskBoardItem[]>,
  createTask: (request: TaskCreateRequest) =>
    ipcRenderer.invoke("dbzs:task-board:create", request) as Promise<TaskBoardItem>,
  updateTask: (taskId: string, request: TaskUpdateRequest) =>
    ipcRenderer.invoke("dbzs:task-board:update", taskId, request) as Promise<TaskBoardItem>,
  deleteTask: (taskId: string) =>
    ipcRenderer.invoke("dbzs:task-board:delete", taskId) as Promise<{ status: string }>,
  analyzeDocs: (workspaceRoot: string, maxFiles = 5) =>
    ipcRenderer.invoke("dbzs:docs:analyze", workspaceRoot, maxFiles) as Promise<DocsAnalysisSummary>,
  generateDocs: (request: DocsGenerateRequest) =>
    ipcRenderer.invoke("dbzs:docs:generate", request) as Promise<DocsGenerateResponse>,
  reloadBackend: () =>
    ipcRenderer.invoke("dbzs:backend:reload") as Promise<{ status: string; port: number }>,
  restartFrontend: () =>
    ipcRenderer.invoke("dbzs:frontend:restart") as Promise<{ status: string; windows: number }>,
  listOrchestrationTools: () => ipcRenderer.invoke("dbzs:orchestration:tools"),
  prepareOrchestrationContext: (request: Record<string, unknown>) =>
    ipcRenderer.invoke("dbzs:orchestration:prepare", request),
  executeOrchestrationTool: (request: Record<string, unknown>) =>
    ipcRenderer.invoke("dbzs:orchestration:execute", request),
  getBackendStartupStatus: () => ipcRenderer.invoke("dbzs:backend:startup-status") as Promise<BackendStartupStatus>,
  onBackendStartupStatus: (listener: (status: BackendStartupStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: BackendStartupStatus) => {
      listener(status);
    };
    ipcRenderer.on("dbzs:backend:startup-status", handler);
    return () => {
      ipcRenderer.removeListener("dbzs:backend:startup-status", handler);
    };
  },
  onMenuAction: (listener: (action: string) => void) => {
    const handler = (_event: IpcRendererEvent, action: string) => {
      listener(action);
    };
    ipcRenderer.on("dbzs:menu:action", handler);
    return () => {
      ipcRenderer.removeListener("dbzs:menu:action", handler);
    };
  },
  getBootState: () => ipcRenderer.invoke("dbzs:boot:get-state") as Promise<BootState>,
  onBootState: (listener: (state: BootState) => void) => {
    const handler = (_event: IpcRendererEvent, state: BootState) => {
      listener(state);
    };
    ipcRenderer.on("dbzs:boot:state", handler);
    return () => {
      ipcRenderer.removeListener("dbzs:boot:state", handler);
    };
  },
  reportBootPhaseState: (
    phaseId: string,
    state: "success" | "failed",
    message: string,
    progress?: number,
    metadata?: Record<string, unknown>
  ) => ipcRenderer.invoke("dbzs:boot:report-phase", phaseId, state, message, progress, metadata) as Promise<void>,
  retryBootPhase: (phaseId: string | null) =>
    ipcRenderer.invoke("dbzs:boot:retry-phase", phaseId) as Promise<void>,
  restartBootBackend: () => ipcRenderer.invoke("dbzs:boot:restart-backend") as Promise<void>,
  useFallbackResidentModel: () => ipcRenderer.invoke("dbzs:boot:use-fallback-model") as Promise<void>,
  exportBootDiagnostics: () => ipcRenderer.invoke("dbzs:boot:export-diagnostics") as Promise<string>,
  enterBootSafeMode: () => ipcRenderer.invoke("dbzs:boot:safe-mode") as Promise<void>,
  isBootSafeMode: () => ipcRenderer.invoke("dbzs:boot:is-safe-mode") as Promise<boolean>,
  quitApp: () => ipcRenderer.invoke("dbzs:boot:quit") as Promise<void>
};

contextBridge.exposeInMainWorld("dbzs", api);
