import { describe, expect, it } from "vitest";
import type { ContextItem } from "@dbzs/shared";
import { selectContextWithinBudget } from "./contextBudgetManager";

const item = (id: string, tokens: number, score: number): ContextItem => ({
  id, kind: "file", content: id, relevanceScore: score, freshnessScore: 1, trustScore: 1,
  tokenEstimate: tokens, reasons: ["test"]
});

describe("selectContextWithinBudget", () => {
  it("reserves output and selects high relevance first", () => {
    const result = selectContextWithinBudget([item("low", 20, 0.1), item("high", 50, 1)], {
      modelContextLimit: 100, systemTokens: 10, conversationTokens: 10, toolTokens: 5,
      responseReserve: 20, safetyMargin: 5
    });
    expect(result.selected.map((entry) => entry.id)).toEqual(["high"]);
    expect(result.omitted).toEqual([{ id: "low", reason: "token_budget" }]);
    expect(result.budget.repositoryTokens).toBe(50);
    expect(result.budget.repositoryTokensUsed).toBe(50);
  });

  it("preserves allocated budget separately from consumed tokens", () => {
    const result = selectContextWithinBudget([item("a", 10, 1), item("b", 10, 0.5)], {
      modelContextLimit: 100, systemTokens: 10, conversationTokens: 10, toolTokens: 5,
      responseReserve: 20, safetyMargin: 5
    });
    expect(result.budget.repositoryTokens).toBe(50);
    expect(result.budget.repositoryTokensUsed).toBe(20);
    expect(result.selected).toHaveLength(2);
  });

  it("reports impossible reserves", () => {
    expect(() => selectContextWithinBudget([], {
      modelContextLimit: 10, systemTokens: 10, conversationTokens: 1, toolTokens: 0, responseReserve: 1
    })).toThrow("context_overflow");
  });
});
