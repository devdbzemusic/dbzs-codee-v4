import { describe, expect, it, vi } from "vitest";
import type {
  RepositoryReviewFinding,
  RepositoryReviewRequest,
  ReviewBatchPlan
} from "@dbzs/shared";
import { createLlmBatchAnalyzer, tryParseFindings } from "./llmBatchAnalyzer";
import { assessProductionReadiness, assessReviewQuality, resolveReviewOutcome } from "./reviewQuality";

const batch: ReviewBatchPlan = {
  batchId: "batch-security-1",
  title: "Security/API · 1/1",
  purpose: "Security prüfen",
  domain: "security_api",
  paths: ["src/api.ts"],
  estimatedTokens: 100,
  priority: 1
};

const request: RepositoryReviewRequest = {
  workspaceId: "workspace-1",
  workspaceRoot: "C:/workspace",
  scope: "full_repository",
  depth: "standard",
  includeBuildChecks: true,
  includeSecurityReview: true,
  includePerformanceReview: true,
  includeArchitectureReview: true
};

const input = {
  batch,
  files: [{ path: "src/api.ts", content: "export const value = 1;" }],
  request,
  inventory: {
    languageStats: { TypeScript: 1 },
    frameworkHints: [],
    buildCommands: [],
    testCommands: [],
    lintCommands: [],
    typecheckCommands: [],
    largeFiles: [],
    gitState: { dirty: false, changedFiles: [] },
    fileCount: 1,
    files: ["src/api.ts"]
  }
};

const finding = (id: string): RepositoryReviewFinding => ({
  id,
  severity: "P1",
  category: "security",
  path: "src/api.ts",
  title: "Generisches Finding",
  evidence: "Beleg",
  impact: "Risiko",
  recommendation: "Fix"
});

describe("LLM review parser and diagnostics", () => {
  it("unterscheidet leere und syntaktisch ungültige Antworten", () => {
    expect(tryParseFindings("", batch.batchId)).toMatchObject({
      ok: false,
      errorCode: "empty_response"
    });
    expect(tryParseFindings("[{", batch.batchId)).toMatchObject({
      ok: false,
      errorCode: "no_json_array"
    });
  });

  it("führt genau einen Repair-Turn aus", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce("kein JSON")
      .mockResolvedValueOnce("[]");
    const result = await createLlmBatchAnalyzer(chat)(input);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.diagnostics).toMatchObject({
      parserSucceeded: true,
      repairAttempted: true,
      llmSucceeded: true
    });
  });

  it("weist das Modell an, bei fehlenden Findings ein leeres Array statt Prosa zurückzugeben", async () => {
    const chat = vi.fn().mockResolvedValue("[]");
    await createLlmBatchAnalyzer(chat)(input);
    const firstCallPrompt = chat.mock.calls[0]![0] as { system: string; user: string };
    expect(firstCallPrompt.system).toMatch(/empty array/i);
    expect(firstCallPrompt.system).toContain("[]");
  });

  it("persistiert eine redigierte Antwort-Vorschau, wenn kein JSON-Array gefunden wurde", async () => {
    const chat = vi.fn().mockResolvedValue("Keine wesentlichen Probleme gefunden.");
    const result = await createLlmBatchAnalyzer(chat)(input);
    expect(result.diagnostics.mode).toBe("failed");
    expect(result.diagnostics.rawResponsePreview).toContain("Keine wesentlichen Probleme gefunden.");
  });

  it("redigiert Providerfehler in der Diagnostik", async () => {
    const result = await createLlmBatchAnalyzer(async () => {
      throw new Error("Bearer super-secret-token");
    })(input);
    expect(result.diagnostics.providerError).not.toContain("super-secret-token");
    expect(result.diagnostics.mode).toBe("failed");
  });
});

describe("review quality and canonical outcome", () => {
  it("senkt monotone rein heuristische Reviews auf niedrige Confidence", () => {
    const diagnostics = [{
      batchId: batch.batchId,
      llmAttempted: true,
      llmSucceeded: false,
      llmFindingCount: 0,
      heuristicExecuted: true,
      heuristicFindingCount: 5,
      mode: "heuristic_fallback" as const
    }];
    const quality = assessReviewQuality({
      findings: Array.from({ length: 5 }, (_, index) => finding(`f-${index}`)),
      diagnostics,
      batches: [batch],
      reviewedFileCount: 1,
      plannedFileCount: 1
    });
    expect(quality.confidence).toBe("low");
    const outcome = resolveReviewOutcome({
      completedBatches: 1,
      plannedBatches: 1,
      diagnostics,
      checks: [],
      quality
    });
    expect(outcome).toBe("degraded_heuristic_only");
    expect(assessProductionReadiness({
      findings: [finding("f")],
      executedChecks: [],
      quality,
      outcome
    }).score).toBeUndefined();
  });

  it("priorisiert Abbruch, Fehler und fehlende Batches", () => {
    const quality = assessReviewQuality({
      findings: [],
      diagnostics: [],
      batches: [batch],
      reviewedFileCount: 0,
      plannedFileCount: 1
    });
    const common = { diagnostics: [], checks: [], quality };
    expect(resolveReviewOutcome({ ...common, cancelled: true, completedBatches: 0, plannedBatches: 1 })).toBe("cancelled");
    expect(resolveReviewOutcome({ ...common, failed: true, completedBatches: 0, plannedBatches: 1 })).toBe("failed");
    expect(resolveReviewOutcome({ ...common, completedBatches: 0, plannedBatches: 1 })).toBe("partial");
  });

  it("wertet valide leere LLM-Antworten nicht automatisch als hohe Confidence", () => {
    const quality = assessReviewQuality({
      findings: [],
      diagnostics: [{
        batchId: batch.batchId,
        llmAttempted: true,
        llmSucceeded: true,
        llmFindingCount: 0,
        heuristicExecuted: false,
        heuristicFindingCount: 0,
        parserSucceeded: true,
        mode: "llm"
      }],
      batches: [batch],
      reviewedFileCount: 1,
      plannedFileCount: 1
    });
    expect(quality.confidence).not.toBe("high");
    expect(quality.warnings.join(" ")).toMatch(/keine Findings/i);
  });
});
