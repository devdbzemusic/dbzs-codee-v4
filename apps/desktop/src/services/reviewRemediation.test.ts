import { describe, expect, it } from "vitest";
import type { RepositoryReviewFinding, ReviewArtifactSummary } from "@dbzs/shared";
import {
  buildReviewRemediationCapsule,
  buildReviewSelectionQuestion,
  extractRemediationScope,
  extractReviewId,
  formatReviewRemediationCapsule,
  loadReviewFindingsForRemediation,
  ReviewRemediationLoadError,
  resolveReviewRemediationAgent,
  selectRemediationFindings
} from "./reviewRemediation";

const findings: RepositoryReviewFinding[] = [
  {
    id: "finding-p2",
    severity: "P2",
    category: "testing",
    path: "src/b.ts",
    title: "Test fehlt",
    evidence: "Kein Test",
    impact: "Regression",
    recommendation: "Test ergänzen"
  },
  {
    id: "finding-p0",
    severity: "P0",
    category: "security",
    path: "src/a.ts",
    lineStart: 2,
    title: "Unsicher",
    evidence: "Offener Zugriff",
    impact: "Datenverlust",
    recommendation: "Autorisieren"
  },
  {
    id: "finding-p3",
    severity: "P3",
    category: "maintainability",
    path: "src/c.ts",
    title: "Lesbarkeit",
    evidence: "Komplex",
    impact: "Wartung",
    recommendation: "Vereinfachen"
  }
];

const review: ReviewArtifactSummary = {
  reviewId: "rev-regression-001",
  workspaceId: "workspace-1",
  status: "completed",
  outcome: "completed_with_warnings",
  updatedAt: "2026-07-23T10:00:00.000Z",
  artifactDir: ".codee/reviews/rev-regression-001",
  reportPath: ".codee/reviews/rev-regression-001/REVIEW_REPORT.md",
  findingsPath: ".codee/reviews/rev-regression-001/findings.json"
};

describe("reviewRemediation", () => {
  it("liest Review-ID und deutsche/englische Scope-Varianten", () => {
    expect(extractReviewId("Findings aus rev-regression-001 beheben")).toBe("rev-regression-001");
    expect(extractRemediationScope("nur P0/P1")).toBe("p0_p1");
    expect(extractRemediationScope("P0–P2")).toBe("p0_p2");
    expect(extractRemediationScope("all findings")).toBe("all");
  });

  it("sortiert Review-Auswahl neueste zuerst", () => {
    const question = buildReviewSelectionQuestion([
      { ...review, reviewId: "rev-old-001", updatedAt: "2026-01-01T00:00:00.000Z" },
      review
    ]);
    expect(question.options?.[0]?.id).toBe("rev-regression-001");
    expect(question.options?.[0]?.recommended).toBe(true);
  });

  it("verwendet P0-P2 als deterministischen Default-Scope", () => {
    expect(selectRemediationFindings(findings, "p0_p2").map((finding) => finding.id))
      .toEqual(["finding-p0", "finding-p2"]);
  });

  it("bindet Capsule an Workspace und Review und markiert sie nicht droppbar", () => {
    const capsule = buildReviewRemediationCapsule({
      workspaceId: "workspace-1",
      review,
      findings,
      scope: "individual",
      selectedIds: ["finding-p2"]
    });
    expect(capsule.selectedFindingIds).toEqual(["finding-p2"]);
    expect(capsule.scope).toBe("selected");
    expect(capsule.findings[0]?.id).toBe("finding-p2");
    expect(capsule.totalSelected).toBe(1);
    expect(capsule.remainingFindings).toBe(1);
    expect(formatReviewRemediationCapsule(capsule)).toContain("P0_NON_DROPPABLE");
    expect(formatReviewRemediationCapsule(capsule)).toContain("Planfreigabe");
  });

  it("lädt und filtert Findings deterministisch ohne Modell", async () => {
    const result = await loadReviewFindingsForRemediation({
      workspaceId: "workspace-1",
      selection: {
        workspaceId: "workspace-1",
        reviewId: review.reviewId,
        scope: "p0_p1",
        selectedFindingIds: [],
        reviewConfirmed: true,
        scopeConfirmed: true,
        status: "complete",
        pendingQuestionId: null,
        updatedAt: "2026-07-23T10:00:00.000Z"
      },
      reviews: [review],
      openFindings: async () => ({ content: JSON.stringify(findings) })
    });
    expect(result.findings.map((finding) => finding.id)).toEqual(["finding-p0"]);
    expect(result.capsule.totalSelected).toBe(1);
  });

  it("blockiert Workspace-Mismatch und ungültige Findings", async () => {
    const selection = {
      workspaceId: "foreign",
      reviewId: review.reviewId,
      scope: "all" as const,
      selectedFindingIds: [],
      reviewConfirmed: true,
      scopeConfirmed: true,
      status: "complete" as const,
      pendingQuestionId: null,
      updatedAt: "2026-07-23T10:00:00.000Z"
    };
    await expect(loadReviewFindingsForRemediation({
      workspaceId: "workspace-1",
      selection,
      reviews: [review],
      openFindings: async () => ({ content: "[]" })
    })).rejects.toMatchObject({ code: "workspace_mismatch" } satisfies Partial<ReviewRemediationLoadError>);

    await expect(loadReviewFindingsForRemediation({
      workspaceId: "workspace-1",
      selection: { ...selection, workspaceId: "workspace-1" },
      reviews: [review],
      openFindings: async () => ({ content: JSON.stringify([{ id: "broken" }]) })
    })).rejects.toMatchObject({ code: "findings_invalid" } satisfies Partial<ReviewRemediationLoadError>);
  });

  it("erzwingt Planner → Coder/Test → Reviewer und erlaubt Debugger nur nach Fehler", () => {
    expect(resolveReviewRemediationAgent("planning")).toBe("planner");
    expect(resolveReviewRemediationAgent("implementation")).toBe("coder");
    expect(resolveReviewRemediationAgent("testing")).toBe("coder");
    expect(resolveReviewRemediationAgent("review")).toBe("reviewer");
    expect(resolveReviewRemediationAgent("failed", false)).toBe("planner");
    expect(resolveReviewRemediationAgent("failed", true)).toBe("debugger");
  });
});
