/**
 * Phase 2B – Final serialized request token budget.
 * Counts the full request shape (not only RAG/spooler lanes) before send.
 */

import type { FinalRequestTokenBudget, RuntimeTaskType } from "@dbzs/shared";
import { estimateTokensCharHeuristic } from "@/runtime/context/contextSpooler";

export function outputReserveForTask(taskType: RuntimeTaskType): number {
  switch (taskType) {
    case "small_code_change":
    case "large_code_change":
    case "refactoring":
    case "debugging":
      return 1536;
    case "review":
    case "test_analysis":
    case "planning":
    case "architecture":
      return 1024;
    case "casual_chat":
    case "normal_chat":
    default:
      return 512;
  }
}

export function outputReserveForTurn(input: {
  taskType: RuntimeTaskType;
  currentPhase?: string | null;
  runtimeContextLimit: number;
  protocolMode?: "prompt" | "native";
}): number {
  const phase = (input.currentPhase ?? "").toLowerCase();
  const limit = Math.max(1024, input.runtimeContextLimit);
  const isSmallContext = limit <= 4096;
  const nativeProtocolBonus = input.protocolMode === "native" ? 128 : 0;

  if (["planning", "awaiting_plan_approval", "clarification"].includes(phase) || ["planning", "architecture"].includes(input.taskType)) {
    return Math.min(limit - 256, (isSmallContext ? 512 : 768) + nativeProtocolBonus);
  }
  if (["review", "verification", "completed"].includes(phase) || ["review", "test_analysis"].includes(input.taskType)) {
    return Math.min(limit - 256, 768 + nativeProtocolBonus);
  }
  if (
    ["implementation", "executing", "awaiting_patch_approval", "testing", "diagnosis"].includes(phase) ||
    ["small_code_change", "large_code_change", "debugging", "refactoring"].includes(input.taskType)
  ) {
    return Math.min(limit - 256, (isSmallContext ? 768 : 1024) + nativeProtocolBonus);
  }
  return Math.min(limit - 256, 512 + nativeProtocolBonus);
}

export interface FinalBudgetParts {
  runtimeContextLimit: number;
  systemText?: string;
  toolsText?: string;
  chatText?: string;
  interviewText?: string;
  memoryText?: string;
  fileContextText?: string;
  ragText?: string;
  outputReserveTokens: number;
}

export function computeFinalRequestTokenBudget(parts: FinalBudgetParts): FinalRequestTokenBudget {
  const systemTokens = estimateTokensCharHeuristic(parts.systemText ?? "");
  const toolTokens = (parts.toolsText ?? "").trim().length > 0
    ? estimateTokensCharHeuristic(parts.toolsText!)
    : 0;
  const chatTokens = estimateTokensCharHeuristic(parts.chatText ?? "");
  const interviewTokens = estimateTokensCharHeuristic(parts.interviewText ?? "");
  const memoryTokens = estimateTokensCharHeuristic(parts.memoryText ?? "");
  const fileContextTokens = estimateTokensCharHeuristic(parts.fileContextText ?? "");
  const ragTokens = estimateTokensCharHeuristic(parts.ragText ?? "");
  const totalInputTokens =
    systemTokens + toolTokens + chatTokens + interviewTokens + memoryTokens + fileContextTokens + ragTokens;
  const outputReserveTokens = Math.max(0, parts.outputReserveTokens);
  const totalRequiredTokens = totalInputTokens + outputReserveTokens;
  const overflowTokens = Math.max(0, totalRequiredTokens - parts.runtimeContextLimit);

  return {
    runtimeContextLimit: parts.runtimeContextLimit,
    systemTokens,
    toolTokens,
    chatTokens,
    interviewTokens,
    memoryTokens,
    fileContextTokens,
    ragTokens,
    outputReserveTokens,
    totalInputTokens,
    totalRequiredTokens,
    overflowTokens
  };
}

/** Default residual tokens that should remain free after packing. */
export const DEFAULT_MINIMUM_SAFETY_MARGIN_TOKENS = 128;

export function contextSafetyMarginTokens(budget: FinalRequestTokenBudget): number {
  return budget.runtimeContextLimit - budget.totalRequiredTokens;
}

export function isFinalBudgetWithinLimit(
  budget: FinalRequestTokenBudget,
  minimumSafetyMarginTokens: number = 0
): boolean {
  if (budget.totalRequiredTokens > budget.runtimeContextLimit) {
    return false;
  }
  if (minimumSafetyMarginTokens > 0) {
    return contextSafetyMarginTokens(budget) >= minimumSafetyMarginTokens;
  }
  return true;
}

export type FinalBudgetGateReason = "ok" | "context_overflow" | "low_safety_margin";

export function evaluateFinalBudgetGate(
  budget: FinalRequestTokenBudget,
  minimumSafetyMarginTokens: number = DEFAULT_MINIMUM_SAFETY_MARGIN_TOKENS
): { ok: boolean; reason: FinalBudgetGateReason; safetyMarginTokens: number } {
  const safetyMarginTokens = contextSafetyMarginTokens(budget);
  if (budget.totalRequiredTokens > budget.runtimeContextLimit) {
    return { ok: false, reason: "context_overflow", safetyMarginTokens };
  }
  if (safetyMarginTokens < minimumSafetyMarginTokens) {
    return { ok: false, reason: "low_safety_margin", safetyMarginTokens };
  }
  return { ok: true, reason: "ok", safetyMarginTokens };
}

/** Minimal planning pack texts for one automatic overflow fallback. */
export function buildMinimalPlanningContext(input: {
  taskSummary: string;
  successCriteria?: string;
  agentsMd?: string;
  readme?: string;
  packageJson?: string;
  statusMatrix?: string;
  extraFiles?: Array<{ path: string; content: string }>;
}): { fileContextText: string; droppedNote: string } {
  const sections: string[] = [
    "[Minimal Planning Context]",
    `Aufgabe: ${input.taskSummary}`
  ];
  if (input.successCriteria) {
    sections.push(`Erfolgskriterien: ${input.successCriteria}`);
  }
  const files: Array<[string, string | undefined]> = [
    ["AGENTS.md", input.agentsMd],
    ["README.md", input.readme],
    ["package.json", input.packageJson],
    ["STATUS_MATRIX.md", input.statusMatrix]
  ];
  for (const [name, content] of files) {
    if (content?.trim()) {
      sections.push(`--- ${name} ---\n${content.slice(0, 6000)}`);
    }
  }
  const extras = (input.extraFiles ?? []).slice(0, 2);
  for (const file of extras) {
    sections.push(`--- ${file.path} ---\n${file.content.slice(0, 4000)}`);
  }
  return {
    fileContextText: sections.join("\n\n"),
    droppedNote: "context_fallback_applied:minimal_planning"
  };
}
