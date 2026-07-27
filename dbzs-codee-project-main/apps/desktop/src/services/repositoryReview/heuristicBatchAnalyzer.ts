import type { BatchAnalysisResult, RepositoryReviewFinding } from "@dbzs/shared";
import { createFindingId } from "./reviewFindings";
import type { BatchAnalysisInput, BatchAnalyzer } from "./types";

const TODO_PATTERN = /\b(TODO|FIXME|XXX|HACK)\b/;
const EVAL_PATTERN = /\beval\s*\(/;
const INNER_HTML_PATTERN = /\bdangerouslySetInnerHTML\b|\.innerHTML\s*=/;
const ANY_TYPE_PATTERN = /:\s*any\b|as\s+any\b/;

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

/**
 * Deterministic batch analyzer used for tests and as offline fallback.
 * Only emits findings with path + evidence from the provided file contents.
 */
export function createHeuristicBatchAnalyzer(): BatchAnalyzer {
  return async (input: BatchAnalysisInput): Promise<BatchAnalysisResult> => {
    const findings: RepositoryReviewFinding[] = [];
    let index = 0;

    for (const file of input.files) {
      const content = file.content;
      const path = file.path.replace(/\\/g, "/");

      const push = (
        partial: Omit<RepositoryReviewFinding, "id">
      ) => {
        findings.push({
          id: createFindingId(input.batch.batchId, index++),
          batchId: input.batch.batchId,
          source: "heuristic",
          ...partial
        });
      };

      let match = TODO_PATTERN.exec(content);
      if (match && match.index != null) {
        push({
          severity: "P3",
          category: "maintainability",
          path,
          lineStart: lineOf(content, match.index),
          title: "Open TODO/FIXME marker",
          evidence: content.split(/\r?\n/)[lineOf(content, match.index) - 1]?.trim() ?? match[0],
          impact: "Unfinished work may ship unnoticed.",
          recommendation: "Resolve or track the marker before release.",
          verification: "Search for TODO/FIXME in this file."
        });
      }

      match = EVAL_PATTERN.exec(content);
      if (match && match.index != null) {
        push({
          severity: "P0",
          category: "security",
          path,
          lineStart: lineOf(content, match.index),
          title: "Use of eval()",
          evidence: content.split(/\r?\n/)[lineOf(content, match.index) - 1]?.trim() ?? "eval(",
          impact: "Arbitrary code execution risk.",
          recommendation: "Remove eval and use safe parsing/APIs.",
          verification: "Confirm no eval remains in this module."
        });
      }

      match = INNER_HTML_PATTERN.exec(content);
      if (match && match.index != null) {
        push({
          severity: "P1",
          category: "security",
          path,
          lineStart: lineOf(content, match.index),
          title: "HTML injection sink",
          evidence: content.split(/\r?\n/)[lineOf(content, match.index) - 1]?.trim() ?? match[0],
          impact: "XSS risk if user-controlled data is injected.",
          recommendation: "Sanitize or avoid raw HTML assignment.",
          verification: "Trace data sources into this sink."
        });
      }

      match = ANY_TYPE_PATTERN.exec(content);
      if (match && match.index != null && /\.(ts|tsx)$/.test(path)) {
        push({
          severity: "P2",
          category: "correctness",
          path,
          lineStart: lineOf(content, match.index),
          title: "TypeScript any usage",
          evidence: content.split(/\r?\n/)[lineOf(content, match.index) - 1]?.trim() ?? match[0],
          impact: "Weakens type safety and hides regressions.",
          recommendation: "Replace any with a precise type.",
          verification: "Typecheck after tightening types."
        });
      }

      if (content.length > 120_000) {
        push({
          severity: "P2",
          category: "maintainability",
          path,
          title: "Very large source file",
          evidence: `File size ~${content.length} characters`,
          impact: "Harder to review, test, and reason about.",
          recommendation: "Split into cohesive modules.",
          verification: "Confirm module boundaries after split."
        });
      }
    }

    return {
      findings,
      diagnostics: {
        batchId: input.batch.batchId,
        llmAttempted: false,
        llmSucceeded: false,
        llmFindingCount: 0,
        heuristicExecuted: true,
        heuristicFindingCount: findings.length,
        mode: "heuristic_fallback"
      }
    };
  };
}
