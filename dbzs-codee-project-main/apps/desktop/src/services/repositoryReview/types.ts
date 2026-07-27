/**
 * Local re-exports + orchestrator-internal types for repository review.
 */
export type {
  RepositoryReviewRequest,
  RepositoryReviewPlan,
  RepositoryReviewReport,
  RepositoryReviewFinding,
  RepositoryReviewOutcome,
  RepositoryReviewStatus,
  RepositoryReviewScope,
  RepositoryReviewDepth,
  RepositoryReviewProgress,
  ReviewBatchAnalyzerDiagnostics,
  BatchAnalysisResult,
  LlmFindingParseResult,
  ReviewQualityAssessment,
  ProductionReadinessAssessment,
  ReviewRemediationCapsule,
  ReviewFindingResolution,
  ReviewArtifactSummary,
  RepositoryInventory,
  ReviewBatchPlan,
  ReviewCommandPlan,
  ReviewBatchBudget,
  ExecutedReviewCheck,
  ExecutedReviewCheckStatus
} from "@dbzs/shared";

export const REPOSITORY_REVIEW_WORKFLOW_ID = "repository_review" as const;
export const CODE_REVIEW_INTENT_LABEL = "code_review" as const;
export const REVIEW_SCHEMA_VERSION = 2;

export interface ReviewStateFile {
  schemaVersion: number;
  reviewId: string;
  workspaceId: string;
  workspaceRoot: string;
  status: import("@dbzs/shared").RepositoryReviewStatus;
  outcome?: import("@dbzs/shared").RepositoryReviewOutcome;
  createdAt: string;
  updatedAt: string;
  completedBatchIds: string[];
  currentBatchId?: string;
  artifactDir: string;
  analyzerDiagnostics?: import("@dbzs/shared").ReviewBatchAnalyzerDiagnostics[];
  quality?: import("@dbzs/shared").ReviewQualityAssessment;
}

export interface ReviewWorkspaceFileEntry {
  relativePath: string;
  bytes: number;
  lines?: number;
}

export interface ReviewWorkspaceIO {
  listFiles(workspaceRoot: string): Promise<ReviewWorkspaceFileEntry[]>;
  readText(workspaceRoot: string, relativePath: string): Promise<string | null>;
  writeText(workspaceRoot: string, relativePath: string, content: string): Promise<void>;
  pathExists(workspaceRoot: string, relativePath: string): Promise<boolean>;
  getGitState?(workspaceRoot: string): Promise<{
    branch?: string;
    dirty: boolean;
    changedFiles: string[];
  }>;
  runCommand?(input: {
    cwd: string;
    command: string;
    timeoutMs: number;
  }): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>;
}

export interface BatchAnalysisInput {
  batch: import("@dbzs/shared").ReviewBatchPlan;
  files: Array<{ path: string; content: string }>;
  request: import("@dbzs/shared").RepositoryReviewRequest;
  inventory: import("@dbzs/shared").RepositoryInventory;
}

export type BatchAnalyzer = (
  input: BatchAnalysisInput
) => Promise<import("@dbzs/shared").BatchAnalysisResult>;
