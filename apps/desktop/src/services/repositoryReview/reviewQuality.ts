import type {
  ExecutedReviewCheck,
  ProductionReadinessAssessment,
  RepositoryReviewFinding,
  RepositoryReviewOutcome,
  ReviewBatchAnalyzerDiagnostics,
  ReviewBatchPlan,
  ReviewQualityAssessment
} from "@dbzs/shared";
import { countSeverities } from "./reviewFindings";

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function coverageForDomain(
  domain: ReviewBatchPlan["domain"],
  batches: ReviewBatchPlan[],
  diagnostics: ReviewBatchAnalyzerDiagnostics[]
): "not_run" | "partial" | "complete" {
  const ids = batches.filter((batch) => batch.domain === domain).map((batch) => batch.batchId);
  if (ids.length === 0) return "not_run";
  const successful = diagnostics.filter(
    (entry) => ids.includes(entry.batchId) && entry.llmSucceeded
  ).length;
  if (successful === 0) return "not_run";
  return successful === ids.length ? "complete" : "partial";
}

export function assessReviewQuality(input: {
  findings: RepositoryReviewFinding[];
  diagnostics: ReviewBatchAnalyzerDiagnostics[];
  batches: ReviewBatchPlan[];
  reviewedFileCount: number;
  plannedFileCount: number;
}): ReviewQualityAssessment {
  const attempted = input.diagnostics.filter((entry) => entry.llmAttempted).length;
  const succeeded = input.diagnostics.filter((entry) => entry.llmSucceeded).length;
  const llmFindingCount = input.diagnostics.reduce(
    (sum, entry) => sum + entry.llmFindingCount,
    0
  );
  const analyzerCoverage = attempted > 0 ? succeeded / attempted : 0;
  const titles = input.findings.map((finding) => normalized(finding.title));
  const titleCounts = new Map<string, number>();
  titles.forEach((title) => titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1));
  const largestTitleGroup = Math.max(0, ...titleCounts.values());
  const repeatedGenericFindingRatio =
    input.findings.length > 0 ? largestTitleGroup / input.findings.length : 0;
  const uniqueCategories = new Set(input.findings.map((finding) => finding.category)).size;
  const uniqueSeverities = new Set(input.findings.map((finding) => finding.severity)).size;
  const securityCoverage = coverageForDomain("security_api", input.batches, input.diagnostics);
  const architectureCoverage = coverageForDomain(
    "architecture_dataflow",
    input.batches,
    input.diagnostics
  );
  const performanceCoverage = coverageForDomain(
    "performance_resources",
    input.batches,
    input.diagnostics
  );
  const fileCoverage =
    input.plannedFileCount > 0 ? input.reviewedFileCount / input.plannedFileCount : 0;
  const warnings: string[] = [];

  if (succeeded === 0) warnings.push("LLM-Analyse lieferte keine verwertbare Batch-Abdeckung.");
  if (succeeded > 0 && llmFindingCount === 0) {
    warnings.push("LLM-Antworten waren syntaktisch gültig, enthielten aber keine Findings.");
  }
  if (repeatedGenericFindingRatio >= 0.8 && input.findings.length >= 5) {
    warnings.push("Findings sind überwiegend monotone Wiederholungen einer generischen Regel.");
  }
  if (securityCoverage === "not_run") warnings.push("Security-Abdeckung wurde nicht belastbar ausgeführt.");
  if (architectureCoverage === "not_run") warnings.push("Architektur-Abdeckung wurde nicht belastbar ausgeführt.");
  if (performanceCoverage === "not_run") warnings.push("Performance-Abdeckung wurde nicht belastbar ausgeführt.");
  if (fileCoverage < 1) warnings.push("Nicht alle geplanten Dateien wurden analysiert.");

  const low =
    succeeded === 0 ||
    fileCoverage < 0.75 ||
    (repeatedGenericFindingRatio >= 0.8 &&
      input.findings.length >= 5 &&
      uniqueCategories <= 1);
  const high =
    !low &&
    analyzerCoverage >= 0.8 &&
    llmFindingCount > 0 &&
    fileCoverage === 1 &&
    repeatedGenericFindingRatio < 0.5 &&
    securityCoverage !== "not_run" &&
    architectureCoverage !== "not_run" &&
    performanceCoverage !== "not_run";

  return {
    analyzerCoverage,
    reviewedFileCount: input.reviewedFileCount,
    plannedFileCount: input.plannedFileCount,
    findingCount: input.findings.length,
    uniqueFindingTitles: titleCounts.size,
    uniqueCategories,
    uniqueSeverities,
    repeatedGenericFindingRatio,
    securityCoverage,
    architectureCoverage,
    performanceCoverage,
    confidence: low ? "low" : high ? "high" : "medium",
    warnings
  };
}

