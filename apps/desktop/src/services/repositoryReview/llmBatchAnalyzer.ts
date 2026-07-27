/*
 * DBZS – Division By Zeros
 * Datei: llmBatchAnalyzer.ts
 * Bereich: Desktop Services / Repository Review
 *
 * Zweck:
 *   Führt fachbereichsspezifische LLM-Reviews aus und liefert Findings
 *   zusammen mit einer ehrlichen, redigierten Analyzer-Diagnostik.
 */

import type {
  BatchAnalysisResult,
  LlmFindingParseResult,
  RepositoryReviewFinding,
  RepositoryReviewFindingCategory,
  RepositoryReviewFindingSeverity,
  ReviewBatchPlan
} from "@dbzs/shared";
import { createHeuristicBatchAnalyzer } from "./heuristicBatchAnalyzer";
import { createFindingId } from "./reviewFindings";
import type { BatchAnalyzer, BatchAnalysisInput } from "./types";

export type LlmBatchChatFn = (input: {
  system: string;
  user: string;
}) => Promise<string>;

const SEVERITIES = new Set<RepositoryReviewFindingSeverity>(["P0", "P1", "P2", "P3"]);
const CATEGORIES = new Set<RepositoryReviewFindingCategory>([
  "correctness",
  "security",
  "architecture",
  "performance",
  "maintainability",
  "testing",
  "build",
  "data",
  "audio",
  "ux"
]);

function redactDiagnostic(value: unknown): string {
  return String(value ?? "unknown")
    .replace(/(?:gh[opsu]_|github_pat_)[A-Za-z0-9_]+/g, "[REDACTED_TOKEN]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

export function tryParseFindings(raw: string, batchId: string): LlmFindingParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      findings: [],
      errorCode: "empty_response",
      errorMessage: "LLM response was empty.",
      rawLength: raw.length
    };
  }

  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) {
    return {
      ok: false,
      findings: [],
      errorCode: "no_json_array",
      errorMessage: "No JSON array was found in the LLM response.",
      rawLength: raw.length,
      redactedPreview: redactDiagnostic(raw)
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    return {
      ok: false,
      findings: [],
      errorCode: "invalid_json",
      errorMessage: redactDiagnostic(error instanceof Error ? error.message : error),
      rawLength: raw.length,
      redactedPreview: redactDiagnostic(raw)
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      findings: [],
      errorCode: "invalid_schema",
      errorMessage: "Parsed review response is not an array.",
      rawLength: raw.length
    };
  }

  const findings: RepositoryReviewFinding[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!item || typeof item !== "object") {
      return invalidSchema(raw, `Finding ${index} is not an object.`);
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.path !== "string" ||
      typeof row.title !== "string" ||
      typeof row.evidence !== "string" ||
      typeof row.severity !== "string" ||
      !SEVERITIES.has(row.severity as RepositoryReviewFindingSeverity) ||
      typeof row.category !== "string" ||
      !CATEGORIES.has(row.category as RepositoryReviewFindingCategory)
    ) {
      return invalidSchema(raw, `Finding ${index} is missing required or valid fields.`);
    }
    findings.push({
      id: createFindingId(batchId, index),
      batchId,
      source: "llm",
      severity: row.severity as RepositoryReviewFindingSeverity,
      category: row.category as RepositoryReviewFindingCategory,
      path: row.path.replace(/\\/g, "/"),
      lineStart: typeof row.lineStart === "number" ? row.lineStart : undefined,
      lineEnd: typeof row.lineEnd === "number" ? row.lineEnd : undefined,
      title: row.title,
      evidence: row.evidence,
      impact: typeof row.impact === "string" ? row.impact : "See evidence.",
      recommendation:
        typeof row.recommendation === "string" ? row.recommendation : "Review and fix.",
      verification: typeof row.verification === "string" ? row.verification : undefined,
      needsVerification: row.needsVerification === true
    });
  }

  return { ok: true, findings, rawLength: raw.length };
}

function invalidSchema(raw: string, message: string): LlmFindingParseResult {
  return {
    ok: false,
    findings: [],
    errorCode: "invalid_schema",
    errorMessage: message,
    rawLength: raw.length,
    redactedPreview: redactDiagnostic(raw)
  };
}

