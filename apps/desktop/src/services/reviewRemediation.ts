/*
 * DBZS – Division By Zeros
 * Datei: reviewRemediation.ts
 * Bereich: Desktop Services / Repository Review
 *
 * Zweck:
 *   Löst Review und Finding-Scope deterministisch auf und erzeugt die
 *   nicht droppbare Übergabe-Capsule für den bestehenden Phasen-Workflow.
 */

import type {
  AssistantQuestion,
  ModelTargetAgent,
  RepositoryReviewFinding,
  ReviewArtifactSummary,
  ReviewRemediationCapsule,
  ReviewRemediationSelection
} from "@dbzs/shared";
import { z } from "zod";

export const REVIEW_REMEDIATION_WORKFLOW_ID = "review_remediation";

export type ReviewRemediationScope = "p0_p1" | "p0_p2" | "all" | "individual";

export type ReviewRemediationLoadErrorCode =
  | "review_not_found"
  | "findings_file_missing"
  | "findings_invalid"
  | "workspace_mismatch"
  | "empty_scope";

export class ReviewRemediationLoadError extends Error {
  constructor(public readonly code: ReviewRemediationLoadErrorCode) {
    super(code);
    this.name = "ReviewRemediationLoadError";
  }
}

const findingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  category: z.enum([
    "correctness", "security", "architecture", "performance", "maintainability",
    "testing", "build", "data", "audio", "ux"
  ]),
  path: z.string().min(1),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  title: z.string().min(1),
  evidence: z.string().min(1),
  impact: z.string(),
  recommendation: z.string().min(1),
  verification: z.string().optional(),
  needsVerification: z.boolean().optional(),
  batchId: z.string().optional(),
  source: z.enum(["llm", "heuristic"]).optional()
}).strict();

export function resolveReviewRemediationAgent(
  phase:
    | "clarification"
    | "diagnosis"
    | "planning"
    | "awaiting_plan_approval"
    | "awaiting_dependency_approval"
    | "implementation"
    | "executing"
    | "testing"
    | "awaiting_patch_approval"
    | "verification"
    | "review"
    | "completed"
    | "failed"
    | "cancelled",
  hasConcreteFailure = false
): ModelTargetAgent {
  if (phase === "implementation" || phase === "executing" || phase === "awaiting_patch_approval") {
    return "coder";
  }
  // ModelTargetAgent hat aktuell keinen eigenen Tester-Slot; die bestehende
  // Phase-Invariante erlaubt für Tests deshalb den Coder.
  if (phase === "testing") return "coder";
  if (phase === "verification" || phase === "review" || phase === "completed") return "reviewer";
  if (phase === "diagnosis" || (phase === "failed" && hasConcreteFailure)) return "debugger";
  return "planner";
}

const REVIEW_ID_PATTERN = /\brev-[a-z0-9][a-z0-9-]{2,80}\b/i;

export function extractReviewId(message: string): string | null {
  return message.match(REVIEW_ID_PATTERN)?.[0] ?? null;
}

export function extractRemediationScope(message: string): ReviewRemediationScope | null {
  const normalized = message.toLowerCase();
  if (/\b(p0_p1|p0\s*(?:\/|–|-|bis|to)\s*p1)\b/.test(normalized)) return "p0_p1";
  if (/\b(p0_p2|p0\s*(?:\/|–|-|bis|to)\s*p2)\b/.test(normalized)) return "p0_p2";
  if (/\b(individual|einzeln|einzelne findings?)\b/.test(normalized)) return "individual";
  if (/\b(all|alle findings?|sämtliche)\b/.test(normalized)) return "all";
  return null;
}

export function buildReviewSelectionQuestion(
  reviews: ReviewArtifactSummary[]
): AssistantQuestion {
  const sorted = [...reviews].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  return {
    id: "review-remediation-review-selection",
    questionType: "single_choice",
    prompt: "Welcher abgeschlossene Review soll behoben werden?",
    context: "Die Auswahl bleibt an den aktiven Workspace gebunden.",
    options: sorted.map((review, index) => ({
      id: review.reviewId,
      label: review.reviewId,
      description: `${review.status} · ${review.updatedAt}`,
      recommended: index === 0
    })),
    defaultOptionId: sorted[0]?.reviewId,
    riskLevel: "low",
    toolCallId: "review-remediation-preflight",
    requiredField: "review_selection",
    workflow: "planning"
  };
}

export function buildRemediationScopeQuestion(): AssistantQuestion {
  return {
    id: "review-remediation-scope",
    questionType: "single_choice",
    prompt: "Welche Findings sollen in den Fix-Plan?",
    context: "Vor der anschließenden Planfreigabe werden keine Source-Dateien verändert.",
    options: [
      { id: "p0_p1", label: "Nur P0/P1", description: "Kritische und hohe Risiken." },
      {
        id: "p0_p2",
        label: "P0–P2",
        description: "Kritische, hohe und mittlere Findings.",
        recommended: true
      },
      { id: "all", label: "Alle", description: "Alle offenen Findings." },
      { id: "individual", label: "Einzelne", description: "Finding-IDs gezielt auswählen." }
    ],
    defaultOptionId: "p0_p2",
    riskLevel: "low",
    toolCallId: "review-remediation-preflight",
    requiredField: "remediation_scope",
    workflow: "planning"
  };
}

export function buildFindingSelectionQuestion(
  findings: RepositoryReviewFinding[]
): AssistantQuestion {
  return {
    id: "review-remediation-finding-selection",
    questionType: "multi_choice",
    prompt: "Welche Findings sollen behoben werden?",
    context: "Mehrere Findings können ausgewählt werden.",
    options: findings.slice(0, 100).map((finding) => ({
      id: finding.id,
      label: `${finding.severity.toUpperCase()} · ${finding.title}`,
      description: finding.path
    })),
    riskLevel: "low",
    toolCallId: "review-remediation-preflight",
    requiredField: "remediation_scope",
    workflow: "planning"
  };
}

