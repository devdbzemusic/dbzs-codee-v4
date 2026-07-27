/*
 * DBZS – Division By Zeros
 * Datei: workflowContinuation.ts
 * Bereich: Desktop Services / Workflow Continuity
 *
 * Zweck:
 *   Erkennt Folgefragen und explizite neue Tasks, bevor Einzel-Intent greift.
 *   Ein aktiver Contract verschluckt keine unabhängigen Chatfragen mehr.
 */

import type { AssistantQuestion, RuntimeTaskType } from "@dbzs/shared";
import type { ActiveTaskContract } from "@/services/activeTaskContract";
import { matchesReviewIntent } from "@/services/modelSelectionBroker";
import {
  classifyUserExecutionIntent,
  isToolRequiredExecutionIntent,
  taskTypeForExecutionIntent
} from "@/services/executionIntent";
import { resolveCanonicalWorkflowAssignment } from "@/runtime/workflow/workflowStateResolver";

const FOLLOW_UP_PATTERNS = [
  /nächste[n]?\s+\d+\s+schritte/i,
  /next\s+\d+\s+steps/i,
  /priorisierte[n]?\s+schritte/i,
  /mach\s+weiter/i,
  /continue/i,
  /zeig\s+mir\s+den\s+plan/i,
  /show\s+(me\s+)?the\s+plan/i,
  /welche\s+dateien/i,
  /which\s+files/i,
  /warum\s+ist\s+das/i,
  /why\s+is\s+(that|this)/i,
  /gib\s+mir\s+(drei|3)\s+priorit/i,
  /was\s+sind\s+die\s+nächsten/i,
  /what\s+are\s+the\s+next/i,
  /kurze\s+begründung/i,
  /inklusive\s+kurzer\s+begründung/i
];

const NEW_TASK_PATTERNS = [
  /^neue\s+aufgabe\s*:/i,
  /^new\s+task\s*:/i,
  /^neuer\s+auftrag\s*:/i,
  /^ignore\s+previous/i,
  /^vergiss\s+(den|die|das)\s+vorherige/i
];

const WORKFLOW_ANSWER_PATTERNS = [
  /^a\s*[-–—:]/i,
  /^b\s*[-–—:]/i,
  /^option\s*[ab]/i,
  /akzeptanz/i,
  /definition of done/i,
  /für\s+(gitarre|bass)/i,
  /übungsziel/i,
  /\bbpm\b/i
];

export function isExplicitNewTaskMessage(message: string): boolean {
  return NEW_TASK_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

export function isWorkflowFollowUpMessage(message: string): boolean {
  const cleaned = message.trim();
  if (!cleaned) return false;
  if (isExplicitNewTaskMessage(cleaned)) return false;
  return FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(cleaned));
}

export function referencesActiveTask(message: string, contract: ActiveTaskContract): boolean {
  const cleaned = message.toLowerCase();
  const needles = [
    contract.confirmedGoal,
    contract.originalRequest,
    contract.workflowId,
    ...contract.acceptanceCriteria
  ]
    .map((value) => value.toLowerCase().trim())
    .filter((value) => value.length >= 4);

  const tokens = new Set<string>();
  for (const needle of needles) {
    for (const token of needle.split(/[^a-zäöüß0-9]+/i)) {
      if (token.length >= 5) tokens.add(token);
    }
  }

  // Strong product tokens from the StringLab Smart Practice case.
  for (const token of ["stringlab", "practice", "session", "gitarre", "bass"]) {
    if (needles.some((needle) => needle.includes(token))) {
      tokens.add(token);
    }
  }

  let hits = 0;
  for (const token of tokens) {
    if (cleaned.includes(token)) hits += 1;
  }
  return hits >= 2 || (hits >= 1 && /auftrag|task|feature|funktion|session/i.test(cleaned));
}

export function isDirectWorkflowAnswer(
  message: string,
  contract: ActiveTaskContract
): boolean {
  if (contract.currentPhase !== "clarification" && contract.currentPhase !== "awaiting_plan_approval") {
    return false;
  }
  const cleaned = message.trim();
  if (!cleaned) return false;
  // Explicit implement/fix/refactor/test/build is a new task, never a clarification reply.
  if (isToolRequiredExecutionIntent(classifyUserExecutionIntent(cleaned))) {
    return false;
  }
  if (WORKFLOW_ANSWER_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return true;
  }
  // Short answers during clarification are treated as workflow replies,
  // unless they clearly start an unrelated topic.
  if (/erkläre|erklare|explain|was ist|what is|quanten|wetter|witz/i.test(cleaned)) {
    return false;
  }
  return cleaned.length <= 280;
}

export type WorkflowContinuationReason =
  | "explicit_new_task"
  | "active_workflow_follow_up"
  | "active_workflow_reference"
  | "active_workflow_answer"
  | "active_workflow_phase_expected"
  | "active_workflow_continue"
  | "workflow_ambiguity"
  | "single_message_intent";

