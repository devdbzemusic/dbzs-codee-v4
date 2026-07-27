import type {
  ExecutedReviewCheck,
  RepositoryInventory,
  RepositoryReviewFinding,
  RepositoryReviewOutcome,
  RepositoryReviewPlan,
  RepositoryReviewRequest,
  RepositoryReviewReport,
  ReviewBatchAnalyzerDiagnostics,
  ReviewFindingResolution,
  ReviewQualityAssessment
} from "@dbzs/shared";
import { REVIEW_SCHEMA_VERSION, type ReviewStateFile, type ReviewWorkspaceIO } from "./types";

function reviewsRoot(reviewId: string): string {
  return `.codee/reviews/${reviewId}`;
}

export function reviewArtifactPaths(reviewId: string) {
  const root = reviewsRoot(reviewId);
  return {
    root,
    request: `${root}/review-request.json`,
    plan: `${root}/review-plan.json`,
    inventory: `${root}/inventory.json`,
    commandResults: `${root}/command-results.json`,
    batchResultsDir: `${root}/batch-results`,
    analyzerDiagnostics: `${root}/analyzer-diagnostics.json`,
    qualityAssessment: `${root}/quality-assessment.json`,
    findings: `${root}/findings.json`,
    report: `${root}/REVIEW_REPORT.md`,
    state: `${root}/review-state.json`,
    remediationState: `${root}/remediation-state.json`,
    remediationReport: `${root}/remediation-report.md`
  };
}

