/*
 * DBZS – Division By Zeros
 * Datei: reviewRemediationSelection.ts
 * Bereich: Desktop Services / Repository Review
 *
 * Zweck:
 *   Persistiert Review und Finding-Scope als eine atomare, workspace-gebundene
 *   Auswahl und verwirft Antworten veralteter UI-Karten.
 */

import type {
  ReviewRemediationSelection,
  ReviewRemediationSelectionScope
} from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

const SELECTION_PATH = ".codee/review-remediation-selection.json";
const VALID_SCOPES = new Set<ReviewRemediationSelectionScope>([
  "all",
  "p0_p1",
  "p0_p2",
  "selected"
]);

function joinPath(root: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${SELECTION_PATH}`;
}

function now(): string {
  return new Date().toISOString();
}

export function createReviewRemediationSelection(
  workspaceRoot: string
): ReviewRemediationSelection {
  return {
    workspaceId: workspaceScopeId(workspaceRoot),
    reviewId: null,
    scope: "p0_p2",
    selectedFindingIds: [],
    reviewConfirmed: false,
    scopeConfirmed: false,
    status: "collecting",
    pendingQuestionId: null,
    updatedAt: now()
  };
}

export function isReviewRemediationSelection(
  value: unknown
): value is ReviewRemediationSelection {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ReviewRemediationSelection>;
  return (
    typeof item.workspaceId === "string" &&
    (typeof item.reviewId === "string" || item.reviewId === null) &&
    typeof item.scope === "string" &&
    VALID_SCOPES.has(item.scope as ReviewRemediationSelectionScope) &&
    Array.isArray(item.selectedFindingIds) &&
    item.selectedFindingIds.every((id) => typeof id === "string") &&
    typeof item.reviewConfirmed === "boolean" &&
    typeof item.scopeConfirmed === "boolean" &&
    ["collecting", "complete", "consumed", "cancelled"].includes(item.status ?? "") &&
    (typeof item.pendingQuestionId === "string" || item.pendingQuestionId === null) &&
    typeof item.updatedAt === "string"
  );
}

export async function readReviewRemediationSelection(
  workspaceRoot: string
): Promise<ReviewRemediationSelection | null> {
  try {
    const file = await backendClient.readProjectFile(joinPath(workspaceRoot));
    if (!file?.content) return null;
    const parsed: unknown = JSON.parse(file.content);
    if (!isReviewRemediationSelection(parsed)) return null;
    if (parsed.workspaceId !== workspaceScopeId(workspaceRoot)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeReviewRemediationSelection(
  workspaceRoot: string,
  selection: ReviewRemediationSelection
): Promise<void> {
  if (selection.workspaceId !== workspaceScopeId(workspaceRoot)) {
    throw new Error("workspace_mismatch");
  }
  await backendClient.writeProjectFile(
    joinPath(workspaceRoot),
    `${JSON.stringify(selection, null, 2)}\n`
  );
}

export async function beginReviewRemediationQuestion(
  workspaceRoot: string,
  questionId: string
): Promise<ReviewRemediationSelection> {
  const current =
    (await readReviewRemediationSelection(workspaceRoot)) ??
    createReviewRemediationSelection(workspaceRoot);
  const next = { ...current, pendingQuestionId: questionId, updatedAt: now() };
  await writeReviewRemediationSelection(workspaceRoot, next);
  return next;
}

export async function applyReviewRemediationSelection(
  workspaceRoot: string,
  input: {
    questionId: string;
    reviewId: string;
    scope: ReviewRemediationSelectionScope;
    selectedFindingIds?: string[];
  }
): Promise<ReviewRemediationSelection | null> {
  const current = await readReviewRemediationSelection(workspaceRoot);
  if (!current || current.pendingQuestionId !== input.questionId) return null;
  if (current.status === "consumed" || current.status === "cancelled") return current;

  const next: ReviewRemediationSelection = {
    ...current,
    reviewId: current.reviewConfirmed ? current.reviewId : input.reviewId,
    scope: current.scopeConfirmed ? current.scope : input.scope,
    selectedFindingIds: current.scopeConfirmed
      ? current.selectedFindingIds
      : [...new Set(input.selectedFindingIds ?? [])],
    reviewConfirmed: true,
    scopeConfirmed: true,
    status: "complete",
    pendingQuestionId: null,
    updatedAt: now()
  };
  await writeReviewRemediationSelection(workspaceRoot, next);
  return next;
}

export async function finishReviewRemediationSelection(
  workspaceRoot: string,
  status: "consumed" | "cancelled"
): Promise<void> {
  const current = await readReviewRemediationSelection(workspaceRoot);
  if (!current) return;
  await writeReviewRemediationSelection(workspaceRoot, {
    ...current,
    status,
    pendingQuestionId: null,
    updatedAt: now()
  });
}

export async function applySelectedReviewFindingIds(
  workspaceRoot: string,
  questionId: string,
  selectedFindingIds: string[]
): Promise<ReviewRemediationSelection | null> {
  const current = await readReviewRemediationSelection(workspaceRoot);
  if (
    !current ||
    current.pendingQuestionId !== questionId ||
    current.scope !== "selected" ||
    selectedFindingIds.length === 0
  ) {
    return null;
  }
  const next: ReviewRemediationSelection = {
    ...current,
    selectedFindingIds: [...new Set(selectedFindingIds)],
    status: "complete",
    pendingQuestionId: null,
    updatedAt: now()
  };
  await writeReviewRemediationSelection(workspaceRoot, next);
  return next;
}
