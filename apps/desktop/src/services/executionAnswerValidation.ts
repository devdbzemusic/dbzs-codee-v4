import type { UserExecutionIntent } from "@/services/executionIntent";
import { isToolRequiredExecutionIntent } from "@/services/executionIntent";

export interface ExecutionAnswerValidation {
  executionIntent: UserExecutionIntent;
  toolCallsExecuted: number;
  filesChanged: number;
  commandsExecuted: number;
  delegatedToUser: boolean;
  valid: boolean;
  reason?: string;
}

const DELEGATION_PATTERNS = [
  /öffne\s+(dein|das|dein(e)?)\s+terminal/i,
  /open\s+(your\s+)?terminal/i,
  /führe\s+(folgenden|diesen|den)\s+befehl\s+aus/i,
  /fuehre\s+(folgenden|diesen|den)\s+befehl\s+aus/i,
  /run\s+the\s+following\s+command/i,
  /gib\s+im\s+terminal\s+ein/i,
  /type\s+in\s+(your\s+)?terminal/i,
  /erstelle\s+manuell/i,
  /create\s+(it\s+)?manually/i,
  /kopiere\s+diese\s+datei/i,
  /copy\s+this\s+file/i,
  /installiere\s+global/i,
  /npm\s+install\s+-g\b/i,
  /pnpm\s+add\s+-g\b/i,
  /yarn\s+global\s+add\b/i,
  /please\s+run\s+(these\s+)?commands?/i,
  /du\s+musst\s+(jetzt\s+)?(folgendes\s+)?ausführen/i,
  /you\s+(should|must|need\s+to)\s+run\b/i
];

const PROVEN_BLOCKER_PATTERNS = [
  /\bblocker\b/i,
  /freigabe\s+fehlt/i,
  /approval\s+(required|missing|needed)/i,
  /workspace\s+(nicht\s+gebunden|fehlt|missing)/i,
  /tools?\s+(deaktiviert|disabled|unavailable)/i,
  /runtime\s+(nicht\s+bereit|unavailable|nicht\s+erreichbar)/i
];

const MUTATING_FILE_TOOLS = /^(apply_patch|write_file|create_file)$/i;
const COMMAND_TOOLS = /^(run_terminal_command|run_workspace_command|run_tests|run_build|run_command)$/i;

export function detectUserDelegation(content: string | null | undefined): boolean {
  const text = (content ?? "").trim();
  if (!text) return false;
  return DELEGATION_PATTERNS.some((p) => p.test(text));
}

export function detectProvenBlocker(content: string | null | undefined): boolean {
  const text = (content ?? "").trim();
  if (!text) return false;
  return PROVEN_BLOCKER_PATTERNS.some((p) => p.test(text));
}

export function countExecutionToolEffects(
  toolNames: Array<string | null | undefined>
): { filesChanged: number; commandsExecuted: number } {
  let filesChanged = 0;
  let commandsExecuted = 0;
  for (const name of toolNames) {
    const n = (name ?? "").trim();
    if (!n) continue;
    if (MUTATING_FILE_TOOLS.test(n)) filesChanged += 1;
    if (COMMAND_TOOLS.test(n)) commandsExecuted += 1;
  }
  return { filesChanged, commandsExecuted };
}

