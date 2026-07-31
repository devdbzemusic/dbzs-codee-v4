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
import { isGenericRuntimeErrorSentinel } from "@/services/runtimeRunFinalization";
import {
  analyzeNoActionRecoveryOutput,
  buildNoActionRecoveryPrompt
} from "@/services/runtimeChatNoActionRecovery";

export type FollowUpActionKind =
  | "continue_task"
  | "implement_plan"
  | "show_next_steps"
  | "retry_run"
  | "inspect_result"
  | "new_task"
  | "switch_model";

export const FOLLOW_UP_ACTION_KINDS: ReadonlySet<ChatActionKind> = new Set<ChatActionKind>([
  "continue_task",
  "implement_plan",
  "show_next_steps",
  "retry_run",
  "inspect_result",
  "new_task",
  "switch_model"
]);

// Strong, low-false-positive indicators of an actual runtime/tool error dumped into an
// otherwise "success"-outcome assistant answer. Deliberately narrower than a generic
// /fehler/i match, since a coding assistant routinely discusses "Fehler" without one
// having just occurred (e.g. "der Fehler wurde behoben").
const ASSISTANT_ERROR_TEXT_PATTERNS = [
  /ReferenceError:/,
  /TypeError:/,
  /Cannot read (?:properties|property) of undefined/i,
  /undefined is not (?:an object|a function)/i,
  /Traceback \(most recent call last\)/,
  /\bException\b.*:/,
  /^Error:/m,
  /ist ein Fehler aufgetreten/i,
  /\bfehlgeschlagen\b/i
];

function contentIndicatesError(content: string | null | undefined): boolean {
  if (!content) return false;
  if (isGenericRuntimeErrorSentinel(content)) return true;
  return ASSISTANT_ERROR_TEXT_PATTERNS.some((pattern) => pattern.test(content));
}

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
  /** Literal text of the user message that started this run, for a real retry. */
  originalUserPrompt?: string | null;
}

function buildAction(
  context: FollowUpActionContext,
  kind: FollowUpActionKind,
  title: string,
  prompt: string,
  extraPayload?: Record<string, unknown>
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
    payload: extraPayload ? { prompt, ...extraPayload } : { prompt },
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
  if (outcome === "execution_no_action") {
    const analysis = analyzeNoActionRecoveryOutput(context.message.rawContent ?? context.message.content);
    const actions: ChatActionRequest[] = [];
    if (analysis.hasRecoverableOutput) {
      actions.push(
        buildAction(
          context,
          "continue_task",
          "Aktion vorbereiten",
          buildNoActionRecoveryPrompt({
            originalUserPrompt: context.originalUserPrompt,
            analysis
          }),
          { recoveryKind: "no_action_output", recoverySignals: analysis.signals }
        )
      );
    }
    const retryPrompt = context.originalUserPrompt?.trim()
      ? [
          context.originalUserPrompt.trim(),
          "",
          "Bitte fuehre den Auftrag im Agent-Modus mit echten Tools/Patches aus. Wenn du blockiert bist, frage konkret nach."
        ].join("\n")
      : "Bitte versuche die letzte Aufgabe erneut und nutze dafuer echte Tools, Patches oder freigabepflichtige Aktionen.";
    actions.push(
      buildAction(context, "retry_run", "Mit Tools erneut", retryPrompt, {
        retryOriginal: Boolean(context.originalUserPrompt?.trim()),
        taskType,
        provider: run?.provider ?? null,
        agentMode: run?.mode ?? null,
        forceUseResidentModel: true,
        recoveryKind: "execution_no_action"
      })
    );
    actions.push(
      buildAction(
        context,
        "inspect_result",
        "Nur analysieren",
        "Analysiere die letzte nicht ausgefuehrte Antwort: Was war verwertbar, was fehlte fuer eine sichere CODEE-Aktion?"
      )
    );
    return actions.slice(0, 3);
  }

  if (isFailure) {
    const hasOriginalPrompt = Boolean(context.originalUserPrompt?.trim());
    const retryPrompt = hasOriginalPrompt
      ? (context.originalUserPrompt as string).trim()
      : "Bitte versuche die letzte Aufgabe erneut auszuführen.";
    const actions = [
      buildAction(context, "retry_run", "Erneut versuchen", retryPrompt, {
        retryOriginal: hasOriginalPrompt,
        taskType,
        provider: run?.provider ?? null,
        agentMode: run?.mode ?? null,
        forceUseResidentModel: true
      })
    ];
    const modelSwitchWorthy =
      run?.resourceRisk === "high" || run?.resourceRisk === "unsupported" || Boolean(run?.fallbackRejection);
    if (modelSwitchWorthy) {
      actions.push(
        buildAction(context, "switch_model", "Modell wechseln", "Modell wechseln", { navigateToTab: "runtime" })
      );
    }
    actions.push(
      buildAction(
        context,
        "inspect_result",
        "Ergebnis prüfen",
        "Fasse zusammen, was fehlgeschlagen ist, und nenne mögliche Ursachen."
      )
    );
    return actions.slice(0, 3);
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
  const hasErrors =
    Boolean(targetMessage.toolCalls?.some((call) => call.status === "error")) ||
    contentIndicatesError(targetMessage.content);
  const originalUserPrompt = run?.userMessageId
    ? messages.find((m) => m.id === run.userMessageId)?.content ?? null
    : null;
  const followUps = buildFollowUpActions({
    message: targetMessage,
    run,
    taskType,
    outcome: run?.outcome ?? null,
    status: run?.status ?? null,
    hasPlanProposal,
    hasPatchProposal,
    hasErrors,
    workspaceRoot,
    originalUserPrompt
  });
  if (followUps.length === 0) return messages;
  const next = [...messages];
  next[targetIndex] = { ...targetMessage, actions: [...(targetMessage.actions ?? []), ...followUps] };
  return next;
}
