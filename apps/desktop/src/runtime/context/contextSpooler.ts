/**
 * DBZS – Division By Zeros
 * Datei: contextSpooler.ts
 * Bereich: Runtime Context / Context Spooler
 *
 * Zweck:
 *   Teilt den verfügbaren Tokenbudget in sechs Lanes (Mandatory, Active Task,
 *   Relevant Code, Retrieved Context, Recent Conversation, Project Memory, Overflow) und
 *   erzwingt das Budget pro Lane, statt pauschal die letzten N Nachrichten
 *   oder Zeichen zu übernehmen.
 *
 * Warum:
 *   Mandatory-Inhalte (Systemprompt, Sicherheitsregeln, aktueller Auftrag)
 *   dürfen nie gekürzt werden; die Antwortreserve darf nie zugunsten von
 *   mehr Kontext verkleinert werden. Alles andere konkurriert um das, was
 *   nach Mandatory und den Reserven übrig bleibt.
 */

import type { ContextLane, ContextManifest, ContextManifestSection, RuntimeTokenBudget } from "@dbzs/shared";
import { trimByTokenBudget } from "@/runtime/context/contextPipeline";

export interface SpoolerLaneItem {
  id: string;
  content: string;
  estimatedTokens: number;
  source?: string;
  symbol?: string;
  dedupeContent?: string;
  pinned?: boolean;
}

export interface LaneBudgetPlan {
  lane: ContextLane;
  maxTokens: number;
}

export interface SpoolerLaneResult {
  lane: ContextLane;
  included: SpoolerLaneItem[];
  droppedIds: string[];
  tokenCount: number;
}

export interface SpoolerAssembleRequest {
  requestId: string;
  modelId: string;
  role: string;
  /** System prompt, agent role, safety rules, current user task, tool contracts, approval rules. Never trimmed. */
  mandatory: SpoolerLaneItem[];
  /** Current/approved plan, active patch, last test failures, last tool results, active file, affected symbols. */
  activeTask: SpoolerLaneItem[];
  /** Affected functions/imports/tests/deps/config excerpts — callers must NOT pass whole files here. */
  relevantCode: SpoolerLaneItem[];
  /** Repository-RAG results. The spooler, never the retriever, decides final inclusion. */
  retrievedContext?: SpoolerLaneItem[];
  /** Oldest -> newest. Trimming drops the oldest first so the newest turns survive. */
  recentConversation: SpoolerLaneItem[];
  projectMemory?: SpoolerLaneItem[];
  /** @deprecated Compatibility alias during the RAG rollout. */
  retrievedMemory?: SpoolerLaneItem[];
}

export interface SpoolerAssembleResult {
  lanes: SpoolerLaneResult[];
  manifest: ContextManifest;
}

const NON_MANDATORY_LANE_WEIGHTS: Record<Exclude<ContextLane, "mandatory" | "overflow">, number> = {
  active_task: 0.15,
  relevant_code: 0.2,
  retrieved_context: 0.3,
  recent_conversation: 0.25,
  project_memory: 0.1
};

