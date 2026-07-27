/**
 * Read-only conversation meta intents — bypass planning/coding clarification
 * and do not require starting a work model.
 */

import type { ActiveTaskContract, ClarificationFieldId } from "@/services/activeTaskContract";
import { answeredFieldIds } from "@/services/activeTaskContract";
import type { ModelSelectionDecision } from "@/services/modelSelectionBroker";
import type { RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";

export type ConversationMetaIntent =
  | "summarize_active_task"
  | "show_status"
  | "show_decisions"
  | "show_open_questions"
  | null;

const SUMMARIZE_PATTERNS: RegExp[] = [
  /\bfasse\b.*\bzusammen\b/i,
  /\bzusammenfass/i,
  /\baktueller\s+stand\b/i,
  /\bfortschritt\b/i,
  /\boffene\s+punkte\b/i,
  /\bn[aä]chster\s+schritt\b/i,
  /\bsummarize\b/i,
  /\bstatus\s+recap\b/i
];

const PLANNING_OPEN_FIELDS: ClarificationFieldId[] = ["success_criteria", "constraints"];

export function detectConversationMetaIntent(message: string): ConversationMetaIntent {
  const trimmed = message.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (
    SUMMARIZE_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    (lower.includes("fasse") && lower.includes("zusammen"))
  ) {
    return "summarize_active_task";
  }

  if (/\b(zeige|show)\s+(status|zustand)\b/i.test(trimmed) || /\bstatus\s+anzeigen\b/i.test(trimmed)) {
    return "show_status";
  }
  if (/\b(zeige|show)\s+entscheidungen\b/i.test(trimmed) || /\bdecisions?\b/i.test(trimmed)) {
    return "show_decisions";
  }
  if (/\boffene\s+(fragen|punkte)\b/i.test(trimmed) || /\bopen\s+questions?\b/i.test(trimmed)) {
    return "show_open_questions";
  }

  return null;
}

export interface DeterministicSummaryContext {
  contract: ActiveTaskContract | null;
  lastRouting?: RuntimeChatRoutingInfo | null;
  lastBrokerDecision?: ModelSelectionDecision | null;
  lastRunOutcome?: string | null;
  warmupDetail?: string | null;
}

function fieldLabel(field: string): string {
  switch (field) {
    case "success_criteria":
      return "Erfolgskriterium";
    case "constraints":
      return "technische Einschränkungen / Vorgaben";
    case "acceptance_criteria":
      return "Akzeptanzkriterien";
    case "target":
      return "Ziel / Target";
    case "scope_boundary":
      return "Scope-Grenze";
    case "review_target":
      return "Review-Ziel";
    case "review_focus":
      return "Review-Fokus";
    default:
      return field;
  }
}

/**
 * Deterministic status summary from ActiveTaskContract + routing diagnostics.
 * Does not mutate the contract and does not ask clarification questions.
 */
export function buildDeterministicActiveTaskSummary(ctx: DeterministicSummaryContext): string {
  const answered = answeredFieldIds(ctx.contract);
  const progress: string[] = [];
  const open: string[] = [];

  if (ctx.contract) {
    progress.push(`Ziel: ${ctx.contract.confirmedGoal || ctx.contract.originalRequest}`);
    progress.push(`Phase: ${ctx.contract.currentPhase} · Agent: ${ctx.contract.assignedAgent}`);
    if (ctx.contract.acceptanceCriteria.length > 0) {
      progress.push(`Akzeptanzkriterien: ${ctx.contract.acceptanceCriteria.length} erfasst`);
    }
    for (const [field, entry] of Object.entries(ctx.contract.answeredFields ?? {})) {
      progress.push(`${fieldLabel(field)} beantwortet`);
      if (entry.answer.trim()) {
        progress.push(`  → ${entry.answer.trim().slice(0, 160)}`);
      }
    }
  } else {
    open.push("Kein Active Task Contract vorhanden");
  }

  if (ctx.lastRouting?.modelId) {
    progress.push(
      `Rollenmodell: ${ctx.lastRouting.modelName ?? ctx.lastRouting.modelId}` +
        (ctx.lastRouting.selectionSource ? ` (${ctx.lastRouting.selectionSource})` : "")
    );
  }
  if (ctx.lastRouting?.warmupStatus === "ready") {
    progress.push("Runtime-Inferenz warm (inference_ready)");
  } else if (ctx.lastRouting?.warmupStatus === "failed") {
    open.push(
      `Warm-up fehlgeschlagen${ctx.warmupDetail ? `: ${ctx.warmupDetail}` : ""}`
    );
  }
  if (ctx.lastRunOutcome) {
    progress.push(`Letzter Run: ${ctx.lastRunOutcome}`);
  }

  for (const field of PLANNING_OPEN_FIELDS) {
    if (!answered.has(field)) {
      open.push(`${fieldLabel(field)} noch nicht beantwortet`);
    }
  }

  const next: string[] = [];
  if (!ctx.contract) {
    next.push("Task starten (z. B. Plan) und Ziel klären");
  } else if (!answered.has("success_criteria")) {
    next.push("Plan fortsetzen und Erfolgskriterium klären");
  } else if (!answered.has("constraints")) {
    next.push("Technische Einschränkungen klären oder „keine weiteren Vorgaben“ antworten, dann Plan erneut starten");
  } else if (ctx.lastRouting?.warmupStatus === "failed") {
    next.push("Warm-up reparieren und denselben Planning-Run erneut starten");
  } else {
    next.push("Plan / Next fortsetzen");
  }

  const lines = ["Fortschritt:"];
  for (const item of progress) {
    lines.push(`- ${item}`);
  }
  if (progress.length === 0) {
    lines.push("- (noch kein Fortschritt)");
  }

  lines.push("", "Offen:");
  if (open.length === 0) {
    lines.push("- keine offenen Pflichtfelder");
  } else {
    for (const item of open) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("", "Nächster Schritt:");
  for (const item of next) {
    lines.push(`- ${item}`);
  }

  return lines.join("\n");
}