export function validateExecutionAnswer(input: {
  executionIntent: UserExecutionIntent;
  finalAnswer: string | null | undefined;
  toolCallsExecuted: number;
  filesChanged?: number;
  commandsExecuted?: number;
  hasProvenBlocker?: boolean;
}): ExecutionAnswerValidation {
  const toolCallsExecuted = Math.max(0, input.toolCallsExecuted);
  const filesChanged = Math.max(0, input.filesChanged ?? 0);
  const commandsExecuted = Math.max(0, input.commandsExecuted ?? 0);
  const delegatedToUser = detectUserDelegation(input.finalAnswer);
  const toolRequired = isToolRequiredExecutionIntent(input.executionIntent);
  const hasProvenBlocker =
    Boolean(input.hasProvenBlocker) || detectProvenBlocker(input.finalAnswer);

  const base = {
    executionIntent: input.executionIntent,
    toolCallsExecuted,
    filesChanged,
    commandsExecuted,
    delegatedToUser
  };

  if (!toolRequired) {
    return { ...base, valid: true };
  }

  if (hasProvenBlocker) {
    return { ...base, valid: true, reason: "proven_blocker" };
  }

  if (delegatedToUser && toolCallsExecuted === 0) {
    return {
      ...base,
      valid: false,
      reason: "terminal_delegation_without_tools"
    };
  }

  if (toolCallsExecuted === 0 && filesChanged === 0 && commandsExecuted === 0) {
    return {
      ...base,
      valid: false,
      reason: "no_tool_execution"
    };
  }

  return { ...base, valid: true };
}

export function executionBlockerUserMessage(validation: ExecutionAnswerValidation): string {
  switch (validation.reason) {
    case "terminal_delegation_without_tools":
      return (
        "Die Antwort war eine Terminal-Anleitung ohne Tool-Ausführung. " +
        "Codee muss Workspace-Tools selbst nutzen oder einen konkreten Blocker nennen " +
        "(fehlende Freigabe, fehlende Runtime, Workspace nicht gebunden)."
      );
    case "no_tool_execution":
      return (
        "Für diesen Ausführungsauftrag wurden keine Tools ausgeführt. " +
        "Ohne Datei-/Command-Tools gilt die Aufgabe nicht als umgesetzt."
      );
    default:
      return "Die Antwort erfüllt den Execution-Contract nicht.";
  }
}

export interface ExecutionFinalAnswerGate {
  valid: boolean;
  validation: ExecutionAnswerValidation;
  /** When invalid or environment-blocked, prefer this visible message. */
  userMessage?: string;
  /** When true, finalize as non-success (agent_output_invalid). */
  rejectAsInvalid: boolean;
}

/**
 * Gate final assistant answers for implement/fix/refactor/test/build intents.
 */
export function gateExecutionFinalAnswer(input: {
  userMessage: string;
  executionIntent: UserExecutionIntent;
  finalAnswer: string | null | undefined;
  toolCallsExecuted: number;
  toolNames?: Array<string | null | undefined>;
  toolsEnabled: boolean;
  workspaceRoot?: string | null;
}): ExecutionFinalAnswerGate {
  const effects = countExecutionToolEffects(input.toolNames ?? []);
  const environmentBlocked =
    isToolRequiredExecutionIntent(input.executionIntent) &&
    (!input.toolsEnabled || !input.workspaceRoot);

  if (environmentBlocked) {
    const reasonParts = [
      !input.workspaceRoot ? "Workspace ist nicht gebunden." : null,
      !input.toolsEnabled ? "Workspace-Tools sind deaktiviert." : null
    ].filter(Boolean);
    const userMessage =
      `Ausführung blockiert: ${reasonParts.join(" ")} ` +
      "Ohne gebundene Workspace-Tools kann Codee den Auftrag nicht selbst umsetzen.";
    const validation = validateExecutionAnswer({
      executionIntent: input.executionIntent,
      finalAnswer: userMessage,
      toolCallsExecuted: input.toolCallsExecuted,
      filesChanged: effects.filesChanged,
      commandsExecuted: effects.commandsExecuted,
      hasProvenBlocker: true
    });
    return {
      valid: false,
      validation,
      userMessage,
      rejectAsInvalid: true
    };
  }

  const validation = validateExecutionAnswer({
    executionIntent: input.executionIntent,
    finalAnswer: input.finalAnswer,
    toolCallsExecuted: input.toolCallsExecuted,
    filesChanged: effects.filesChanged,
    commandsExecuted: effects.commandsExecuted
  });

  if (!validation.valid) {
    return {
      valid: false,
      validation,
      userMessage: executionBlockerUserMessage(validation),
      rejectAsInvalid: true
    };
  }

  return { valid: true, validation, rejectAsInvalid: false };
}