export function estimateTokensCharHeuristic(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export class ContextSpooler {
  constructor(private readonly tokenBudget: RuntimeTokenBudget) {}

  private maxInputTokens(): number {
    const { contextWindowTokens, reservedOutputTokens, reservedToolTokens, safetyReserveTokens } = this.tokenBudget;
    return Math.max(0, contextWindowTokens - reservedOutputTokens - reservedToolTokens - safetyReserveTokens);
  }

  /**
   * Lane budgets, computed AFTER mandatory's real token cost — mandatory is
   * never trimmed even if it exceeds its "typical" share, so every other
   * lane only ever competes for what's left of the input budget once
   * mandatory (and the output/tool/safety reserves) are accounted for.
   */
  planLaneBudgets(mandatoryTokens = 0): LaneBudgetPlan[] {
    const remaining = Math.max(0, this.maxInputTokens() - mandatoryTokens);
    return [
      { lane: "mandatory", maxTokens: Number.POSITIVE_INFINITY },
      { lane: "active_task", maxTokens: Math.round(remaining * NON_MANDATORY_LANE_WEIGHTS.active_task) },
      { lane: "relevant_code", maxTokens: Math.round(remaining * NON_MANDATORY_LANE_WEIGHTS.relevant_code) },
      { lane: "retrieved_context", maxTokens: Math.round(remaining * NON_MANDATORY_LANE_WEIGHTS.retrieved_context) },
      {
        lane: "recent_conversation",
        maxTokens: Math.round(remaining * NON_MANDATORY_LANE_WEIGHTS.recent_conversation)
      },
      { lane: "project_memory", maxTokens: Math.round(remaining * NON_MANDATORY_LANE_WEIGHTS.project_memory) },
      { lane: "overflow", maxTokens: 0 }
    ];
  }

  assemble(request: SpoolerAssembleRequest): SpoolerAssembleResult {
    const seen = new Set<string>();
    let duplicateContextRemoved = 0;
    let duplicateTokenSavings = 0;
    const dedupe = (items: SpoolerLaneItem[]): SpoolerLaneItem[] => items.filter((item) => {
      const key = this.dedupeKey(item);
      if (seen.has(key)) {
        duplicateContextRemoved += 1;
        duplicateTokenSavings += item.estimatedTokens;
        return false;
      }
      seen.add(key);
      return true;
    });
    const mandatoryItems = dedupe(request.mandatory);
    const activeTaskItems = dedupe(request.activeTask);
    const relevantCodeItems = dedupe(request.relevantCode);
    const retrievalItems = dedupe(request.retrievedContext ?? []);
    const conversationItems = request.recentConversation;
    const memoryItems = dedupe(request.projectMemory ?? request.retrievedMemory ?? []);
    const mandatory = this.includeAll("mandatory", mandatoryItems);
    const budgets = this.planLaneBudgets(mandatory.tokenCount);
    const budgetFor = (lane: ContextLane): number => budgets.find((b) => b.lane === lane)?.maxTokens ?? 0;

    const activeTask = this.trimLane("active_task", activeTaskItems, budgetFor("active_task"));
    const relevantCode = this.trimLane("relevant_code", relevantCodeItems, budgetFor("relevant_code"));
    const retrievedContext = this.trimLane("retrieved_context", retrievalItems, budgetFor("retrieved_context"));
    const recentConversation = this.trimLaneKeepingNewest(
      "recent_conversation",
      conversationItems,
      budgetFor("recent_conversation")
    );
    const projectMemory = this.trimLane("project_memory", memoryItems, budgetFor("project_memory"));

    const droppedIds = [
      ...activeTask.droppedIds,
      ...relevantCode.droppedIds,
      ...retrievedContext.droppedIds,
      ...recentConversation.droppedIds,
      ...projectMemory.droppedIds
    ];
    const overflow: SpoolerLaneResult = { lane: "overflow", included: [], droppedIds, tokenCount: 0 };

    const lanes = [mandatory, activeTask, relevantCode, retrievedContext, recentConversation, projectMemory, overflow];
    const manifest = this.buildManifest(request, lanes, duplicateContextRemoved, duplicateTokenSavings);

    return { lanes, manifest };
  }

  private dedupeKey(item: SpoolerLaneItem): string {
    const normalizedSource = item.source?.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
    const normalizedContent = (item.dedupeContent ?? item.content).replace(/\s+/g, " ").trim().toLowerCase();
    return normalizedSource
      ? `source:${normalizedSource}|symbol:${item.symbol?.toLowerCase() ?? ""}|content:${normalizedContent}`
      : `content:${normalizedContent}`;
  }

  private includeAll(lane: ContextLane, items: SpoolerLaneItem[]): SpoolerLaneResult {
    const tokenCount = items.reduce((sum, item) => sum + item.estimatedTokens, 0);
    return { lane, included: items, droppedIds: [], tokenCount };
  }

  private trimLane(lane: ContextLane, items: SpoolerLaneItem[], maxTokens: number): SpoolerLaneResult {
    const included = this.trimLaneRespectingPinned(items, maxTokens);
    return this.toLaneResult(lane, items, included);
  }

  /** Trims from the oldest end — reverses, fits newest-first, restores chronological order. */
  private trimLaneKeepingNewest(lane: ContextLane, items: SpoolerLaneItem[], maxTokens: number): SpoolerLaneResult {
    const includedReversed = this.trimLaneRespectingPinned([...items].reverse(), maxTokens);
    const includedIds = new Set(includedReversed.map((item) => item.id));
    const included = items.filter((item) => includedIds.has(item.id));
    return this.toLaneResult(lane, items, included);
  }

  private trimLaneRespectingPinned(items: SpoolerLaneItem[], maxTokens: number): SpoolerLaneItem[] {
    const pinned = items.filter((item) => item.pinned);
    const pinnedIds = new Set(pinned.map((item) => item.id));
    const unpinned = items.filter((item) => !pinnedIds.has(item.id));
    const remainingBudget = Math.max(
      0,
      maxTokens - pinned.reduce((sum, item) => sum + item.estimatedTokens, 0)
    );
    const trimmedUnpinned = trimByTokenBudget(unpinned, remainingBudget);
    const includedIds = new Set([
      ...pinned.map((item) => item.id),
      ...trimmedUnpinned.map((item) => item.id)
    ]);
    return items.filter((item) => includedIds.has(item.id));
  }

  private toLaneResult(lane: ContextLane, all: SpoolerLaneItem[], included: SpoolerLaneItem[]): SpoolerLaneResult {
    const includedIds = new Set(included.map((item) => item.id));
    const droppedIds = all.filter((item) => !includedIds.has(item.id)).map((item) => item.id);
    const tokenCount = included.reduce((sum, item) => sum + item.estimatedTokens, 0);
    return { lane, included, droppedIds, tokenCount };
  }

  private buildManifest(request: SpoolerAssembleRequest, lanes: SpoolerLaneResult[], duplicateContextRemoved: number, duplicateTokenSavings: number): ContextManifest {
    const sections: ContextManifestSection[] = [];
    lanes.forEach((laneResult, priority) => {
      for (const item of laneResult.included) {
        sections.push({
          type: laneResult.lane,
          source: item.source ?? item.id,
          tokenCount: item.estimatedTokens,
          priority,
          cached: false,
          truncated: false
        });
      }
    });

    const inputTokens = lanes.reduce((sum, lane) => sum + lane.tokenCount, 0);
    const droppedSections = lanes.flatMap((lane) => lane.droppedIds);

    return {
      requestId: request.requestId,
      modelId: request.modelId,
      role: request.role,
      contextWindowTokens: this.tokenBudget.contextWindowTokens,
      inputTokens,
      reservedOutputTokens: this.tokenBudget.reservedOutputTokens,
      reservedToolTokens: this.tokenBudget.reservedToolTokens,
      safetyReserveTokens: this.tokenBudget.safetyReserveTokens,
      sections,
      cacheHits: 0,
      cacheMisses: 0,
      droppedSections,
      duplicateContextRemoved,
      duplicateTokenSavings,
      dedupeReasons: duplicateContextRemoved > 0 ? ["canonical_source_symbol_content"] : []
    };
  }
}

/**
 * Builds a RuntimeTokenBudget from a model's context window. Ratios default
 * to the spec's worked example (4096 tokens -> 900 output / 300 tool / ~200
 * safety) represented as ratios so they scale with the model's real context
 * size instead of being hardcoded absolutes.
 */
export function buildTokenBudget(
  contextWindowTokens: number,
  ratios?: { outputReserveRatio?: number; toolReserveRatio?: number; safetyReserveRatio?: number }
): RuntimeTokenBudget {
  const outputRatio = ratios?.outputReserveRatio ?? 0.22;
  const toolRatio = ratios?.toolReserveRatio ?? 0.07;
  const safetyRatio = ratios?.safetyReserveRatio ?? 0.05;

  const reservedOutputTokens = Math.round(contextWindowTokens * outputRatio);
  const reservedToolTokens = Math.round(contextWindowTokens * toolRatio);
  const safetyReserveTokens = Math.round(contextWindowTokens * safetyRatio);
  const maxInputTokens = Math.max(
    0,
    contextWindowTokens - reservedOutputTokens - reservedToolTokens - safetyReserveTokens
  );

  // Informational split for UI/manifest display — ContextSpooler.assemble()
  // recomputes the real remaining-after-mandatory split dynamically, since
  // mandatory's actual size (not a fixed share) determines what's left.
  const maxSystemTokens = Math.round(maxInputTokens * 0.2);
  const maxTaskTokens = Math.round(maxInputTokens * NON_MANDATORY_LANE_WEIGHTS.active_task);
  const maxCodeTokens = Math.round(maxInputTokens * NON_MANDATORY_LANE_WEIGHTS.relevant_code);
  const maxHistoryTokens = Math.round(maxInputTokens * NON_MANDATORY_LANE_WEIGHTS.recent_conversation);
  const maxMemoryTokens = Math.max(
    0,
    maxInputTokens - maxSystemTokens - maxTaskTokens - maxCodeTokens - maxHistoryTokens
  );

  return {
    contextWindowTokens,
    reservedOutputTokens,
    reservedToolTokens,
    safetyReserveTokens,
    maxSystemTokens,
    maxTaskTokens,
    maxCodeTokens,
    maxHistoryTokens,
    maxMemoryTokens
  };
}