export interface WorkflowContinuationResult {
  useActiveContract: boolean;
  taskType: RuntimeTaskType;
  reason: WorkflowContinuationReason;
  contract: ActiveTaskContract | null;
  /** Unclear whether the user stays on the active task — requires ask_user. */
  needsAmbiguityAsk: boolean;
}

/**
 * Routing priority:
 * 1. explicit new execution intent (implement/fix/…) — never inherit review contract
 * 2. explicit new task marker
 * 3. confirmed follow-up / task reference / workflow answer / expected phase
 * 4. ambiguous chat with active contract → ask_user (no silent stickiness)
 * 5. otherwise defer to single-message intent classification
 */
export function resolveWorkflowContinuation(input: {
  message: string;
  contract: ActiveTaskContract | null;
  classifiedTaskType: RuntimeTaskType;
}): WorkflowContinuationResult {
  const { message, contract, classifiedTaskType } = input;
  const executionIntent = classifyUserExecutionIntent(message);

  if (isExplicitNewTaskMessage(message)) {
    return {
      useActiveContract: false,
      taskType: classifiedTaskType,
      reason: "explicit_new_task",
      contract: null,
      needsAmbiguityAsk: false
    };
  }

  // P0: explicit implement/fix/refactor/test/build always wins over a stale review contract.
  if (isToolRequiredExecutionIntent(executionIntent) || executionIntent === "plan_only") {
    const freshType = taskTypeForExecutionIntent(executionIntent);
    const staleReview =
      !contract ||
      contract.taskType === "review" ||
      contract.currentPhase === "review" ||
      contract.currentPhase === "completed" ||
      contract.currentPhase === "cancelled" ||
      contract.currentPhase === "failed";
    const unrelated =
      Boolean(contract) &&
      !referencesActiveTask(message, contract!) &&
      contract!.taskType !== freshType;
    if (staleReview || unrelated) {
      return {
        useActiveContract: false,
        taskType: freshType,
        reason: "explicit_new_task",
        contract: null,
        needsAmbiguityAsk: false
      };
    }
  }

  if (
    !contract ||
    contract.currentPhase === "completed" ||
    contract.currentPhase === "cancelled" ||
    contract.currentPhase === "failed"
  ) {
    return {
      useActiveContract: false,
      taskType: classifiedTaskType,
      reason: "single_message_intent",
      contract,
      needsAmbiguityAsk: false
    };
  }

  // Explicit review while a workspace contract is open: switch phase, keep contract.
  // Never when the message is itself an implement/fix request.
  if (
    !isToolRequiredExecutionIntent(executionIntent) &&
    (matchesReviewIntent(message) || classifiedTaskType === "review")
  ) {
    return {
      useActiveContract: true,
      taskType: "review",
      reason: "active_workflow_continue",
      contract,
      needsAmbiguityAsk: false
    };
  }

  const followUp = isWorkflowFollowUpMessage(message);
  const references = referencesActiveTask(message, contract);
  const directAnswer = isDirectWorkflowAnswer(message, contract);
  const phaseExpects =
    (contract.currentPhase === "clarification" && directAnswer) ||
    (contract.currentPhase === "awaiting_plan_approval" &&
      /freigabe|approve|ablehnen|reject|planen/i.test(message));

  if (followUp || references || directAnswer || phaseExpects) {
    const taskType =
      contract.currentPhase === "implementation" || contract.currentPhase === "executing"
        ? contract.taskType === "planning" || contract.taskType === "architecture"
          ? "small_code_change"
          : contract.taskType
        : contract.taskType === "casual_chat" || contract.taskType === "normal_chat"
          ? "planning"
          : contract.taskType;

    const reason: WorkflowContinuationReason = followUp
      ? "active_workflow_follow_up"
      : references
        ? "active_workflow_reference"
        : directAnswer
          ? "active_workflow_answer"
          : "active_workflow_phase_expected";

    return {
      useActiveContract: true,
      taskType,
      reason,
      contract,
      needsAmbiguityAsk: false
    };
  }

  if (isChatTask(classifiedTaskType)) {
    // Independent chat must not silently inherit the old workflow.
    return {
      useActiveContract: false,
      taskType: classifiedTaskType,
      reason: "workflow_ambiguity",
      contract,
      needsAmbiguityAsk: true
    };
  }

  // Non-chat intents while a contract is open continue the workflow.
  return {
    useActiveContract: true,
    taskType: classifiedTaskType,
    reason: "active_workflow_continue",
    contract,
    needsAmbiguityAsk: false
  };
}

function isChatTask(taskType: RuntimeTaskType): boolean {
  return taskType === "casual_chat" || taskType === "normal_chat";
}