async function writeJson(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  relativePath: string,
  value: unknown
): Promise<void> {
  await io.writeText(workspaceRoot, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  relativePath: string
): Promise<T | null> {
  const raw = await io.readText(workspaceRoot, relativePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function saveReviewRequest(
  io: ReviewWorkspaceIO,
  request: RepositoryReviewRequest,
  reviewId: string
): Promise<void> {
  const paths = reviewArtifactPaths(reviewId);
  await writeJson(io, request.workspaceRoot, paths.request, {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    reviewId,
    ...request
  });
}

export async function saveReviewPlan(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  plan: RepositoryReviewPlan
): Promise<void> {
  const paths = reviewArtifactPaths(plan.reviewId);
  await writeJson(io, workspaceRoot, paths.plan, plan);
}

export async function saveInventory(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string,
  inventory: RepositoryInventory
): Promise<void> {
  const paths = reviewArtifactPaths(reviewId);
  await writeJson(io, workspaceRoot, paths.inventory, inventory);
}

export async function saveCommandResults(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string,
  results: ExecutedReviewCheck[]
): Promise<void> {
  const paths = reviewArtifactPaths(reviewId);
  await writeJson(io, workspaceRoot, paths.commandResults, results);
}

export async function saveBatchResult(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string,
  batchId: string,
  payload: unknown
): Promise<void> {
  const paths = reviewArtifactPaths(reviewId);
  await writeJson(io, workspaceRoot, `${paths.batchResultsDir}/${batchId}.json`, payload);
}

export async function saveAnalyzerDiagnostics(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string,
  diagnostics: ReviewBatchAnalyzerDiagnostics[]
): Promise<void> {
  await writeJson(
    io,
    workspaceRoot,
    reviewArtifactPaths(reviewId).analyzerDiagnostics,
    diagnostics
  );
}

export async function saveQualityAssessment(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string,
  quality: ReviewQualityAssessment
): Promise<void> {
  await writeJson(io, workspaceRoot, reviewArtifactPaths(reviewId).qualityAssessment, quality);
}

export async function saveFindings(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string,
  findings: RepositoryReviewFinding[]
): Promise<void> {
  const paths = reviewArtifactPaths(reviewId);
  await writeJson(io, workspaceRoot, paths.findings, findings);
}

export async function saveReportMarkdown(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string,
  markdown: string
): Promise<void> {
  const paths = reviewArtifactPaths(reviewId);
  await io.writeText(workspaceRoot, paths.report, markdown);
}

export async function saveReviewState(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  state: ReviewStateFile
): Promise<void> {
  const paths = reviewArtifactPaths(state.reviewId);
  await writeJson(io, workspaceRoot, paths.state, state);
}

export async function loadReviewState(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string
): Promise<ReviewStateFile | null> {
  const paths = reviewArtifactPaths(reviewId);
  const state = await readJson<ReviewStateFile>(io, workspaceRoot, paths.state);
  if (!state) return null;
  return {
    ...state,
    schemaVersion: state.schemaVersion ?? 1,
    outcome: normalizePersistedReviewOutcome(state.outcome),
    analyzerDiagnostics: state.analyzerDiagnostics ?? []
  };
}

export function normalizePersistedReviewOutcome(
  outcome: RepositoryReviewOutcome | undefined
): RepositoryReviewOutcome | undefined {
  switch (outcome) {
    case "completed_with_skipped_checks":
      return "completed_with_warnings";
    case "paused":
      return "partial";
    case "inventory_failed":
    case "command_failed":
    case "batch_failed":
    case "context_split_required":
    case "report_generation_failed":
      return "failed";
    default:
      return outcome;
  }
}

export interface ReviewRemediationStateFile {
  schemaVersion: 1;
  reviewId: string;
  workspaceId: string;
  status: "planned" | "in_progress" | "completed" | "failed" | "cancelled";
  selectedFindingIds: string[];
  severityScope: Array<"P0" | "P1" | "P2" | "P3">;
  resolutions: ReviewFindingResolution[];
  createdAt: string;
  updatedAt: string;
}

export async function saveRemediationState(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  state: ReviewRemediationStateFile
): Promise<void> {
  await writeJson(io, workspaceRoot, reviewArtifactPaths(state.reviewId).remediationState, state);
}

export async function loadRemediationState(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string
): Promise<ReviewRemediationStateFile | null> {
  return readJson<ReviewRemediationStateFile>(
    io,
    workspaceRoot,
    reviewArtifactPaths(reviewId).remediationState
  );
}

export async function saveRemediationReport(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string,
  markdown: string
): Promise<void> {
  await io.writeText(workspaceRoot, reviewArtifactPaths(reviewId).remediationReport, markdown);
}

export async function loadReviewPlan(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string
): Promise<RepositoryReviewPlan | null> {
  const paths = reviewArtifactPaths(reviewId);
  return readJson<RepositoryReviewPlan>(io, workspaceRoot, paths.plan);
}

export async function loadFindings(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string
): Promise<RepositoryReviewFinding[] | null> {
  const paths = reviewArtifactPaths(reviewId);
  return readJson<RepositoryReviewFinding[]>(io, workspaceRoot, paths.findings);
}

export async function loadReport(
  io: ReviewWorkspaceIO,
  workspaceRoot: string,
  reviewId: string
): Promise<RepositoryReviewReport | null> {
  const findings = (await loadFindings(io, workspaceRoot, reviewId)) ?? [];
  const commands =
    (await readJson<ExecutedReviewCheck[]>(
      io,
      workspaceRoot,
      reviewArtifactPaths(reviewId).commandResults
    )) ?? [];
  const markdown = await io.readText(workspaceRoot, reviewArtifactPaths(reviewId).report);
  if (!markdown) return null;
  return {
    reviewId,
    summary: markdown.split("\n").slice(0, 40).join("\n"),
    findings,
    executedChecks: commands,
    failedChecks: commands.filter((c) => c.status === "failed"),
    remainingRisks: []
  };
}

export function createInitialReviewState(input: {
  reviewId: string;
  workspaceId: string;
  workspaceRoot: string;
}): ReviewStateFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    reviewId: input.reviewId,
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
    status: "planned",
    createdAt: now,
    updatedAt: now,
    completedBatchIds: [],
    artifactDir: reviewArtifactPaths(input.reviewId).root
  };
}