export function selectRemediationFindings(
  findings: RepositoryReviewFinding[],
  scope: ReviewRemediationScope,
  selectedIds: string[] = []
): RepositoryReviewFinding[] {
  const selected = new Set(selectedIds);
  return findings
    .filter((finding) => {
      if (scope === "all") return true;
      if (scope === "individual") return selected.has(finding.id);
      if (scope === "p0_p1") return finding.severity === "P0" || finding.severity === "P1";
      return ["P0", "P1", "P2"].includes(finding.severity);
    })
    .sort((a, b) =>
      a.path.localeCompare(b.path) ||
      (a.lineStart ?? 0) - (b.lineStart ?? 0) ||
      a.id.localeCompare(b.id)
    );
}

export function buildReviewRemediationCapsule(input: {
  workspaceId: string;
  review: ReviewArtifactSummary;
  findings: RepositoryReviewFinding[];
  scope: ReviewRemediationScope;
  selectedIds?: string[];
}): ReviewRemediationCapsule {
  const selected = selectRemediationFindings(
    input.findings,
    input.scope,
    input.selectedIds
  );
  return {
    workspaceId: input.workspaceId,
    reviewId: input.review.reviewId,
    reportPath: input.review.reportPath,
    findingsPath: input.review.findingsPath,
    scope: input.scope === "individual" ? "selected" : input.scope,
    findings: selected.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      category: finding.category,
      path: finding.path,
      lineStart: finding.lineStart,
      title: finding.title,
      evidence: finding.evidence,
      recommendation: finding.recommendation
    })),
    totalSelected: selected.length,
    selectedFindingIds: selected.map((finding) => finding.id),
    severityScope:
      input.scope === "p0_p1"
        ? ["P0", "P1"]
        : input.scope === "p0_p2"
          ? ["P0", "P1", "P2"]
          : input.scope === "all"
            ? ["P0", "P1", "P2", "P3"]
            : [...new Set(selected.map((finding) => finding.severity))],
    totalFindings: input.findings.length,
    remainingFindings: selected.length
  };
}

/**
 * Lädt und validiert findings.json hostseitig. Kein Modell und kein Tool-Call
 * ist an der Auswahl oder Filterung beteiligt.
 */
export async function loadReviewFindingsForRemediation(input: {
  workspaceId: string;
  selection: ReviewRemediationSelection;
  reviews: ReviewArtifactSummary[];
  openFindings: (reviewId: string) => Promise<{ content: string } | null | undefined>;
}): Promise<{
  review: ReviewArtifactSummary;
  findings: RepositoryReviewFinding[];
  capsule: ReviewRemediationCapsule;
}> {
  if (input.selection.workspaceId !== input.workspaceId) {
    throw new ReviewRemediationLoadError("workspace_mismatch");
  }
  const review = input.reviews.find(
    (candidate) =>
      candidate.reviewId === input.selection.reviewId &&
      candidate.workspaceId === input.workspaceId
  );
  if (!review) throw new ReviewRemediationLoadError("review_not_found");

  const file = await input.openFindings(review.reviewId);
  if (!file) throw new ReviewRemediationLoadError("findings_file_missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    throw new ReviewRemediationLoadError("findings_invalid");
  }
  const validated = z.array(findingSchema).safeParse(parsed);
  if (!validated.success) {
    throw new ReviewRemediationLoadError("findings_invalid");
  }
  const legacyScope: ReviewRemediationScope =
    input.selection.scope === "selected" ? "individual" : input.selection.scope;
  const selected = selectRemediationFindings(
    validated.data,
    legacyScope,
    input.selection.selectedFindingIds
  );
  if (
    selected.length === 0 &&
    !(input.selection.scope === "selected" && input.selection.selectedFindingIds.length === 0)
  ) {
    throw new ReviewRemediationLoadError("empty_scope");
  }
  if (
    input.selection.scope === "selected" &&
    input.selection.selectedFindingIds.some(
      (id) => !validated.data.some((finding) => finding.id === id)
    )
  ) {
    throw new ReviewRemediationLoadError("findings_invalid");
  }
  return {
    review,
    findings: selected,
    capsule: buildReviewRemediationCapsule({
      workspaceId: input.workspaceId,
      review,
      findings: validated.data,
      scope: legacyScope,
      selectedIds: input.selection.selectedFindingIds
    })
  };
}

export function formatReviewRemediationCapsule(
  capsule: ReviewRemediationCapsule
): string {
  return [
    "[REVIEW REMEDIATION CAPSULE — P0_NON_DROPPABLE]",
    `Workspace-ID: ${capsule.workspaceId}`,
    `Review-ID: ${capsule.reviewId}`,
    `Report: ${capsule.reportPath}`,
    `Findings: ${capsule.findingsPath}`,
    `Scope: ${capsule.scope}`,
    `Severity-Scope: ${capsule.severityScope.join(", ") || "individuell"}`,
    `Ausgewählte Finding-IDs: ${capsule.selectedFindingIds.join(", ") || "keine"}`,
    `Gesamt/ausgewählt: ${capsule.totalFindings}/${capsule.remainingFindings}`,
    "Routing: Planung/Freigabe=Planner; Implementierung/Test=Coder/Test-Agent; Verifikation=Reviewer.",
    "Vor Planfreigabe keine Source-Writes. Original findings.json niemals verändern."
  ].join("\n");
}
