import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryReviewFinding, ReviewArtifactSummary } from "@dbzs/shared";
import type { IntentClassification } from "@/services/modelSelectionBroker";

const {
  readSelectionMock,
  writeSelectionMock,
  beginQuestionMock,
  loadReviewFindingsMock,
  upsertActiveTaskContractMock
} = vi.hoisted(() => ({
  readSelectionMock: vi.fn(),
  writeSelectionMock: vi.fn(),
  beginQuestionMock: vi.fn(),
  loadReviewFindingsMock: vi.fn(),
  upsertActiveTaskContractMock: vi.fn((workspaceRoot: string, update: Record<string, unknown>) => ({
    workspaceId: "workspace-1",
    workspaceRoot,
    runId: "run-1",
    acceptanceCriteria: [],
    answeredQuestions: [],
    answeredFields: {},
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    ...update
  }))
}));

vi.mock("@/services/reviewRemediationSelection", () => ({
  beginReviewRemediationQuestion: beginQuestionMock,
  createReviewRemediationSelection: vi.fn(() => ({
    workspaceId: "workspace-1",
    reviewId: null,
    scope: "p0_p2",
    selectedFindingIds: [],
    reviewConfirmed: false,
    scopeConfirmed: false,
    status: "collecting",
    pendingQuestionId: null,
    updatedAt: "2026-07-27T00:00:00.000Z"
  })),
  readReviewRemediationSelection: readSelectionMock,
  writeReviewRemediationSelection: writeSelectionMock
}));

vi.mock("@/services/activeTaskContract", () => ({
  upsertActiveTaskContract: upsertActiveTaskContractMock
}));

vi.mock("@/services/reviewRemediation", async () => {
  const actual = await vi.importActual<typeof import("@/services/reviewRemediation")>("@/services/reviewRemediation");
  return {
    ...actual,
    loadReviewFindingsForRemediation: loadReviewFindingsMock
  };
});

import { runReviewRemediationPhase } from "./reviewRemediationPhase";

const review: ReviewArtifactSummary = {
  reviewId: "rev-ms35mga0-viu2x",
  workspaceId: "workspace-1",
  status: "completed",
  outcome: "completed_with_warnings",
  updatedAt: "2026-07-27T13:40:00.000Z",
  artifactDir: ".codee/reviews/rev-ms35mga0-viu2x",
  reportPath: ".codee/reviews/rev-ms35mga0-viu2x/REVIEW_REPORT.md",
  findingsPath: ".codee/reviews/rev-ms35mga0-viu2x/findings.json"
};

const findings: RepositoryReviewFinding[] = [
  {
    id: "finding-1",
    severity: "P1",
    category: "security",
    path: "src/register.ts",
    title: "Auth fehlt",
    evidence: "Route ohne Schutz",
    impact: "Unbefugter Zugriff",
    recommendation: "Auth ergänzen"
  }
];

const baseIntent: IntentClassification = {
  taskType: "planning",
  confidence: 1,
  matchedPatterns: ["review remediation"],
  alternativeTaskTypes: []
};

describe("runReviewRemediationPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSelectionMock.mockResolvedValue(null);
    writeSelectionMock.mockResolvedValue(undefined);
    beginQuestionMock.mockResolvedValue(undefined);
    loadReviewFindingsMock.mockResolvedValue({
      review,
      findings,
      capsule: {
        workspaceId: "workspace-1",
        reviewId: review.reviewId,
        reportPath: review.reportPath,
        findingsPath: review.findingsPath,
        scope: "p0_p2",
        findings: findings.map((finding) => ({
          id: finding.id,
          severity: finding.severity,
          category: finding.category,
          path: finding.path,
          lineStart: finding.lineStart,
          title: finding.title,
          evidence: finding.evidence,
          recommendation: finding.recommendation
        })),
        totalSelected: 1,
        selectedFindingIds: ["finding-1"],
        severityScope: ["P0", "P1", "P2"],
        totalFindings: 1,
        remainingFindings: 1
      }
    });

    window.dbzs = {
      ...window.dbzs,
      listReviewArtifacts: vi.fn().mockResolvedValue([review]),
      openReviewArtifact: vi.fn().mockResolvedValue({ content: JSON.stringify(findings) })
    };
  });

  it("verwendet explizite Review-ID direkt mit Default-Scope statt den Kombi-Dialog zu fragen", async () => {
    const appendMessages = vi.fn();
    const markActionRemediationReviews = vi.fn();

    const result = await runReviewRemediationPhase({
      trimmedContent: "Findings beheben\nReview-ID: rev-ms35mga0-viu2x",
      workspaceRootForWorkflow: "C:/repo/test-fixtures",
      workspaceRootEarly: null,
      executionIntent: "fix_review_findings",
      activeTaskContract: null,
      intentClassification: baseIntent,
      appendMessages,
      markActionRemediationReviews
    });

    expect(result.kind).toBe("continue");
    expect(writeSelectionMock).toHaveBeenCalledWith(
      "C:/repo/test-fixtures",
      expect.objectContaining({
        reviewId: "rev-ms35mga0-viu2x",
        scope: "p0_p2",
        status: "complete",
        reviewConfirmed: true,
        scopeConfirmed: true
      })
    );
    expect(appendMessages).not.toHaveBeenCalled();
    expect(markActionRemediationReviews).not.toHaveBeenCalled();
    expect(beginQuestionMock).not.toHaveBeenCalled();
  });
});
