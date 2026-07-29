import type {
  AgentCreateRequest,
  AgentPatchApplyResult,
  AgentPatchPreview,
  AgentPatchProposal,
  AgentLogEntry,
  AgentPatchProposal,
  AgentRecord,
  AgentRunOnceRequest,
  AgentRunResult,
  AgentRunnerStatus,
  AgentUpdateRequest,
  AllowedCommand,
  BackupSummary,
  RestoreSummary,
  CommitAssistantContext,
  CommitMessageSuggestion,
  CommitRequest,
  CommitResult,
  RestorePoint,
  RestorePointReason,
  RestoreResult,
  ReviewArtifactSummary,
  CommandRunLogs,
  CommandRunStatus,
  DocsAnalysisSummary,
  DocsGenerateRequest,
  DocsGenerateResponse,
  AppInfo,
  AppSettings,
  SettingsDiagnostics,
  SettingsPatchRequest,
  SettingsPatchResponse,
  BackendHealth,
  BackendStartupStatus,
  BootState,
  ModelIndex,
  ProjectMemoryEntry,
  ProjectMemoryUpsertRequest,
  ProjectCreationResult,
  RuntimeChatRequest,
  RuntimeChatAttachment,
  RuntimeChatImageAttachment,
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
  WorkspaceFile,
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
} from "@/runtime/skill/skillContracts";

