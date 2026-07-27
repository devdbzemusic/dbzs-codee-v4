import { useMemo, useState } from "react";
import type {
  GitDiffSummary,
  GitRepositoryStatus,
  ProjectMemory,
  ProposedChange,
  ReviewFinding,
  ReviewFindingSeverity,
  ReviewReport
} from "@dbzs/shared";
import { ReviewAgentService } from "@/services/reviewAgentService";
import { useReviewStatusStore } from "@/stores/reviewStatusStore";

interface ReviewAgentPanelProps {
  pendingChanges: ProposedChange[];
  appliedChanges: ProposedChange[];
  projectMemory?: ProjectMemory | null;
  relevantFiles?: string[];
  gitRepositoryStatus?: GitRepositoryStatus | null;
  gitDiffSummary?: GitDiffSummary[];
}

interface GitRiskFile {
  filePath: string;
  score: number;
  additions: number;
  deletions: number;
  hasConflict: boolean;
}

function severityClass(severity: ReviewFindingSeverity): string {
  if (severity === "error") {
    return "border-dbzs-red/60 bg-dbzs-red/10 text-dbzs-red";
  }
  if (severity === "warning") {
    return "border-dbzs-amber/60 bg-dbzs-amber/10 text-dbzs-amber";
  }
  return "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan";
}

