import type { ReviewBatchBudget, ReviewBatchPlan } from "@dbzs/shared";
import { estimateTokensCharHeuristic } from "@/runtime/context/contextSpooler";
import { splitReviewBatch } from "./reviewBatchPlanner";

const DEFAULT_OUTPUT_RESERVE = 1024;
const DEFAULT_SYSTEM = 400;
const DEFAULT_TASK = 350;
const SAFETY_RATIO = 0.1;

export function computeReviewBatchBudget(input: {
  runtimeContextLimit: number;
  systemText?: string;
  taskText?: string;
  fileTexts: string[];
  evidenceText?: string;
  outputReserveTokens?: number;
}): ReviewBatchBudget {
  const systemTokens = estimateTokensCharHeuristic(input.systemText ?? "") || DEFAULT_SYSTEM;
  const taskTokens = estimateTokensCharHeuristic(input.taskText ?? "") || DEFAULT_TASK;
  const fileTokens = input.fileTexts.reduce(
    (sum, text) => sum + estimateTokensCharHeuristic(text),
    0
  );
  const evidenceTokens = estimateTokensCharHeuristic(input.evidenceText ?? "");
  const outputReserveTokens = input.outputReserveTokens ?? DEFAULT_OUTPUT_RESERVE;
  const totalRequiredTokens =
    systemTokens + taskTokens + fileTokens + evidenceTokens + outputReserveTokens;
  const safetyMarginTokens = Math.max(
    0,
    input.runtimeContextLimit - totalRequiredTokens
  );
  return {
    runtimeContextLimit: input.runtimeContextLimit,
    systemTokens,
    taskTokens,
    fileTokens,
    evidenceTokens,
    outputReserveTokens,
    safetyMarginTokens,
    totalRequiredTokens
  };
}

export function batchFitsBudget(budget: ReviewBatchBudget): boolean {
  const minSafety = Math.ceil(budget.runtimeContextLimit * SAFETY_RATIO);
  return (
    budget.totalRequiredTokens <= budget.runtimeContextLimit &&
    budget.safetyMarginTokens >= minSafety
  );
}

export function ensureBatchFitsOrSplit(input: {
  batch: ReviewBatchPlan;
  runtimeContextLimit: number;
  systemText: string;
  taskText: string;
  fileContents: Map<string, string>;
  evidenceText?: string;
}): { batches: ReviewBatchPlan[]; splitApplied: boolean } {
  const fileTexts = input.batch.paths.map(
    (p) => `FILE ${p}\n${input.fileContents.get(p) ?? ""}`
  );
  const budget = computeReviewBatchBudget({
    runtimeContextLimit: input.runtimeContextLimit,
    systemText: input.systemText,
    taskText: input.taskText,
    fileTexts,
    evidenceText: input.evidenceText
  });
  if (batchFitsBudget(budget)) {
    return { batches: [input.batch], splitApplied: false };
  }
  const split = splitReviewBatch(input.batch);
  if (split.length === 1) {
    // Single-file still too large: truncate content budgeting by keeping path only signal upstream.
    return { batches: split, splitApplied: false };
  }
  return { batches: split, splitApplied: true };
}
