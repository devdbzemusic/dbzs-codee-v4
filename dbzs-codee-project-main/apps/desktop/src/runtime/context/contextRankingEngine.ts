import type {
  ContextBuildRequest,
  ContextSignal,
  RankedContextSignal
} from "@/runtime/context/contextContracts";

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function scoreSignal(goal: string, signal: ContextSignal): number {
  const loweredGoal = goal.toLowerCase();
  const value = signal.value.toLowerCase();
  let score = 0;

  if (value.includes(loweredGoal)) {
    score += 30;
  }

  const sourceWeight: Record<ContextSignal["source"], number> = {
    active_file: 30,
    cursor: 25,
    selection: 28,
    open_tabs: 16,
    diagnostics: 24,
    terminal: 20,
    git_diff: 22,
    workspace: 10,
    symbols: 18,
    memory: 20
  };

  score += sourceWeight[signal.source];

  for (const token of loweredGoal.split(/\s+/).filter(Boolean)) {
    if (value.includes(token)) {
      score += 6;
    }
  }

  return score;
}

export class ContextRankingEngine {
  rank(
    request: ContextBuildRequest,
    signals: ContextSignal[]
  ): RankedContextSignal[] {
    return signals
      .map((signal) => ({
        ...signal,
        score: scoreSignal(request.userGoal, signal),
        estimatedTokens: estimateTokens(signal.value)
      }))
      .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
  }
}