function reviewFocus(batch: ReviewBatchPlan): string {
  switch (batch.domain) {
    case "security_api":
      return "Check authentication, authorization, public endpoints, database rules, rate limits, input validation, secrets, hard-coded identities and unsafe fallbacks.";
    case "architecture_dataflow":
      return "Check module boundaries, ownership, data flow, persistence consistency, coupling and architecture violations.";
    case "react_state":
      return "Check effect/listener/timer cleanup, stale closures, object URLs, state ownership and oversized components.";
    case "audio_media":
      return "Check AudioContext and media ownership, cleanup, concurrency, device handling and resource leaks.";
    case "build_dependencies":
      return "Check build configuration, dependency risks, scripts, platform assumptions and production packaging.";
    case "tests_observability":
      return "Check missing tests, brittle assertions, diagnostics, logging, error visibility and CI coverage.";
    case "performance_resources":
      return "Check unbounded work, memory/resource leaks, caching, repeated I/O and hot-path inefficiencies.";
    default:
      return "Check correctness, security, architecture, performance, maintainability and verification gaps.";
  }
}

function buildPrompt(input: BatchAnalysisInput): { system: string; user: string } {
  const fileBlock = input.files
    .map((file) => `### ${file.path}\n\`\`\`\n${file.content.slice(0, 12_000)}\n\`\`\``)
    .join("\n\n");
  return {
    system:
      "You are Codee repository reviewer. Return ONLY a JSON array. Every finding requires " +
      "severity (P0-P3), category, path, title, evidence, impact and recommendation. " +
      "Never invent paths or claim coverage you did not perform.",
    user: [
      `Batch: ${input.batch.title}`,
      `Purpose: ${input.batch.purpose}`,
      `Review focus: ${reviewFocus(input.batch)}`,
      `Scope: ${input.request.scope}`,
      "",
      fileBlock
    ].join("\n")
  };
}

export function createLlmBatchAnalyzer(chat: LlmBatchChatFn): BatchAnalyzer {
  return async (input): Promise<BatchAnalysisResult> => {
    const prompt = buildPrompt(input);
    let raw = "";
    try {
      raw = await chat(prompt);
      let parsed = tryParseFindings(raw, input.batch.batchId);
      let repairAttempted = false;
      if (!parsed.ok) {
        repairAttempted = true;
        const repaired = await chat({
          system:
            "Repair the supplied repository-review response. Return ONLY a valid JSON array using the required finding schema.",
          user: [
            `Parser error: ${parsed.errorCode}: ${parsed.errorMessage}`,
            "Response to repair:",
            redactDiagnostic(raw)
          ].join("\n")
        });
        raw = repaired;
        parsed = tryParseFindings(repaired, input.batch.batchId);
      }

      if (!parsed.ok) {
        return {
          findings: [],
          diagnostics: {
            batchId: input.batch.batchId,
            llmAttempted: true,
            llmSucceeded: false,
            llmFindingCount: 0,
            heuristicExecuted: false,
            heuristicFindingCount: 0,
            parserSucceeded: false,
            parserError: `${parsed.errorCode}: ${parsed.errorMessage}`,
            rawResponseLength: parsed.rawLength,
            repairAttempted,
            mode: "failed"
          }
        };
      }

      return {
        findings: parsed.findings,
        diagnostics: {
          batchId: input.batch.batchId,
          llmAttempted: true,
          llmSucceeded: true,
          llmFindingCount: parsed.findings.length,
          heuristicExecuted: false,
          heuristicFindingCount: 0,
          parserSucceeded: true,
          rawResponseLength: parsed.rawLength,
          repairAttempted,
          mode: "llm"
        }
      };
    } catch (error) {
      return {
        findings: [],
        diagnostics: {
          batchId: input.batch.batchId,
          llmAttempted: true,
          llmSucceeded: false,
          llmFindingCount: 0,
          heuristicExecuted: false,
          heuristicFindingCount: 0,
          providerError: redactDiagnostic(error instanceof Error ? error.message : error),
          rawResponseLength: raw.length,
          mode: "failed"
        }
      };
    }
  };
}

export function createHybridBatchAnalyzer(input: {
  llm?: BatchAnalyzer | null;
  heuristic?: BatchAnalyzer;
}): BatchAnalyzer {
  const heuristic = input.heuristic ?? createHeuristicBatchAnalyzer();
  const llm = input.llm ?? null;
  return async (batchInput): Promise<BatchAnalysisResult> => {
    const base = await heuristic(batchInput);
    if (!llm) return base;

    const fromLlm = await llm(batchInput);
    return {
      findings: [...base.findings, ...fromLlm.findings],
      diagnostics: {
        ...fromLlm.diagnostics,
        heuristicExecuted: true,
        heuristicFindingCount: base.findings.length,
        mode: fromLlm.diagnostics.llmSucceeded ? "hybrid" : "heuristic_fallback"
      }
    };
  };
}
