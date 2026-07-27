/*
 * DBZS – Division By Zeros
 * Datei: pendingWorkflowScopeDecision.ts
 * Bereich: Desktop Services / Workflow Continuity
 *
 * Zweck:
 *   Persistiert die auslösende Nachricht einer Workflow-Abgrenzungsfrage,
 *   damit nach A/B-Auswahl exakt diese Nachricht fortgesetzt wird.
 */

import { workspaceScopeId } from "@dbzs/shared";

export interface PendingWorkflowScopeDecision {
  workspaceId: string;
  workspaceRoot: string;
  activeWorkflowId: string;
  triggeringMessageId: string;
  triggeringMessage: string;
  questionId: string;
  actionId: string;
  messageId: string;
  createdAt: string;
}

const STORAGE_PREFIX = "dbzs.pending-workflow-scope.v1:";
const memoryByWorkspace = new Map<string, PendingWorkflowScopeDecision | null>();

function storageKey(workspaceRoot: string): string {
  return `${STORAGE_PREFIX}${workspaceScopeId(workspaceRoot)}`;
}

export function readPendingWorkflowScopeDecision(
  workspaceRoot: string | null | undefined
): PendingWorkflowScopeDecision | null {
  if (!workspaceRoot?.trim()) return null;
  const key = storageKey(workspaceRoot);
  if (memoryByWorkspace.has(key)) {
    return memoryByWorkspace.get(key) ?? null;
  }
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      memoryByWorkspace.set(key, null);
      return null;
    }
    const parsed = JSON.parse(raw) as PendingWorkflowScopeDecision;
    memoryByWorkspace.set(key, parsed);
    return parsed;
  } catch {
    memoryByWorkspace.set(key, null);
    return null;
  }
}

export function writePendingWorkflowScopeDecision(decision: PendingWorkflowScopeDecision): void {
  const key = storageKey(decision.workspaceRoot);
  memoryByWorkspace.set(key, decision);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(decision));
  } catch {
    // best effort
  }
}

export function clearPendingWorkflowScopeDecision(workspaceRoot: string | null | undefined): void {
  if (!workspaceRoot?.trim()) return;
  const key = storageKey(workspaceRoot);
  memoryByWorkspace.set(key, null);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // best effort
  }
}

export function resetPendingWorkflowScopeDecisionMemoryForTests(): void {
  memoryByWorkspace.clear();
}
