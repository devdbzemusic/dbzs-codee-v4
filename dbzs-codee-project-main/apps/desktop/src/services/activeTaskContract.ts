/*
 * DBZS – Division By Zeros
 * Datei: activeTaskContract.ts
 * Bereich: Desktop Services / Workflow Continuity
 *
 * Zweck:
 *   Persistiert einen workspace-gebundenen Task Contract über Rückfragen
 *   und Folgefragen hinweg, damit Routing nicht als neuer Casual-Chat startet.
 */

import {
  workspaceScopeId,
  type ReviewRemediationCapsule,
  type RuntimeTaskType
} from "@dbzs/shared";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import { migrateActiveTaskContractWorkflow } from "@/runtime/workflow/workflowContractMigration";
import type {
  WorkflowAgentRole,
  WorkflowKind,
  WorkflowModelRole
} from "@/runtime/workflow/workflowContracts";

export type ActiveTaskPhase =
  | "clarification"
  | "diagnosis"
  | "planning"
  | "awaiting_plan_approval"
  | "awaiting_dependency_approval"
  | "implementation"
  | "executing"
  | "testing"
  | "awaiting_patch_approval"
  | "verification"
  | "review"
  | "completed"
  | "failed"
  | "cancelled";

export type ClarificationFieldId =
  | "target"
  | "acceptance_criteria"
  | "scope_boundary"
  | "review_target"
  | "review_focus"
  | "success_criteria"
  | "constraints"
  | "review_selection"
  | "remediation_scope"
  | "workflow_scope_decision";

export interface AnsweredClarificationField {
  field: ClarificationFieldId;
  questionId: string;
  question: string;
  answer: string;
  answeredAt: string;
}

export interface ActiveTaskContract {
  workspaceId: string;
  workspaceRoot: string;
  workflowId: string;
  runId: string;
  workflowKind?: WorkflowKind;
  originalRequest: string;
  confirmedGoal: string;
  acceptanceCriteria: string[];
  currentPhase: ActiveTaskPhase;
  assignedAgent: WorkflowAgentRole;
  effectiveAgent?: WorkflowAgentRole;
  requestedAgent?: WorkflowAgentRole;
  taskType: RuntimeTaskType;
  policyVersion?: number;
  modelRole?: WorkflowModelRole;
  toolProfile?: AgentToolProfile;
  transitionVersion?: number;
  lastTransitionEvent?: string;
  /** Legacy Q/A list — still written for backward compatibility. */
  answeredQuestions: Array<{ question: string; answer: string }>;
  /** Stable field → answer map; authoritative for clarification preflight. */
  answeredFields: Record<string, AnsweredClarificationField>;
  reviewRemediation?: ReviewRemediationCapsule;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_PREFIX = "dbzs.active-task-contract.v1:";
const memoryByWorkspace = new Map<string, ActiveTaskContract | null>();

const DEFAULT_NO_CONSTRAINTS_ANSWER =
  "Keine zusätzlichen Vorgaben; bestehende Projektkonventionen verwenden.";

function storageKey(workspaceRoot: string): string {
  return `${STORAGE_PREFIX}${workspaceScopeId(workspaceRoot)}`;
}

export function inferClarificationFieldFromQuestion(question: string): ClarificationFieldId | null {
  const q = question.toLowerCase();
  if (q.includes("erfolgreich war") || q.includes("planung erfolgreich") || q.includes("erfolgskriterium")) {
    return "success_criteria";
  }
  if (q.includes("einschränkung") || q.includes("vorgaben") || q.includes("constraint")) {
    return "constraints";
  }
  if (q.includes("akzeptanz") || q.includes("korrekt ist") || q.includes("änderung korrekt")) {
    return "acceptance_criteria";
  }
  if (q.includes("beschränken") || q.includes("verwandte module") || q.includes("scope")) {
    return "scope_boundary";
  }
  if (q.includes("was soll geprüft") || q.includes("was soll geprueft")) {
    return "review_target";
  }
  if (q.includes("reviewen") || q.includes("welche datei")) {
    return q.includes("konzentrieren") || q.includes("fokus") ? "review_focus" : "review_target";
  }
  if (q.includes("worauf soll sich das review")) {
    return "review_focus";
  }
  if (q.includes("funktion soll") || q.includes("modul soll") || q.includes("datei bzw")) {
    return "target";
  }
  return null;
}

export function normalizeConstraintsAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (!trimmed) return DEFAULT_NO_CONSTRAINTS_ANSWER;
  if (
    /keine\s+(weiteren\s+)?(vorgaben|einschränkungen)|keine\s+zusätzlichen|no\s+(additional\s+)?constraints|bestehenden?\s+projektkonventionen/i.test(
      trimmed
    )
  ) {
    return DEFAULT_NO_CONSTRAINTS_ANSWER;
  }
  return trimmed;
}