export function assessProductionReadiness(input: {
  findings: RepositoryReviewFinding[];
  executedChecks: ExecutedReviewCheck[];
  quality: ReviewQualityAssessment;
  outcome: RepositoryReviewOutcome;
}): ProductionReadinessAssessment {
  const missingCoverage = input.quality.warnings.filter((warning) =>
    /Abdeckung|Dateien|monotone/i.test(warning)
  );
  const basis = [
    `${input.findings.length} bestätigte/hypothetische Findings`,
    `${input.executedChecks.filter((check) => check.status === "passed").length} erfolgreiche Checks`,
    `Analyzer-Abdeckung ${Math.round(input.quality.analyzerCoverage * 100)} %`
  ];

  if (
    input.quality.confidence === "low" ||
    input.outcome === "degraded_heuristic_only" ||
    input.outcome === "partial"
  ) {
    return {
      confidence: "low",
      basis,
      missingCoverage
    };
  }

  const counts = countSeverities(input.findings.filter((finding) => !finding.needsVerification));
  let score = 100;
  score -= (counts.P0 ?? 0) * 25;
  score -= (counts.P1 ?? 0) * 10;
  score -= (counts.P2 ?? 0) * 4;
  score -= (counts.P3 ?? 0);
  score -= input.executedChecks.filter((check) => check.status === "failed").length * 8;

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence: input.quality.confidence,
    basis,
    missingCoverage
  };
}

export function resolveReviewOutcome(input: {
  cancelled?: boolean;
  failed?: boolean;
  completedBatches: number;
  plannedBatches: number;
  timedOutBatches?: number;
  diagnostics: ReviewBatchAnalyzerDiagnostics[];
  checks: ExecutedReviewCheck[];
  quality: ReviewQualityAssessment;
}): RepositoryReviewOutcome {
  if (input.cancelled) return "cancelled";
  if (input.failed || input.plannedBatches === 0) return "failed";
  if (input.completedBatches < input.plannedBatches) return "partial";

  // Batch-Timeouts führen zu "partial", nicht zu "completed_with_warnings".
  // Ein Timeout ist kein normales Analyseversagen — er bedeutet, dass Teile
  // des Repositories gar nicht analysiert wurden.
  if ((input.timedOutBatches ?? 0) > 0) return "partial";

  const successfulLlm = input.diagnostics.filter((entry) => entry.llmSucceeded).length;
  const llmFindings = input.diagnostics.reduce((sum, entry) => sum + entry.llmFindingCount, 0);
  const heuristicFindings = input.diagnostics.reduce(
    (sum, entry) => sum + entry.heuristicFindingCount,
    0
  );
  if (
    successfulLlm === 0 ||
    (llmFindings === 0 &&
      heuristicFindings > 0 &&
      input.quality.repeatedGenericFindingRatio >= 0.8)
  ) {
    return "degraded_heuristic_only";
  }

  const hasFallback = input.diagnostics.some(
    (entry) => entry.mode === "heuristic_fallback" || entry.mode === "failed"
  );
  const hasCheckWarning = input.checks.some((check) => check.status !== "passed");
  if (hasFallback || hasCheckWarning || input.quality.confidence !== "high") {
    return "completed_with_warnings";
  }
  return "completed";
}
