import type { ContextBudget, ContextItem } from "@dbzs/shared";

export interface ContextBudgetInput {
  modelContextLimit: number;
  systemTokens: number;
  conversationTokens: number;
  toolTokens: number;
  responseReserve: number;
  safetyMargin?: number;
}

export interface ContextBudgetSelection {
  budget: ContextBudget;
  selected: ContextItem[];
  omitted: Array<{ id: string; reason: string }>;
}

export function selectContextWithinBudget(items: ContextItem[], input: ContextBudgetInput): ContextBudgetSelection {
  const safetyMargin = input.safetyMargin ?? Math.ceil(input.modelContextLimit * 0.05);
  const repositoryTokens = input.modelContextLimit - input.systemTokens - input.conversationTokens -
    input.toolTokens - input.responseReserve - safetyMargin;
  if (repositoryTokens < 0) {
    throw new Error("context_overflow: reserves exceed model context limit");
  }
  const budget: ContextBudget = { ...input, safetyMargin, repositoryTokens, repositoryTokensUsed: 0 };
  const ordered = [...items].sort((left, right) =>
    (right.relevanceScore * right.trustScore * right.freshnessScore) -
    (left.relevanceScore * left.trustScore * left.freshnessScore) || left.id.localeCompare(right.id));
  const selected: ContextItem[] = [];
  const omitted: Array<{ id: string; reason: string }> = [];
  const hashes = new Set<string>();
  let used = 0;
  for (const item of ordered) {
    const fingerprint = `${item.sourcePath ?? ""}:${item.symbol ?? ""}:${item.content}`;
    if (hashes.has(fingerprint)) {
      omitted.push({ id: item.id, reason: "duplicate" });
      continue;
    }
    hashes.add(fingerprint);
    if (used + item.tokenEstimate > repositoryTokens) {
      omitted.push({ id: item.id, reason: "token_budget" });
      continue;
    }
    selected.push(item);
    used += item.tokenEstimate;
  }
  return { budget: { ...budget, repositoryTokensUsed: used }, selected, omitted };
}
