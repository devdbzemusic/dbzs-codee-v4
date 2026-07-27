import type { RepositoryReviewDepth, RepositoryReviewRequest, RepositoryReviewScope } from "@dbzs/shared";

const COMPLETE_REVIEW_PATTERNS = [
  "kompletten codereview",
  "kompletter codereview",
  "komplette codereview",
  "vollständigen codereview",
  "vollstaendigen codereview",
  "vollständigen code review",
  "kompletten code review",
  "full code review",
  "full repository review",
  "complete code review",
  "entire codebase review",
  "gesamtes projekt review",
  "gesamtes projekt prüfen",
  "gesamtes projekt pruefen",
  "repo review komplett",
  "review des gesamten"
];

function looksLikeReviewPhrase(cleaned: string): boolean {
  return (
    cleaned.includes("codereview") ||
    cleaned.includes("code review") ||
    cleaned.includes("code-review") ||
    /\breview\b/.test(cleaned) ||
    cleaned.includes("prüfe den code") ||
    cleaned.includes("prufe den code") ||
    cleaned.includes("code prüfen")
  );
}

/**
 * True when the user asked for a full-repository review (no scope clarification needed).
 */
export function matchesCompleteRepositoryReviewIntent(userMessage: string): boolean {
  const cleaned = userMessage.toLowerCase().replace(/\s+/g, " ").trim();
  if (!looksLikeReviewPhrase(cleaned)) {
    return false;
  }
  if (COMPLETE_REVIEW_PATTERNS.some((p) => cleaned.includes(p))) {
    return true;
  }
  const hasComplete =
    /\b(komplett\w*|vollständig\w*|vollstaendig\w*|full|entire|whole|gesamt\w*)\b/i.test(cleaned);
  const hasReview = /\b(code\s*review|codereview|repository\s*review|repo\s*review)\b/i.test(cleaned);
  return hasComplete && hasReview;
}

export function resolveRepositoryReviewScope(
  userMessage: string,
  answeredTarget?: string | null
): RepositoryReviewScope | null {
  if (matchesCompleteRepositoryReviewIntent(userMessage)) {
    return "full_repository";
  }
  const target = (answeredTarget ?? "").toLowerCase();
  switch (target) {
    case "active_file":
      return "active_file";
    case "uncommitted":
    case "uncommitted_changes":
      return "uncommitted_changes";
    case "last_commit":
      return "last_commit";
    case "project_sample":
    case "full_repository":
    case "gesamtes_projekt":
      return "full_repository";
    case "selected_paths":
      return "selected_paths";
    default:
      break;
  }

  const cleaned = userMessage.toLowerCase();
  if (/(uncommitted|nicht\s+commitet|working\s+tree|diff)/i.test(cleaned)) {
    return "uncommitted_changes";
  }
  if (/(letzter\s+commit|last\s+commit|head~1)/i.test(cleaned)) {
    return "last_commit";
  }
  if (/(aktive\s+datei|active\s+file|diese\s+datei)/i.test(cleaned)) {
    return "active_file";
  }
  if (/(gesamtes\s+projekt|whole\s+project|entire\s+repo|full\s+repo)/i.test(cleaned)) {
    return "full_repository";
  }
  return null;
}

export function buildRepositoryReviewRequest(input: {
  workspaceId: string;
  workspaceRoot: string;
  scope: RepositoryReviewScope;
  selectedPaths?: string[];
  depth?: RepositoryReviewDepth;
  includeBuildChecks?: boolean;
}): RepositoryReviewRequest {
  return {
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
    scope: input.scope,
    selectedPaths: input.selectedPaths,
    depth: input.depth ?? "standard",
    includeBuildChecks: input.includeBuildChecks ?? true,
    includeSecurityReview: true,
    includePerformanceReview: true,
    includeArchitectureReview: true
  };
}