declare global {
  interface Window {
    dbzs: {
      getAppInfo: () => Promise<AppInfo>;
      restartApp?: () => Promise<void> | void;
      getBackendHealth: () => Promise<BackendHealth>;
      getAppPath?: (name: string) => Promise<string>;
      getSettings: () => Promise<AppSettings>;
      updateSettings: (settings: AppSettings) => Promise<AppSettings>;
      patchSettings?: (request: SettingsPatchRequest) => Promise<SettingsPatchResponse>;
      getSettingsDiagnostics?: () => Promise<SettingsDiagnostics>;
      openFileDialog: () => Promise<WorkspaceFile | null>;
      openImageFileDialog?: () => Promise<RuntimeChatImageAttachment | null>;
      openChatAttachmentDialog?: () => Promise<RuntimeChatAttachment[]>;
      prepareClipboardChatAttachments?: (
        items: Array<{ name: string; mimeType: string; sizeBytes?: number; dataUrl: string }>
      ) => Promise<RuntimeChatAttachment[]>;
      saveFile: (request: SaveFileRequest) => Promise<WorkspaceFile>;
      saveFileAsDialog?: (request: import("@dbzs/shared").SaveFileAsRequest) => Promise<WorkspaceFile | null>;
      selectProjectDirectory?: () => Promise<{ projectPath: string; projectName: string } | null>;
      createNewProject?: () => Promise<ProjectCreationResult | null>;
      scanProjectFiles?: (projectPath: string) => Promise<WorkspaceProjectFile[]>;
      readProjectFile?: (filePath: string) => Promise<WorkspaceFile | null>;
      fs?: {
        readFile: (filePath: string, encoding?: string) => Promise<string>;
        writeFile: (filePath: string, content: string) => Promise<void>;
        stat: (filePath: string) => Promise<unknown>;
      };
      listReviewArtifacts?: (workspaceRoot: string) => Promise<ReviewArtifactSummary[]>;
      openReviewArtifact?: (
        workspaceRoot: string,
        reviewId: string,
        kind: "report" | "findings"
      ) => Promise<WorkspaceFile>;
      revealReviewArtifacts?: (
        workspaceRoot: string,
        reviewId: string
      ) => Promise<{ status: string }>;
      writeProjectFile?: (filePath: string, content: string) => Promise<WorkspaceFile>;
      reloadSkillPackages?: (workspaceRoot?: string) => Promise<SkillPackageReloadResult>;
      importSkillPackage?: () => Promise<CodeeSkillPackage | null>;
      saveSkillRun?: (
        workspaceRoot: string,
        run: SkillRun,
        manifest: CodeeSkillManifestV1,
        capsules: ActiveSkillCapsule[],
        instructions: string,
        validation?: SkillRunValidation
      ) => Promise<void>;
      listSkillRuns?: (workspaceRoot: string) => Promise<SkillRun[]>;
      writeSkillArtifact?: (
        workspaceRoot: string,
        request: SkillArtifactWriteRequest
      ) => Promise<SkillArtifactReference>;
      approveSkillRunArtifacts?: (workspaceRoot: string, skillRunId: string) => Promise<SkillRun>;
      setSkillRunStatus?: (
        workspaceRoot: string,
        skillRunId: string,
        status: "awaiting_user" | "cancelled"
      ) => Promise<SkillRun>;
      createWorkspaceFolder?: (folderPath: string) => Promise<{ path: string }>;
      renameWorkspacePath?: (sourcePath: string, destinationPath: string) => Promise<{ from: string; to: string }>;
      deleteWorkspacePath?: (targetPath: string) => Promise<{ hasUndo: boolean }>;
      restoreLastDeletedWorkspacePath?: () => Promise<{ restoredPath: string | null }>;
      undoLastWorkspaceWrite?: (filePath: string) => Promise<{ file: WorkspaceFile | null; hasUndo: boolean }>;
      createWorkspaceFileSnapshot?: (filePath: string) => Promise<{ snapshotId: string; filePath: string; existed: boolean }>;
      createWorkspaceDiff?: (filePath: string, proposedContent: string) => Promise<{
        snapshotId: string;
        beforeContent: string;
        afterContent: string;
        diff: string;
      }>;
      applyWorkspacePatch?: (
        filePath: string,
        newContent: string,
        snapshotId?: string,
        restoreOptions?: {
          reason?: RestorePointReason;
          label?: string;
          relatedRunId?: string;
          relatedChangeIds?: string[];
        }
      ) => Promise<{
        snapshotId: string;
        file: WorkspaceFile;
        diff: string;
        restorePointId?: string;
      }>;
      restoreWorkspaceSnapshot?: (snapshotId: string) => Promise<{ restored: boolean; snapshotId: string; file: WorkspaceFile | null }>;
      createPatchPreview?: (filePath: string, proposedContent: string) => Promise<{
        snapshotId: string;
        beforeContent: string;
        afterContent: string;
        diff: string;
      }>;
      applyPatchWithRestorePoint?: (
        filePath: string,
        proposedContent: string,
        reason?: RestorePointReason
      ) => Promise<{
        snapshotId: string;
        file: WorkspaceFile;
        diff: string;
        restorePointId?: string;
      }>;
      rollbackPatch?: (restorePointId: string) => Promise<RestoreResult>;
      previewAgentPatch?: (proposal: AgentPatchProposal) => Promise<AgentPatchPreview>;
      approveAgentPatch?: (proposalId: string, approvalVersion: string) => Promise<AgentPatchPreview>;
      rejectAgentPatch?: (proposalId: string) => Promise<AgentPatchPreview>;
      applyAgentPatch?: (proposalId: string) => Promise<AgentPatchApplyResult>;
      rollbackAgentPatch?: (restorePointId: string) => Promise<AgentPatchApplyResult>;
      normalizeWorkspaceContextPaths?: (workspaceRoot: string, candidates: string[]) => Promise<string[]>;
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
      listBackups?: () => Promise<BackupSummary[]>;
      createBackup?: () => Promise<BackupSummary>;
      restoreBackup?: (backupId: string) => Promise<RestoreSummary>;
      openBackupsFolder?: (backupId?: string) => Promise<{ status: "ok" }>;
      openInSystemExplorer?: (targetPath?: string) => Promise<{ status: string }>;
      promptTextInput?: (request: {
        title: string;
        label: string;
        value: string;
        confirmText?: string;
        cancelText?: string;
      }) => Promise<string | null>;
      terminalExec?: (request: import("@dbzs/shared").TerminalCommandRequest) => Promise<{
        stdout: string;
        stderr: string;
        code: number;
      }>;
      terminalStop?: (sessionId?: string) => Promise<{ stopped: boolean }>;
      terminalSessionStart?: (sessionId: string, cwd?: string) => Promise<{ started: boolean; reason?: string }>;
      terminalSessionWrite?: (sessionId: string, input: string) => Promise<{ written: boolean }>;
      terminalSessionKill?: (sessionId: string) => Promise<{ killed: boolean }>;
      onTerminalOutput?: (callback: (sessionId: string, data: string, stream: "stdout" | "stderr") => void) => () => void;
      onTerminalExit?: (callback: (sessionId: string, code: number) => void) => () => void;
      listAllowedCommands?: () => Promise<AllowedCommand[]>;
      executeSafeCommand?: (workspaceRoot: string, commandId: string) => Promise<CommandRunStatus>;
      cancelSafeCommand?: (runId: string) => Promise<{ cancelled: boolean }>;
      getSafeCommandRunStatus?: (runId: string) => Promise<CommandRunStatus>;
      streamSafeCommandLogs?: (runId: string) => Promise<CommandRunLogs>;
      executeWebSearch?: (request: AgentWebSearchRequest) => Promise<AgentWebSearchResult>;
      executeWebFetch?: (request: AgentWebFetchRequest) => Promise<AgentWebDocument>;
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
      getWorkspaceState?: () => Promise<WorkspaceState>;
      setWorkspaceState?: (state: WorkspaceState) => Promise<WorkspaceState>;
      openSettingsWindow?: () => Promise<{ status: string }>;
      openRuntimeChatWindow?: () => Promise<{ status: string }>;
      closeRuntimeChatWindow?: () => Promise<{ status: string }>;
      openPlatformDiagnosticsWindow?: () => Promise<{ status: string }>;
      closePlatformDiagnosticsWindow?: () => Promise<{ status: string }>;
      publishRuntimeChatContext?: (context: import("@/types/runtimeChatWindow").RuntimeChatContextSnapshot) => Promise<{ status: string }>;
      getRuntimeChatContext?: () => Promise<import("@/types/runtimeChatWindow").RuntimeChatContextSnapshot | null>;
      onRuntimeChatWindowState?: (listener: (state: import("@/types/runtimeChatWindow").RuntimeChatWindowState) => void) => () => void;
      onRuntimeChatContext?: (listener: (context: import("@/types/runtimeChatWindow").RuntimeChatContextSnapshot | null) => void) => () => void;
      getModelIndex: () => Promise<ModelIndex>;
      saveManualMultimodalPairing?: (
        request: import("@dbzs/shared").ManualMultimodalPairingRequest
      ) => Promise<import("@dbzs/shared").MultimodalPair>;
      getRuntimeStatus: () => Promise<RuntimeStatus>;
      startRuntimeModel: (modelId: string) => Promise<RuntimeStatus>;
      stopRuntimeModel: () => Promise<RuntimeStatus>;
      sendRuntimeChat: (request: RuntimeChatRequest, requestId?: string) => Promise<RuntimeChatResponse>;
      streamRuntimeChat?: (
        request: RuntimeChatRequest,
        onChunk: (payload: { delta: string; totalLength: number }) => void
      ) => Promise<RuntimeChatResponse>;
      cancelRuntimeChatStream?: () => Promise<{ status: string }>;
      runBenchmark?: () => Promise<import("@dbzs/shared").BenchmarkResult>;
      runModelTest?: () => Promise<import("@dbzs/shared").RuntimeModelTestReport>;
      listOrchestrationTools?: () => Promise<unknown>;
      prepareOrchestrationContext?: (request: unknown) => Promise<unknown>;
      executeOrchestrationTool?: (request: unknown) => Promise<unknown>;
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
      getAgentRunnerStatus?: () => Promise<AgentRunnerStatus>;
      runAgentOnce?: (request: AgentRunOnceRequest) => Promise<AgentRunResult>;
      gitStatus?: (projectPath: string) => Promise<{
        status: string;
        stderr: string;
        code: number;
        branch: string;
        files: Array<{ path: string; staged: string; unstaged: string; untracked: boolean }>;
      }>;
      gitBranch?: (projectPath: string) => Promise<{
        current: string;
        branches: string[];
        stderr: string;
        code: number;
      }>;
      gitRemotes?: (projectPath: string) => Promise<{
        remotes: string[];
        defaultRemote: string;
        status: string;
        stderr: string;
        code: number;
      }>;
      gitUpstreamStatus?: (projectPath: string) => Promise<{
        aheadCount: number;
        behindCount: number;
        hasUpstream: boolean;
        status: string;
        stderr: string;
        code: number;
      }>;
      gitMergeStatus?: (projectPath: string) => Promise<{
        mergeInProgress: boolean;
        hasConflicts: boolean;
        conflictFiles: string[];
        status: string;
        stderr: string;
        code: number;
      }>;
      gitSetUpstream?: (projectPath: string, branch: string, remote?: string) => Promise<{ status: string; stderr: string; code: number }>;
      gitPush?: (projectPath: string) => Promise<{ status: string; stderr: string; code: number }>;
      gitPull?: (projectPath: string) => Promise<{ status: string; stderr: string; code: number }>;
      gitCommit?: (projectPath: string, message: string) => Promise<{ status: string; stderr: string; code: number }>;
      gitMerge?: (projectPath: string, branch: string) => Promise<{ status: string; stderr: string; code: number }>;
      gitMergeAbort?: (projectPath: string) => Promise<{ status: string; stderr: string; code: number }>;
      gitMergeContinue?: (projectPath: string) => Promise<{ status: string; stderr: string; code: number }>;
      gitApplyPatch?: (projectPath: string, patch: string) => Promise<{ status: string; stderr: string; code: number }>;
      listProjectMemory: (workspace: string) => Promise<ProjectMemoryEntry[]>;
      upsertProjectMemory: (request: ProjectMemoryUpsertRequest) => Promise<ProjectMemoryEntry>;
      deleteProjectMemory: (entryId: number) => Promise<{ status: string; id: number }>;
      listTasks: () => Promise<TaskBoardItem[]>;
      createTask: (request: TaskCreateRequest) => Promise<TaskBoardItem>;
      updateTask: (taskId: string, request: TaskUpdateRequest) => Promise<TaskBoardItem>;
      deleteTask: (taskId: string) => Promise<{ status: string }>;
      analyzeDocs: (workspaceRoot: string, maxFiles?: number) => Promise<DocsAnalysisSummary>;
      generateDocs: (request: DocsGenerateRequest) => Promise<DocsGenerateResponse>;
      reloadBackend?: () => Promise<{ status: string; port: number }>;
      restartFrontend?: () => Promise<{ status: string; windows: number }>;
      getBackendStartupStatus?: () => Promise<BackendStartupStatus>;
      onBackendStartupStatus?: (listener: (status: BackendStartupStatus) => void) => () => void;
      onMenuAction?: (listener: (action: string) => void) => () => void;
      getBootState?: () => Promise<BootState>;
      onBootState?: (listener: (state: BootState) => void) => () => void;
      reportBootPhaseState?: (
        phaseId: string,
        state: "success" | "failed",
        message: string,
        progress?: number,
        metadata?: Record<string, unknown>
      ) => Promise<void>;
      retryBootPhase?: (phaseId: string | null) => Promise<void>;
      restartBootBackend?: () => Promise<void>;
      useFallbackResidentModel?: () => Promise<void>;
      exportBootDiagnostics?: () => Promise<string>;
      enterBootSafeMode?: () => Promise<void>;
      isBootSafeMode?: () => Promise<boolean>;
      quitApp?: () => Promise<void>;
      getRuntimeAgentState?: (workspaceRoot: string) => Promise<{
        pendingApproval: unknown;
        pendingApplyApproval: unknown;
        timeline: Array<{ id: string; title: string; description: string; createdAt: string }>;
        lastResult: unknown;
        updatedAt: string;
      } | null>;
      setRuntimeAgentState?: (
        workspaceRoot: string,
        state: {
          pendingApproval: unknown;
          pendingApplyApproval: unknown;
          timeline: Array<{ id: string; title: string; description: string; createdAt: string }>;
          lastResult: unknown;
          updatedAt: string;
        }
      ) => Promise<unknown>;
    };
  }
}

export {};
