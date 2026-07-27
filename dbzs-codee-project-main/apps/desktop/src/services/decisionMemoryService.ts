import type { AssistantAnswer, ClarificationWorkflow, DecisionMemoryEntry } from "@dbzs/shared";
import { projectMemoryService } from "@/services/projectMemoryService";

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "das", "der", "die", "und", "and", "or", "oder",
  "soll", "should", "ich", "du", "you", "i", "es", "it", "für", "for", "mit", "with"
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-zäöüß0-9]+/i)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token))
  );
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / Math.min(a.size, b.size);
}

const SIMILARITY_THRESHOLD = 0.6;

function isExpired(entry: DecisionMemoryEntry): boolean {
  return Boolean(entry.expiresAt && new Date(entry.expiresAt).getTime() < Date.now());
}

/**
 * Run-scoped decisions live only in memory for the lifetime of the active run
 * (cleared by the caller when the run ends) — they exist purely to avoid
 * re-asking the same question twice within one multi-turn run.
 */
const runScopedDecisions = new Map<string, DecisionMemoryEntry[]>();

export function recordRunDecision(runId: string, entry: DecisionMemoryEntry): void {
  const existing = runScopedDecisions.get(runId) ?? [];
  runScopedDecisions.set(runId, [...existing, entry]);
}

export function clearRunDecisions(runId: string): void {
  runScopedDecisions.delete(runId);
}

export function lookupRunDecision(
  runId: string,
  workflow: ClarificationWorkflow,
  questionPrompt: string
): DecisionMemoryEntry | null {
  const entries = runScopedDecisions.get(runId) ?? [];
  return findBestMatch(entries, workflow, questionPrompt);
}

function findBestMatch(
  entries: DecisionMemoryEntry[],
  workflow: ClarificationWorkflow,
  questionPrompt: string
): DecisionMemoryEntry | null {
  const promptTokens = tokenize(questionPrompt);
  let best: DecisionMemoryEntry | null = null;
  let bestScore = 0;

  for (const entry of entries) {
    if (entry.workflow !== workflow || isExpired(entry)) continue;
    const score = overlapRatio(promptTokens, tokenize(entry.questionPrompt));
    if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

export async function lookupProjectDecision(
  workspaceRoot: string,
  workflow: ClarificationWorkflow,
  questionPrompt: string
): Promise<DecisionMemoryEntry | null> {
  try {
    const memory = await projectMemoryService.loadProjectMemory(workspaceRoot);
    return findBestMatch(memory.clarificationDecisions ?? [], workflow, questionPrompt);
  } catch {
    return null;
  }
}

export async function recordProjectDecision(
  workspaceRoot: string,
  workflow: ClarificationWorkflow,
  questionPrompt: string,
  answer: AssistantAnswer,
  expiresAt?: string
): Promise<void> {
  try {
    const memory = await projectMemoryService.loadProjectMemory(workspaceRoot);
    const entry: DecisionMemoryEntry = {
      id: `decision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      workflow,
      questionPrompt,
      answer,
      scope: "project",
      decidedAt: new Date().toISOString(),
      expiresAt
    };
    await projectMemoryService.updateProjectMemory({
      ...memory,
      clarificationDecisions: [entry, ...(memory.clarificationDecisions ?? [])].slice(0, 100)
    });
  } catch {
    // Best-effort persistence — a failed write should not block the clarification flow.
  }
}
