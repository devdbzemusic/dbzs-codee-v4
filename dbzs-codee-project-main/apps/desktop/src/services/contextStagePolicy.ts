/**
 * Phase 2B – Context stage policy.
 * Stufe 0 interview → 1 plan base → 2 targeted → 3 coding.
 */

import type { ContextStage, RuntimeTaskType } from "@dbzs/shared";

export const STAGE1_BASE_FILES = [
  "AGENTS.md",
  "README.md",
  "package.json",
  "STATUS_MATRIX.md",
  "STUB_TODO.md"
] as const;

export const STAGE1_MAX_FILES = 5;

export function resolveContextStage(input: {
  taskType: RuntimeTaskType;
  isInterviewOnly?: boolean;
  hasApprovedPlan?: boolean;
  isCodingExecution?: boolean;
}): ContextStage {
  if (input.isInterviewOnly) {
    return 0;
  }
  // Initial review/test analysis / repository_review: slim stage 1 (active file + base docs).
  // Orchestrator batches own their context — do not inherit stage 3 from a prior coding phase.
  if (input.taskType === "review" || input.taskType === "test_analysis") {
    return 1;
  }
  if (input.isCodingExecution || input.hasApprovedPlan) {
    return 3;
  }
  if (
    input.taskType === "small_code_change" ||
    input.taskType === "large_code_change" ||
    input.taskType === "planning" ||
    input.taskType === "architecture" ||
    input.taskType === "refactoring"
  ) {
    return 1;
  }
  if (input.taskType === "debugging") {
    return 2;
  }
  return 1;
}

export function shouldLoadRuntimeSignalPipeline(stage: ContextStage): boolean {
  return stage >= 2;
}

export function shouldLoadWorkspaceStructureSignals(stage: ContextStage): boolean {
  return stage >= 2;
}

export function shouldLoadBroadRag(stage: ContextStage): boolean {
  return stage >= 2;
}

export function shouldRunRecursiveListFiles(stage: ContextStage): boolean {
  return stage >= 2;
}

export function isStage1BaseFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? normalized;
  return (STAGE1_BASE_FILES as readonly string[]).includes(base);
}

export function filterStage1Paths(relativePaths: string[]): string[] {
  const matched = relativePaths.filter(isStage1BaseFile);
  // Prefer canonical order, cap at STAGE1_MAX_FILES.
  const ordered: string[] = [];
  for (const name of STAGE1_BASE_FILES) {
    const hit = matched.find((p) => (p.replace(/\\/g, "/").split("/").pop() ?? p) === name);
    if (hit) ordered.push(hit);
    if (ordered.length >= STAGE1_MAX_FILES) break;
  }
  return ordered;
}
