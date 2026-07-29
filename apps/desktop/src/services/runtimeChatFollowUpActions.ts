import type {
  ChatActionKind,
  ChatActionRequest,
  RuntimeChatMessage,
  RuntimeChatRun,
  RuntimeChatRunStatus,
  RuntimeRunOutcome
} from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import { PRESET_MESSAGES } from "@/stores/runtimeChatStoreRuntimeHelpers";

export type FollowUpActionKind =
  | "continue_task"
  | "implement_plan"
  | "show_next_steps"
  | "retry_run"
  | "inspect_result"
  | "new_task";

export const FOLLOW_UP_ACTION_KINDS: ReadonlySet<ChatActionKind> = new Set<ChatActionKind>([
  "continue_task",
  "implement_plan",
  "show_next_steps",
  "retry_run",
  "inspect_result",
  "new_task"
]);

export interface FollowUpActionContext {
  message: RuntimeChatMessage;
  run: RuntimeChatRun | null;
  taskType: string | null;
  outcome: RuntimeRunOutcome | null;
  status: RuntimeChatRunStatus | null;
  hasPlanProposal: boolean;
  hasPatchProposal: boolean;
  hasErrors: boolean;
  workspaceRoot: string | null;
}

function buildAction(
  context: FollowUpActionContext,
  kind: FollowUpActionKind,
  title: string,
  prompt: string
): ChatActionRequest {
  const workspaceRoot = context.workspaceRoot ?? "";
  return {
    id: `followup-${context.message.id}-${kind}`,
    runId: context.run?.id ?? "",
    messageId: context.message.id,
    workspaceRoot,
    workspaceId: workspaceRoot ? workspaceScopeId(workspaceRoot) : "",
    kind,
    title,
    riskLevel: "low",
    payload: { prompt },
    state: "pending",
    createdAt: new Date().toISOString()
  };
}

export function buildFollowUpActions(context: FollowUpActionContext): ChatActionRequest[] {
  const { run, outcome, hasPlanProposal, hasPatchProposal, hasErrors, taskType } = context;

  if (hasPlanProposal || hasPatchProposal) return [];
  if (outcome === "needs_user_input" || outcome === "cancelled") return [];
  if (run?.repositoryReview) return [];

  const isFailure = Boolean(outcome) && outcome !== "success";
  if (isFailure) {
    return [
      buildAction(context, "retry_run", "Erneut versuchen", "Bitte versuche die letzte Aufgabe erneut auszuführen."),
      buildAction(
        context,
        "inspect_result",
        "Ergebnis prüfen",
        "Fasse zusammen, was fehlgeschlagen ist, und nenne mögliche Ursachen."
      )
    ];
  }

  if (hasErrors) {
    return [
      buildAction(
        context,
        "continue_task",
        "Fehler beheben",
        "Bitte behebe die gefundenen Fehler und erläutere kurz die Ursache."
      ),
      buildAction(
        context,
        "inspect_result",
        "Ursache vertiefen",
        "Vertiefe die Ursachenanalyse für den zuletzt gefundenen Fehler."
      ),
      buildAction(context, "show_next_steps", "Nächste Schritte", PRESET_MESSAGES.next_steps)
    ];
  }

  if (taskType === "planning" || taskType === "architecture") {
    return [
      buildAction(context, "implement_plan", "Plan umsetzen", "Setze den vorgeschlagenen Plan direkt um."),
      buildAction(context, "show_next_steps", "Nächste Schritte", PRESET_MESSAGES.next_steps),
      buildAction(context, "new_task", "Neue Aufgabe", "Ich möchte eine neue, unabhängige Aufgabe starten.")
    ];
  }

  return [
    buildAction(context, "continue_task", "Vertiefen", "Vertiefe deine letzte Antwort mit mehr Details."),
    buildAction(context, "show_next_steps", "Nächste Schritte", PRESET_MESSAGES.next_steps),
    buildAction(context, "new_task", "Neue Aufgabe", "Ich möchte eine neue, unabhängige Aufgabe starten.")
  ];
}

export function attachFollowUpActionsToMessages(input: {
  messages: RuntimeChatMessage[];
  finalizedAssistantMessage: RuntimeChatMessage;
  run: RuntimeChatRun | null;
  taskType: string | null;
  hasPlanProposal: boolean;
  hasPatchProposal: boolean;
  workspaceRoot: string | null;
}): RuntimeChatMessage[] {
  const { messages, finalizedAssistantMessage, run, taskType, hasPlanProposal, hasPatchProposal, workspaceRoot } =
    input;
  const targetIndex = messages.findIndex((m) => m.id === finalizedAssistantMessage.id);
  if (targetIndex < 0) return messages;
  const targetMessage = messages[targetIndex];
  const followUpIdPrefix = `followup-${targetMessage.id}-`;
  if (targetMessage.actions?.some((a) => a.id.startsWith(followUpIdPrefix))) {
    return messages;
  }
  const hasErrors = Boolean(targetMessage.toolCalls?.some((call) => call.status === "error"));
  const followUps = buildFollowUpActions({
    message: targetMessage,
    run,
    taskType,
    outcome: run?.outcome ?? null,
    status: run?.status ?? null,
    hasPlanProposal,
    hasPatchProposal,
    hasErrors,
    workspaceRoot
  });
  if (followUps.length === 0) return messages;
  const next = [...messages];
  next[targetIndex] = { ...targetMessage, actions: [...(targetMessage.actions ?? []), ...followUps] };
  return next;
}
