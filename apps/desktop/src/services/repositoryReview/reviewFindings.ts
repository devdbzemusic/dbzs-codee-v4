import type { RepositoryReviewFinding } from "@dbzs/shared";

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

export function findingDedupeKey(
  workspaceId: string,
  finding: Pick<RepositoryReviewFinding, "path" | "lineStart" | "category" | "title">
): string {
  return [
    workspaceId,
    finding.path.replace(/\\/g, "/"),
    String(finding.lineStart ?? ""),
    finding.category,
    normalizeTitle(finding.title)
  ].join("|");
}

export function dedupeRepositoryReviewFindings(
  workspaceId: string,
  findings: RepositoryReviewFinding[]
): RepositoryReviewFinding[] {
  const seen = new Map<string, RepositoryReviewFinding>();
  for (const finding of findings) {
    if (finding.needsVerification) {
      // Keep hypotheses separate; still dedupe among themselves.
      const key = `hyp|${findingDedupeKey(workspaceId, finding)}`;
      if (!seen.has(key)) seen.set(key, finding);
      continue;
    }
    const key = findingDedupeKey(workspaceId, finding);
    if (!seen.has(key)) {
      seen.set(key, finding);
    }
  }
  return [...seen.values()];
}

export function filterFindingsToExistingPaths(
  findings: RepositoryReviewFinding[],
  existingPaths: Set<string>
): RepositoryReviewFinding[] {
  return findings.filter((f) => {
    const path = f.path.replace(/\\/g, "/");
    if (!existingPaths.has(path)) return false;
    if (!f.evidence?.trim()) return false;
    return true;
  });
}

export function countSeverities(
  findings: RepositoryReviewFinding[]
): Partial<Record<RepositoryReviewFinding["severity"], number>> {
  const counts: Partial<Record<RepositoryReviewFinding["severity"], number>> = {};
  for (const finding of findings) {
    if (finding.needsVerification) continue;
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
}

export function createFindingId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}