export function phaseForTaskType(taskType: RuntimeTaskType): ActiveTaskContract["currentPhase"] {
  return resolveCanonicalWorkflowAssignment({
    userMessage: taskType,
    classifiedIntent: "inspect",
    classifiedTaskType: taskType
  }).phase;
}

/**
 * Align contract phase with the routed agent.
 *
 * Code tasks map to `implementation`, but planner-first routing still assigns
 * `planner` for the initial plan. Writing implementation+planner trips the
 * hard phase/agent gate — keep those starts in `planning` until coder handoff.
 */
export function resolvePhaseForRoutedAgent(
  taskType: RuntimeTaskType,
  agent: string | null | undefined
): ActiveTaskContract["currentPhase"] {
  const normalized = String(agent ?? "").toLowerCase();
  const requestedPhase =
    normalized === "coder" &&
    ["small_code_change", "large_code_change", "refactoring"].includes(taskType)
      ? "implementation"
      : normalized === "debugger" && taskType === "debugging"
        ? "diagnosis"
        : normalized === "reviewer" && (taskType === "review" || taskType === "test_analysis")
          ? "review"
          : null;
  return resolveCanonicalWorkflowAssignment({
    userMessage: taskType,
    classifiedIntent: "inspect",
    classifiedTaskType: taskType,
    requestedAgent: (normalized || null) as never,
    requestedPhase
  }).phase;
}

export function buildWorkflowAmbiguityQuestion(contract: ActiveTaskContract): {
  question: AssistantQuestion;
  prompt: string;
  context: string;
} {
  const label = (contract.confirmedGoal || contract.originalRequest || "laufenden Auftrag").trim();
  const shortLabel = label.length > 72 ? `${label.slice(0, 72)}…` : label;
  const prompt = `Möchtest du beim laufenden Auftrag bleiben oder eine neue Aufgabe beginnen?`;
  const context =
    `Die neue Nachricht ist nicht eindeutig als Fortsetzung oder als neuer Auftrag erkennbar. ` +
    `Aktiver Auftrag: ${shortLabel} · Workflow: ${contract.workflowId} · Phase: ${contract.currentPhase}`;
  const questionId = `workflow-scope-${contract.workflowId}`;
  return {
    prompt,
    context,
    question: {
      id: questionId,
      questionType: "single_choice",
      prompt,
      context,
      options: [
        {
          id: "continue_active_task",
          label: "Beim laufenden Auftrag bleiben",
          description: `Die Nachricht wird im bestehenden Auftrag weiterverarbeitet (${shortLabel}).`,
          recommended: true
        },
        {
          id: "start_new_task",
          label: "Neue Aufgabe beginnen",
          description: "Der bisherige Auftrag wird pausiert und aus der neuen Nachricht wird ein separater Task."
        }
      ],
      defaultOptionId: "continue_active_task",
      allowFreeText: false,
      requiredField: "workflow_scope_decision",
      riskLevel: "low",
      toolCallId: "workflow-continuation-policy"
    }
  };
}

/** @deprecated Prefer buildWorkflowAmbiguityQuestion — kept for older call sites/tests. */
export function buildWorkflowAmbiguityPrompt(contract: ActiveTaskContract): {
  prompt: string;
  context: string;
} {
  const built = buildWorkflowAmbiguityQuestion(contract);
  return { prompt: built.prompt, context: built.context };
}

export type WorkflowScopeOptionId = "continue_active_task" | "start_new_task";

const CONTINUE_ALIASES = new Set([
  "a",
  "1",
  "weiter",
  "beim auftrag bleiben",
  "beim laufenden auftrag bleiben",
  "fortsetzen",
  "continue",
  "continue_active_task"
]);

const NEW_TASK_ALIASES = new Set([
  "b",
  "2",
  "neu",
  "neue aufgabe",
  "neuen auftrag beginnen",
  "neue aufgabe beginnen",
  "start_new_task",
  "new"
]);

/**
 * Map free-text chat aliases to a structured workflow-scope choice.
 * Returns null when the text is not a clear A/B selection.
 */
export function mapWorkflowScopeTextAlias(message: string): WorkflowScopeOptionId | null {
  const cleaned = message.trim().toLowerCase().replace(/\s+/g, " ");
  if (!cleaned) return null;
  if (CONTINUE_ALIASES.has(cleaned)) return "continue_active_task";
  if (NEW_TASK_ALIASES.has(cleaned)) return "start_new_task";
  if (/^a\b/.test(cleaned) && cleaned.length <= 40) return "continue_active_task";
  if (/^b\b/.test(cleaned) && cleaned.length <= 40) return "start_new_task";
  return null;
}

export function workflowScopeDecisionLabel(optionId: WorkflowScopeOptionId): string {
  switch (optionId) {
    case "continue_active_task":
      return "Beim laufenden Auftrag bleiben";
    case "start_new_task":
      return "Neue Aufgabe begonnen";
    default: {
      const _exhaustive: never = optionId;
      return _exhaustive;
    }
  }
}