function migrateContract(raw: ActiveTaskContract): ActiveTaskContract {
  const answeredFields: Record<string, AnsweredClarificationField> = {
    ...(raw.answeredFields ?? {})
  };

  for (const qa of raw.answeredQuestions ?? []) {
    const field = inferClarificationFieldFromQuestion(qa.question);
    if (!field || answeredFields[field]) continue;
    answeredFields[field] = {
      field,
      questionId: `migrated-${field}`,
      question: qa.question,
      answer: qa.answer,
      answeredAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
    };
  }

  if (
    (raw.acceptanceCriteria?.length ?? 0) > 0 &&
    !answeredFields.success_criteria &&
    !answeredFields.acceptance_criteria
  ) {
    answeredFields.success_criteria = {
      field: "success_criteria",
      questionId: "migrated-acceptance-as-success",
      question: "Akzeptanzkriterien (Feature)",
      answer: raw.acceptanceCriteria.join(" | "),
      answeredAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
    };
  }

  const migrated: ActiveTaskContract = {
    ...raw,
    workflowKind: raw.workflowKind ?? "chat",
    answeredQuestions: raw.answeredQuestions ?? [],
    answeredFields,
    effectiveAgent: raw.effectiveAgent ?? raw.assignedAgent ?? "runtime_chat",
    policyVersion: raw.policyVersion ?? 1,
    modelRole: raw.modelRole ?? "chat",
    toolProfile: raw.toolProfile ?? "ask",
    transitionVersion: raw.transitionVersion ?? 1
  };
  return migrateActiveTaskContractWorkflow(migrated);
}

export function readActiveTaskContract(workspaceRoot: string | null | undefined): ActiveTaskContract | null {
  if (!workspaceRoot?.trim()) return null;
  const key = storageKey(workspaceRoot);
  if (memoryByWorkspace.has(key)) {
    const cached = memoryByWorkspace.get(key) ?? null;
    return cached ? migrateContract(cached) : null;
  }
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      memoryByWorkspace.set(key, null);
      return null;
    }
    const parsed = migrateContract(JSON.parse(raw) as ActiveTaskContract);
    if (parsed.currentPhase === "completed" || parsed.currentPhase === "cancelled") {
      memoryByWorkspace.set(key, null);
      return null;
    }
    memoryByWorkspace.set(key, parsed);
    return parsed;
  } catch {
    memoryByWorkspace.set(key, null);
    return null;
  }
}

export function writeActiveTaskContract(contract: ActiveTaskContract): void {
  const normalized = migrateContract(contract);
  const key = storageKey(normalized.workspaceRoot);
  memoryByWorkspace.set(key, normalized);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(normalized));
  } catch {
    // best effort
  }
}

