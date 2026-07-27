import type { RepositoryReviewRunResult } from "./repositoryReviewOrchestrator";

/**
 * Compact chat-message summary for a finished repository review run — distinct
 * from `buildReviewReportMarkdown` (the full `REVIEW_REPORT.md` artifact):
 * this is what the assistant posts back into the conversation.
 */
export function buildChatReviewSummaryLines(
  reviewResult: RepositoryReviewRunResult,
  durationSeconds: number
): string[] {
  const counts = reviewResult.progress.severityCounts ?? {};
  const diagnostics = reviewResult.diagnostics ?? [];
  const quality = reviewResult.quality;
  const passedChecks = reviewResult.progress.checks.filter((check) => check.status === "passed");
  const skippedChecks = reviewResult.progress.checks.filter(
    (check) => check.status === "not_available" || check.status === "not_executed"
  );
  const topFindings = reviewResult.findings.filter((finding) => !finding.needsVerification).slice(0, 3);

  return [
    "Repository Review abgeschlossen",
    "",
    `Dauer: ${Math.floor(durationSeconds / 60)} min ${durationSeconds % 60} s`,
    `Abdeckung: ${quality?.reviewedFileCount ?? 0}/${quality?.plannedFileCount ?? 0} Dateien · ${reviewResult.progress.completedBatches}/${reviewResult.progress.totalBatches} Batches`,
    `Analyzer: LLM ${diagnostics.filter((entry) => entry.llmSucceeded).length}/${diagnostics.length} erfolgreich · Heuristik ${diagnostics.filter((entry) => entry.heuristicExecuted).length}/${diagnostics.length}`,
    `Qualitätsstatus: ${quality?.confidence ?? "unbekannt"} · Outcome ${reviewResult.outcome}`,
    "",
    `Checks: ${passedChecks.length} erfolgreich · ${skippedChecks.length} nicht verfügbar/ausgeführt`,
    `Findings: P0 ${counts.P0 ?? 0} · P1 ${counts.P1 ?? 0} · P2 ${counts.P2 ?? 0} · P3 ${counts.P3 ?? 0}`,
    ...(topFindings.length
      ? [
          "",
          "Top Findings:",
          ...topFindings.map(
            (finding, index) => `${index + 1}. [${finding.severity}] ${finding.title} · ${finding.path}`
          )
        ]
      : ["", "Top Findings: keine bestätigten Findings"]),
    ...(quality?.warnings.length
      ? ["", "Verbleibende Unsicherheiten:", ...quality.warnings.map((warning) => `- ${warning}`)]
      : []),
    "",
    `Report: ${reviewResult.progress.reportPath ?? "nicht erzeugt"}`,
    `Findings: ${reviewResult.progress.findingsPath ?? "nicht erzeugt"}`,
    `Artefaktordner: ${reviewResult.artifactDir}`
  ].filter(Boolean);
}

export function isSuccessfulReviewOutcome(outcome: RepositoryReviewRunResult["outcome"]): boolean {
  return (
    outcome === "completed" ||
    outcome === "completed_with_warnings" ||
    outcome === "degraded_heuristic_only"
  );
}