function findingKey(finding: ReviewFinding): string {
  return `${finding.id}:${finding.filePath ?? "global"}:${finding.line ?? 0}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeGitRisk(gitRepositoryStatus?: GitRepositoryStatus | null, gitDiffSummary: GitDiffSummary[] = []): {
  overallScore: number;
  overallLevel: "low" | "medium" | "high";
  hasConflicts: boolean;
  hasLargeDiffs: boolean;
  hasManyChanges: boolean;
  files: GitRiskFile[];
} {
  const entries = gitRepositoryStatus?.entries ?? [];
  const hasConflicts = entries.some((entry) => entry.status === "conflicted");
  const hasManyChanges = entries.length >= 20;
  const hasLargeDiffs = gitDiffSummary.some((entry) => entry.additions + entry.deletions >= 300);

  const statusByFile = new Map(entries.map((entry) => [entry.filePath, entry.status]));
  const files = gitDiffSummary
    .map((entry) => {
      const churn = entry.additions + entry.deletions;
      const hasConflict = statusByFile.get(entry.filePath) === "conflicted";
      let score = 0;

      if (hasConflict) {
        score += 60;
      }
      if (churn >= 500) {
        score += 30;
      } else if (churn >= 300) {
        score += 22;
      } else if (churn >= 150) {
        score += 14;
      } else if (churn >= 60) {
        score += 8;
      } else if (churn > 0) {
        score += 4;
      }

      if (/backend\/|electron\/main\.ts$|electron\/preload\.ts$|packages\/shared\/src\/index\.ts$/i.test(entry.filePath)) {
        score += 8;
      }

      return {
        filePath: entry.filePath,
        score: clamp(score, 0, 100),
        additions: entry.additions,
        deletions: entry.deletions,
        hasConflict
      } satisfies GitRiskFile;
    })
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));

  let overallScore = 0;
  if (hasConflicts) {
    overallScore += 45;
  }
  if (hasLargeDiffs) {
    overallScore += 30;
  }
  if (hasManyChanges) {
    overallScore += 20;
  }

  const topFileRisk = files.slice(0, 3).reduce((sum, file) => sum + file.score, 0);
  const topFileRiskAvg = files.length > 0 ? topFileRisk / Math.min(files.length, 3) : 0;
  overallScore = clamp(Math.round(overallScore + topFileRiskAvg * 0.4), 0, 100);

  const overallLevel = overallScore >= 70 ? "high" : overallScore >= 35 ? "medium" : "low";

  return {
    overallScore,
    overallLevel,
    hasConflicts,
    hasLargeDiffs,
    hasManyChanges,
    files
  };
}

function overallTone(level: "low" | "medium" | "high"): string {
  if (level === "high") {
    return "border-dbzs-red/60 bg-dbzs-red/10 text-dbzs-red";
  }
  if (level === "medium") {
    return "border-dbzs-amber/60 bg-dbzs-amber/10 text-dbzs-amber";
  }
  return "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan";
}

function fileBarTone(score: number): string {
  if (score >= 70) {
    return "bg-dbzs-red";
  }
  if (score >= 35) {
    return "bg-dbzs-amber";
  }
  return "bg-dbzs-cyan";
}

export function ReviewAgentPanel({
  pendingChanges,
  appliedChanges,
  projectMemory,
  relevantFiles = [],
  gitRepositoryStatus,
  gitDiffSummary = []
}: ReviewAgentPanelProps) {
  const service = useMemo(() => new ReviewAgentService(), []);
  const setLatestReport = useReviewStatusStore((state) => state.setLatestReport);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [severityFilter, setSeverityFilter] = useState<ReviewFindingSeverity | "all">("all");
  const [scope, setScope] = useState<"proposed" | "applied">("proposed");
  const gitRisk = useMemo(() => computeGitRisk(gitRepositoryStatus, gitDiffSummary), [gitDiffSummary, gitRepositoryStatus]);

  const activeFindings = report
    ? report.findings.filter((finding) => severityFilter === "all" || finding.severity === severityFilter)
    : [];

  const runReview = () => {
    const baseReport = scope === "proposed"
      ? service.reviewProposedChanges(pendingChanges)
      : service.reviewAppliedChanges(appliedChanges);
    const withIssues = service.withKnownIssues(baseReport, projectMemory?.knownIssues ?? []);
    const withFiles = service.withRelevantFiles(withIssues, relevantFiles);
    const nextReport = service.withGitContext(withFiles, gitRepositoryStatus, gitDiffSummary);
    setReport(nextReport);
    setLatestReport(nextReport);
  };

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Review Agent</h3>
          <p className="mt-1 text-[11px] text-dbzs-muted">
            Bewertet Aenderungen qualitativ und markiert Risiken ohne automatische Fixes.
          </p>
        </div>
        <button
          className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan"
          onClick={runReview}
          type="button"
        >
          Review ausfuehren
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <label className="text-dbzs-muted">Scope:</label>
        <button
          className={`border px-2 py-1 ${scope === "proposed" ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan" : "border-dbzs-border bg-dbzs-bg text-dbzs-muted"}`}
          onClick={() => setScope("proposed")}
          type="button"
        >
          Proposed
        </button>
        <button
          className={`border px-2 py-1 ${scope === "applied" ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan" : "border-dbzs-border bg-dbzs-bg text-dbzs-muted"}`}
          onClick={() => setScope("applied")}
          type="button"
        >
          Applied
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <label className="text-dbzs-muted">Severity:</label>
        {(["all", "error", "warning", "info"] as const).map((severity) => (
          <button
            className={`border px-2 py-1 ${severityFilter === severity ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan" : "border-dbzs-border bg-dbzs-bg text-dbzs-muted"}`}
            key={severity}
            onClick={() => setSeverityFilter(severity)}
            type="button"
          >
            {severity}
          </button>
        ))}
      </div>

      {gitRepositoryStatus?.isRepository ? (
        <div className="mt-3 border border-dbzs-border bg-dbzs-bg p-2 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-dbzs-muted">Git Risk Heatmap</div>
            <span className={`border px-2 py-0.5 uppercase tracking-wide ${overallTone(gitRisk.overallLevel)}`}>
              {gitRisk.overallLevel} ({gitRisk.overallScore})
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`border px-2 py-0.5 ${gitRisk.hasConflicts ? "border-dbzs-red/60 bg-dbzs-red/10 text-dbzs-red" : "border-dbzs-border bg-dbzs-panel text-dbzs-muted"}`}>
              conflicts {gitRisk.hasConflicts ? "yes" : "no"}
            </span>
            <span className={`border px-2 py-0.5 ${gitRisk.hasLargeDiffs ? "border-dbzs-amber/60 bg-dbzs-amber/10 text-dbzs-amber" : "border-dbzs-border bg-dbzs-panel text-dbzs-muted"}`}>
              large diffs {gitRisk.hasLargeDiffs ? "yes" : "no"}
            </span>
            <span className={`border px-2 py-0.5 ${gitRisk.hasManyChanges ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan" : "border-dbzs-border bg-dbzs-panel text-dbzs-muted"}`}>
              many changes {gitRisk.hasManyChanges ? "yes" : "no"}
            </span>
          </div>

          <div className="mt-2 space-y-1">
            {gitRisk.files.slice(0, 6).map((file) => (
              <div className="border border-dbzs-border bg-dbzs-panel p-1" key={file.filePath}>
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-dbzs-text">{file.filePath}</div>
                  <div className="text-dbzs-muted">{file.score}</div>
                </div>
                <progress
                  className={`mt-1 h-1.5 w-full ${fileBarTone(file.score)}`}
                  max={100}
                  value={file.score}
                />
                <div className="mt-1 text-dbzs-muted">
                  +{file.additions} / -{file.deletions}{file.hasConflict ? " / conflict" : ""}
                </div>
              </div>
            ))}
            {gitRisk.files.length === 0 ? <div className="text-dbzs-muted">Keine diff-basierten Risiken erkannt.</div> : null}
          </div>
        </div>
      ) : null}

      <div className="mt-3 text-[11px] text-dbzs-muted">
        <div>{report ? service.summarizeReview(report) : "Noch kein Review ausgefuehrt."}</div>
        {report ? <div className="mt-1">Dateien: {report.reviewedFiles.join(", ") || "keine"}</div> : null}
      </div>

      <div className="mt-3 space-y-2">
        {report && activeFindings.length === 0 ? (
          <p className="text-[11px] text-dbzs-muted">Keine Findings fuer den aktuellen Filter.</p>
        ) : null}

        {activeFindings.map((finding) => (
          <div className="border border-dbzs-border bg-dbzs-bg p-2 text-[11px] text-dbzs-text" key={findingKey(finding)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`border px-2 py-0.5 uppercase tracking-wide ${severityClass(finding.severity)}`}>
                {finding.severity}
              </span>
              <span className="border border-dbzs-border bg-dbzs-panel px-2 py-0.5 text-dbzs-muted">
                {finding.category}
              </span>
              {finding.filePath ? (
                <span className="truncate border border-dbzs-border bg-dbzs-panel px-2 py-0.5 text-dbzs-muted">
                  {finding.filePath}
                  {finding.line ? `:${finding.line}` : ""}
                </span>
              ) : null}
            </div>
            <div className="mt-1 font-medium">{finding.title}</div>
            <div className="mt-1 text-dbzs-muted">{finding.description}</div>
            {finding.suggestion ? <div className="mt-1 text-dbzs-cyan">Vorschlag: {finding.suggestion}</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