export function clearActiveTaskContract(workspaceRoot: string | null | undefined): void {
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

const ARCHIVE_PREFIX = "dbzs.active-task-contract.archive.v1:";

function archiveStorageKey(workspaceRoot: string, workflowId: string): string {
  return `${ARCHIVE_PREFIX}${workspaceScopeId(workspaceRoot)}:${workflowId}`;
}

/**
 * Pause/archive the active contract without destroying history.
 * Clears the active slot so a new task can start cleanly.
 */
export function pauseActiveTaskContract(workspaceRoot: string | null | undefined): ActiveTaskContract | null {
  if (!workspaceRoot?.trim()) return null;
  const existing = readActiveTaskContract(workspaceRoot);
  if (!existing) return null;

  const paused: ActiveTaskContract = {
    ...existing,
    currentPhase: "cancelled",
    updatedAt: new Date().toISOString()
  };

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(archiveStorageKey(workspaceRoot, existing.workflowId), JSON.stringify(paused));
    } catch {
      // best effort archive
    }
  }

  clearActiveTaskContract(workspaceRoot);
  return paused;
}

/**
 * Detach UI from a workspace contract without deleting persistence.
 * Next restore/read reloads from localStorage when available.
 */
export function detachActiveTaskContract(workspaceRoot: string | null | undefined): void {
  if (!workspaceRoot?.trim()) return;
  // Only drop the memory cache when localStorage can rehydrate.
  // Without localStorage (unit tests / SSR), keep the in-memory contract.
  if (typeof localStorage === "undefined") return;
  memoryByWorkspace.delete(storageKey(workspaceRoot));
}

/**
 * Restore the persisted contract for a workspace into memory.
 */
export function restoreActiveTaskContract(
  workspaceRoot: string | null | undefined
): ActiveTaskContract | null {
  if (!workspaceRoot?.trim()) return null;
  if (typeof localStorage !== "undefined") {
    memoryByWorkspace.delete(storageKey(workspaceRoot));
  }
  return readActiveTaskContract(workspaceRoot);
}

