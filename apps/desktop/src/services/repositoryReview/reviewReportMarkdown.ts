import type {
  ExecutedReviewCheck,
  ProductionReadinessAssessment,
  RepositoryReviewFinding,
  RepositoryReviewReport,
  ReviewBatchAnalyzerDiagnostics,
  ReviewQualityAssessment
} from "@dbzs/shared";
import { countSeverities } from "./reviewFindings";

function severityOrder(s: RepositoryReviewFinding["severity"]): number {
  switch (s) {
    case "P0":
      return 0;
    case "P1":
      return 1;
    case "P2":
      return 2;
    case "P3":
      return 3;
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

export function buildReviewReportMarkdown(input: {
  reviewId: string;
  workspaceRoot: string;
  scope: string;
  findings: RepositoryReviewFinding[];
  executedChecks: ExecutedReviewCheck[];
  remainingRisks?: string[];
  productionReadinessScore?: number;
  productionReadiness?: ProductionReadinessAssessment;
  quality?: ReviewQualityAssessment;
  analyzerDiagnostics?: ReviewBatchAnalyzerDiagnostics[];
}): string {
  const confirmed = input.findings.filter((f) => !f.needsVerification);
  const hypotheses = input.findings.filter((f) => f.needsVerification);
  const counts = countSeverities(confirmed);
  const failed = input.executedChecks.filter((c) => c.status === "failed");
  const skipped = input.executedChecks.filter(
    (c) => c.status === "not_executed" || c.status === "not_available"
  );

  const lines: string[] = [
    `# Repository Review Report`,
    ``,
    `- Review-ID: \`${input.reviewId}\``,
    `- Workspace: \`${input.workspaceRoot}\``,
    `- Scope: \`${input.scope}\``,
    `- Generated: ${new Date().toISOString()}`,
    ``,
    `## Summary`,
    ``,
    `P0: ${counts.P0 ?? 0} · P1: ${counts.P1 ?? 0} · P2: ${counts.P2 ?? 0} · P3: ${counts.P3 ?? 0}`,
    ``,
    `Checks: ${input.executedChecks.filter((c) => c.status === "passed").length} passed, ${failed.length} failed, ${skipped.length} skipped/not available.`,
    ``
  ];

  if (input.quality) {
    lines.push(`## Analysequalität`, ``);
    lines.push(`- Confidence: **${input.quality.confidence}**`);
    lines.push(`- Analyzer-Abdeckung: ${Math.round(input.quality.analyzerCoverage * 100)} %`);
    lines.push(`- Dateien: ${input.quality.reviewedFileCount}/${input.quality.plannedFileCount}`);
    lines.push(
      `- LLM-Batches: ${input.analyzerDiagnostics?.filter((entry) => entry.llmSucceeded).length ?? 0}/${input.analyzerDiagnostics?.length ?? 0}`
    );
    for (const warning of input.quality.warnings) lines.push(`- Warnung: ${warning}`);
    lines.push(``);
  }

  if (typeof input.productionReadiness?.score === "number") {
    lines.push(
      `Production Readiness: **${input.productionReadiness.score}/100** (Confidence: ${input.productionReadiness.confidence})`,
      ``
    );
  } else if (input.productionReadiness) {
    lines.push(
      `Production Readiness: **nicht belastbar**`,
      `Confidence: ${input.productionReadiness.confidence}`,
      ...input.productionReadiness.missingCoverage.map((entry) => `- ${entry}`),
      ``
    );
  } else if (typeof input.productionReadinessScore === "number") {
    lines.push(`Production readiness score: **${input.productionReadinessScore}/100**`, ``);
  }

  lines.push(`## Executed Checks`, ``);
  for (const check of input.executedChecks) {
    const mark =
      check.status === "passed" ? "PASS" : check.status === "failed" ? "FAIL" : check.status.toUpperCase();
    lines.push(`- [${mark}] ${check.purpose}: \`${check.command}\``);
  }
  lines.push(``);

  lines.push(`## Findings`, ``);
  const sorted = [...confirmed].sort(
    (a, b) => severityOrder(a.severity) - severityOrder(b.severity)
  );
  if (sorted.length === 0) {
    lines.push(`_No confirmed findings._`, ``);
  } else {
    for (const finding of sorted) {
      const loc =
        finding.lineStart != null
          ? `${finding.path}:${finding.lineStart}${finding.lineEnd != null ? `-${finding.lineEnd}` : ""}`
          : finding.path;
      lines.push(`### [${finding.severity}] ${finding.title}`);
      lines.push(``);
      lines.push(`- Category: ${finding.category}`);
      lines.push(`- Location: \`${loc}\``);
      lines.push(`- Evidence: ${finding.evidence}`);
      lines.push(`- Impact: ${finding.impact}`);
      lines.push(`- Recommendation: ${finding.recommendation}`);
      if (finding.verification) {
        lines.push(`- Verification: ${finding.verification}`);
      }
      lines.push(``);
    }
  }

  if (hypotheses.length > 0) {
    lines.push(`## Hypotheses (needs verification)`, ``);
    for (const h of hypotheses) {
      lines.push(`- ${h.title} @ \`${h.path}\` — ${h.evidence}`);
    }
    lines.push(``);
  }

  if (input.remainingRisks?.length) {
    lines.push(`## Remaining Risks`, ``);
    for (const risk of input.remainingRisks) {
      lines.push(`- ${risk}`);
    }
    lines.push(``);
  }

  return `${lines.join("\n")}\n`;
}

export function buildRepositoryReviewReport(input: {
  reviewId: string;
  summary: string;
  findings: RepositoryReviewFinding[];
  executedChecks: ExecutedReviewCheck[];
  remainingRisks?: string[];
  productionReadinessScore?: number;
  productionReadiness?: ProductionReadinessAssessment;
  quality?: ReviewQualityAssessment;
  analyzerDiagnostics?: ReviewBatchAnalyzerDiagnostics[];
}): RepositoryReviewReport {
  return {
    reviewId: input.reviewId,
    summary: input.summary,
    findings: input.findings,
    executedChecks: input.executedChecks,
    failedChecks: input.executedChecks.filter((c) => c.status === "failed"),
    remainingRisks: input.remainingRisks ?? [],
    productionReadinessScore: input.productionReadiness?.score ?? input.productionReadinessScore,
    productionReadiness: input.productionReadiness,
    quality: input.quality,
    analyzerDiagnostics: input.analyzerDiagnostics
  };
}

export function estimateProductionReadinessScore(input: {
  findings: RepositoryReviewFinding[];
  executedChecks: ExecutedReviewCheck[];
}): number {
  const counts = countSeverities(input.findings.filter((f) => !f.needsVerification));
  let score = 100;
  score -= (counts.P0 ?? 0) * 25;
  score -= (counts.P1 ?? 0) * 10;
  score -= (counts.P2 ?? 0) * 4;
  score -= (counts.P3 ?? 0) * 1;
  const failed = input.executedChecks.filter((c) => c.status === "failed").length;
  score -= failed * 8;
  return Math.max(0, Math.min(100, score));
}
