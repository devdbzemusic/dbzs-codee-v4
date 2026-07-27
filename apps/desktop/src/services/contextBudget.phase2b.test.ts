import { describe, expect, it } from "vitest";
import {
  filterStage1Paths,
  resolveContextStage,
  shouldLoadBroadRag,
  shouldLoadRuntimeSignalPipeline,
  STAGE1_MAX_FILES
} from "@/services/contextStagePolicy";
import {
  computeFinalRequestTokenBudget,
  isFinalBudgetWithinLimit,
  outputReserveForTask
} from "@/services/finalRequestTokenBudget";
import {
  allocateTokensRemoved,
  buildDroppedContextSources,
  dedupeDroppedSourceIds
} from "@/services/droppedContextSources";

describe("contextStagePolicy", () => {
  it("uses stage 1 for small_code_change planning and skips signal/RAG pipelines", () => {
    const stage = resolveContextStage({ taskType: "small_code_change" });
    expect(stage).toBe(1);
    expect(shouldLoadRuntimeSignalPipeline(stage)).toBe(false);
    expect(shouldLoadBroadRag(stage)).toBe(false);
  });

  it("uses stage 3 after plan approval / coding execution", () => {
    expect(resolveContextStage({ taskType: "small_code_change", hasApprovedPlan: true })).toBe(3);
    expect(resolveContextStage({ taskType: "small_code_change", isCodingExecution: true })).toBe(3);
  });

  it("uses slim stage 1 for initial review even during coding contract phase", () => {
    const stage = resolveContextStage({
      taskType: "review",
      isCodingExecution: true,
      hasApprovedPlan: true
    });
    expect(stage).toBe(1);
    expect(shouldLoadRuntimeSignalPipeline(stage)).toBe(false);
    expect(shouldLoadBroadRag(stage)).toBe(false);
  });

  it("caps stage-1 base files at 5", () => {
    const paths = filterStage1Paths([
      "README.md",
      "AGENTS.md",
      "package.json",
      "STATUS_MATRIX.md",
      "STUB_TODO.md",
      "src/App.tsx"
    ]);
    expect(paths.length).toBeLessThanOrEqual(STAGE1_MAX_FILES);
    expect(paths.every((p) => !p.includes("App.tsx"))).toBe(true);
  });
});

describe("finalRequestTokenBudget", () => {
  it("counts output reserve in totalRequiredTokens", () => {
    const budget = computeFinalRequestTokenBudget({
      runtimeContextLimit: 4096,
      systemText: "a".repeat(400),
      chatText: "b".repeat(400),
      outputReserveTokens: outputReserveForTask("planning")
    });
    expect(budget.outputReserveTokens).toBe(1024);
    expect(budget.totalRequiredTokens).toBe(budget.totalInputTokens + 1024);
  });

  it("detects overflow before send", () => {
    const budget = computeFinalRequestTokenBudget({
      runtimeContextLimit: 512,
      systemText: "x".repeat(4000),
      chatText: "y".repeat(4000),
      ragText: "z".repeat(4000),
      outputReserveTokens: 1536
    });
    expect(isFinalBudgetWithinLimit(budget)).toBe(false);
    expect(budget.overflowTokens).toBeGreaterThan(0);
  });

  it("accepts a fit request", () => {
    const budget = computeFinalRequestTokenBudget({
      runtimeContextLimit: 8192,
      systemText: "short system",
      chatText: "short chat",
      outputReserveTokens: 512
    });
    expect(isFinalBudgetWithinLimit(budget)).toBe(true);
    expect(budget.overflowTokens).toBe(0);
  });

  it("does not treat 2042/4096 as overflow", () => {
    const budget = computeFinalRequestTokenBudget({
      runtimeContextLimit: 4096,
      systemText: "a".repeat(400),
      chatText: "b".repeat(800),
      outputReserveTokens: 1536
    });
    // Roughly in the diagnostic ballpark: under limit, overflowTokens=0
    expect(budget.totalRequiredTokens).toBeLessThanOrEqual(4096);
    expect(budget.overflowTokens).toBe(0);
    expect(isFinalBudgetWithinLimit(budget, 0)).toBe(true);
  });
});

describe("droppedContextSources", () => {
  it("dedupes dropped source ids", () => {
    const ids = dedupeDroppedSourceIds(["a", "b", "a", "orchestration_signals", "b"]);
    expect(ids).toEqual(["a", "b", "orchestration_signals"]);
    const structured = buildDroppedContextSources(ids, "context_overflow", { a: 10, b: 0 }, {
      tokensBefore: 100,
      tokensAfter: 90
    });
    expect(structured).toHaveLength(3);
    expect(structured.find((s) => s.id === "a")?.tokensRemoved).toBe(10);
    expect(structured.find((s) => s.id === "a")?.tokensBefore).toBe(100);
    expect(structured.find((s) => s.id === "a")?.tokensAfter).toBe(90);
  });

  it("allocates tokensRemoved across drop ids to match total reduction", () => {
    const allocated = allocateTokensRemoved(["a", "b", "c"], 6626, 2448);
    const sum = Object.values(allocated).reduce((acc, n) => acc + n, 0);
    expect(sum).toBe(6626 - 2448);
    expect(allocated.a).toBeGreaterThan(0);
  });
});
