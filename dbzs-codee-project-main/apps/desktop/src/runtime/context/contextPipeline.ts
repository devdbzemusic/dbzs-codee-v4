import type {
  ContextBuildRequest,
  ContextCollector,
  PromptContext,
  RankedContextSignal
} from "@/runtime/context/contextContracts";
import { ContextRankingEngine } from "@/runtime/context/contextRankingEngine";

/**
 * Greedy-fill: keeps items (in the given order) whose cumulative
 * estimatedTokens stays within maxTokens, skipping (not truncating) any
 * item that would overflow it. Generic so both the IDE ContextPipeline and
 * the chat ContextSpooler can reuse the same budget-fitting logic.
 */
export function trimByTokenBudget<T extends { estimatedTokens: number }>(
  ranked: T[],
  maxTokens: number
): T[] {
  const selected: T[] = [];
  let used = 0;

  for (const item of ranked) {
    if (used + item.estimatedTokens > maxTokens) {
      continue;
    }
    selected.push(item);
    used += item.estimatedTokens;
  }

  return selected;
}

function summarizeSignals(signals: RankedContextSignal[]): string {
  if (signals.length === 0) {
    return "No context available.";
  }

  const grouped = new Map<string, number>();
  for (const signal of signals) {
    grouped.set(signal.source, (grouped.get(signal.source) ?? 0) + 1);
  }

  return [...grouped.entries()]
    .map(([source, count]) => `${source}:${count}`)
    .join(" | ");
}

export class ContextPipeline {
  private readonly rankingEngine = new ContextRankingEngine();

  constructor(private readonly collectors: ContextCollector[]) {}

  async buildPromptContext(request: ContextBuildRequest): Promise<PromptContext> {
    const collected = await Promise.all(this.collectors.map((collector) => collector.collect()));
    const flattened = collected.flat();

    const ranked = this.rankingEngine.rank(request, flattened);
    const selected = trimByTokenBudget(ranked, request.maxTokens);

    return {
      summary: summarizeSignals(selected),
      signals: selected,
      estimatedTokens: selected.reduce((sum, signal) => sum + signal.estimatedTokens, 0)
    };
  }
}