export function upsertActiveTaskContract(
  workspaceRoot: string,
  patch: Partial<ActiveTaskContract> &
    Pick<ActiveTaskContract, "originalRequest" | "confirmedGoal" | "taskType" | "assignedAgent" | "currentPhase">
): ActiveTaskContract {
  const existing = readActiveTaskContract(workspaceRoot);
  const now = new Date().toISOString();
  const next: ActiveTaskContract = {
    workspaceId: workspaceScopeId(workspaceRoot),
    workspaceRoot,
    workflowId: patch.workflowId ?? existing?.workflowId ?? `wf-${Date.now().toString(36)}`,
    runId: patch.runId ?? existing?.runId ?? `run-${Date.now().toString(36)}`,
    workflowKind: patch.workflowKind ?? existing?.workflowKind ?? "chat",
    originalRequest: patch.originalRequest,
    confirmedGoal: patch.confirmedGoal,
    acceptanceCriteria:
      patch.acceptanceCriteria !== undefined
        ? patch.acceptanceCriteria
        : (existing?.acceptanceCriteria ?? []),
    currentPhase: patch.currentPhase,
    assignedAgent: patch.assignedAgent,
    effectiveAgent: patch.effectiveAgent ?? patch.assignedAgent,
    requestedAgent: patch.requestedAgent ?? existing?.requestedAgent,
    taskType: patch.taskType,
    policyVersion: patch.policyVersion ?? existing?.policyVersion ?? 1,
    modelRole: patch.modelRole ?? existing?.modelRole ?? "chat",
    toolProfile: patch.toolProfile ?? existing?.toolProfile ?? "ask",
    transitionVersion: patch.transitionVersion ?? existing?.transitionVersion ?? 1,
    lastTransitionEvent: patch.lastTransitionEvent ?? existing?.lastTransitionEvent,
    answeredQuestions: patch.answeredQuestions ?? existing?.answeredQuestions ?? [],
    answeredFields: patch.answeredFields ?? existing?.answeredFields ?? {},
    reviewRemediation: patch.reviewRemediation ?? existing?.reviewRemediation,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const normalized = migrateContract(next);
  writeActiveTaskContract(normalized);
  return normalized;
}

export function appendContractAnswer(
  workspaceRoot: string,
  question: string,
  answer: string
): ActiveTaskContract | null {
  const field = inferClarificationFieldFromQuestion(question);
  return appendContractFieldAnswer(workspaceRoot, field ?? undefined, `legacy-${Date.now().toString(36)}`, question, answer);
}

export function appendContractFieldAnswer(
  workspaceRoot: string,
  field: string | undefined,
  questionId: string,
  question: string,
  answer: string
): ActiveTaskContract | null {
  const existing = readActiveTaskContract(workspaceRoot);
  if (!existing) return null;

  const fieldId = (field as ClarificationFieldId | undefined) ?? inferClarificationFieldFromQuestion(question);
  const normalizedAnswer =
    fieldId === "constraints" ? normalizeConstraintsAnswer(answer) : answer.trim();

  const answeredQuestions = [
    ...existing.answeredQuestions.filter((item) => item.question !== question),
    { question, answer: normalizedAnswer }
  ];

  const answeredFields = { ...existing.answeredFields };
  if (fieldId) {
    answeredFields[fieldId] = {
      field: fieldId,
      questionId,
      question,
      answer: normalizedAnswer,
      answeredAt: new Date().toISOString()
    };
  }

  let acceptanceCriteria = existing.acceptanceCriteria;
  if (
    (fieldId === "success_criteria" || fieldId === "acceptance_criteria") &&
    normalizedAnswer &&
    !acceptanceCriteria.includes(normalizedAnswer)
  ) {
    acceptanceCriteria = [...acceptanceCriteria, normalizedAnswer];
  }

  const next: ActiveTaskContract = {
    ...existing,
    answeredQuestions,
    answeredFields,
    acceptanceCriteria,
    updatedAt: new Date().toISOString()
  };
  writeActiveTaskContract(next);
  return next;
}

export function answeredFieldIds(contract: ActiveTaskContract | null | undefined): Set<string> {
  if (!contract) return new Set();
  return new Set(Object.keys(contract.answeredFields ?? {}));
}

export function clarificationKey(
  workspaceId: string,
  workflowId: string,
  requiredField: string
): string {
  return `${workspaceId}:${workflowId}:${requiredField}`;
}

export function formatActiveTaskContractBlock(
  contract: ActiveTaskContract,
  currentUserQuestion?: string
): string {
  const lines = [
    "[ACTIVE TASK CONTRACT]",
    "",
    `Workspace: ${contract.workspaceRoot}`,
    `Workflow: ${contract.workflowId}`,
    `Phase: ${contract.currentPhase}`,
    `Agent: ${contract.effectiveAgent ?? contract.assignedAgent}`,
    `TaskType: ${contract.taskType}`,
    `WorkflowKind: ${contract.workflowKind}`,
    "",
    "Ziel:",
    contract.confirmedGoal || contract.originalRequest,
    ""
  ];
  if (contract.acceptanceCriteria.length > 0) {
    lines.push("Akzeptanz:");
    for (const item of contract.acceptanceCriteria) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  const fieldEntries = Object.values(contract.answeredFields ?? {});
  if (fieldEntries.length > 0) {
    lines.push("Clarification:");
    for (const entry of fieldEntries) {
      lines.push(`- ${entry.field} = answered`);
    }
    lines.push("");
  } else if (contract.answeredQuestions.length > 0) {
    lines.push("Beantwortete Rückfragen:");
    for (const qa of contract.answeredQuestions.slice(-6)) {
      lines.push(`- Q: ${qa.question}`);
      lines.push(`  A: ${qa.answer}`);
    }
    lines.push("");
  }
  if (currentUserQuestion?.trim()) {
    lines.push("Benutzerfrage:");
    lines.push(currentUserQuestion.trim());
  }
  return lines.join("\n");
}

/** Reset in-memory cache between tests. */
export function resetActiveTaskContractMemoryForTests(): void {
  memoryByWorkspace.clear();
}
