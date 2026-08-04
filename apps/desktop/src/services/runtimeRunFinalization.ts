/*
 * DBZS – Division By Zeros
 * Datei: runtimeRunFinalization.ts
 * Bereich: Desktop Services / Runtime Chat
 *
 * Zweck:
 *   Eine Source of Truth für den terminalen Run-Outcome.
 *   Transport-/Streaming-Erfolg ≠ fachlich verwertbare Endantwort.
 */

import type { RuntimeRunOutcome, RuntimeSlotId } from "@dbzs/shared";

export type RuntimeRunErrorStage =
  | "runtime_start"
  | "warmup"
  | "generation"
  | "output_parse"
  | "agent_loop"
  | "tool_execution"
  | "finalization";

export interface RuntimePipelineState {
  runtimeReady: boolean;
  inferenceReady: boolean;
  firstTokenReceived: boolean;
  modelOutputReceived: boolean;
  outputParsed: boolean;
  agentLoopCompleted: boolean;
  finalAnswerDelivered: boolean;
}

export interface RuntimeRunError {
  kind: "run_error";
  outcome: Exclude<RuntimeRunOutcome, "success" | "needs_user_input">;
  stage: RuntimeRunErrorStage;
  userMessage: string;
  technicalDetail?: string;
  retryable: boolean;
  correlationId: string;
}

export interface FinalAnswerDiagnostics {
  correlationId: string;
  runId: string;
  modelId: string;
  modelName: string;
  slotId: string;
  httpStatus?: number;
  finishReason?: string;
  choiceCount?: number;
  rawContentLength: number;
  rawContentPreview?: string;
  parserUsed?: string;
  parserSucceeded: boolean;
  parserError?: string;
  /** When set, parser was intentionally not run. */
  parserSkippedReason?: "provider_error" | "empty_output" | "tool_only_turn";
  agentTurnCount: number;
  pendingToolCalls: number;
  completedToolCalls: number;
  finalAnswerLength: number;
  finalAnswerDelivered: boolean;
  finalOutcome: RuntimeRunOutcome;
  contextSafetyMarginTokens?: number;
}

export interface FinalizeRuntimeRunInput {
  runId: string;
  outcome?: RuntimeRunOutcome;
  finalAnswer?: string | null;
  error?: RuntimeRunError | null;
  pipeline?: Partial<RuntimePipelineState>;
  diagnostics?: Partial<FinalAnswerDiagnostics>;
  /** Transport marked this as a synthetic safe fallback. */
  safeFallback?: boolean;
  agentTurnCount?: number;
  pendingToolCalls?: number;
  completedToolCalls?: number;
  requiresStructuredOutput?: boolean;
  trajectoryStatus?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  slotId?: string | null;
  finishReason?: string | null;
  rawContent?: string | null;
  contextWindowTokens?: number | null;
  totalRequiredTokens?: number | null;
  /** Structured provider error — skip parser and never claim success. */
  providerError?: boolean;
  parserSkippedReason?: "provider_error" | "empty_output" | "tool_only_turn";
}

export interface FinalizeRuntimeRunResult {
  outcome: RuntimeRunOutcome;
  status: "completed" | "failed" | "cancelled" | "waiting_for_plan_approval";
  finalAnswerDelivered: boolean;
  userMessage: string;
  error: RuntimeRunError | null;
  diagnostics: FinalAnswerDiagnostics;
  /** When true, do not keep the answer as a successful assistant bubble. */
  suppressAssistantSuccess: boolean;
}

const GENERIC_ERROR_SENTINELS = [
  "Runtime konnte die Anfrage nicht ausführen",
  "Bitte Diagnose-Log prüfen",
  "Anfrage kürzer erneut senden",
  "Unbekannter Runtime-Fehler",
  "Agent konnte keine Antwort erzeugen",
  "Verbindung unterbrochen",
  "Runtime hat die Anfrage abgelehnt"
];

const finalizedRuns = new Map<string, FinalizeRuntimeRunResult>();

export function resetRuntimeRunFinalizationForTests(): void {
  finalizedRuns.clear();
}

export function isGenericRuntimeErrorSentinel(content: string | null | undefined): boolean {
  const text = (content ?? "").trim();
  if (!text) return false;
  return GENERIC_ERROR_SENTINELS.some((sentinel) => text.includes(sentinel));
}

const RESIDUAL_TOOL_CALL_PATTERN = /<CODEE_TOOL_CALL>[\s\S]*?<\/CODEE_TOOL_CALL>/;

/** True when the content contains unexecuted tool-call protocol markup, not a clean final answer. */
export function isToolOnlyAnswer(content: string | null | undefined): boolean {
  const text = (content ?? "").trim();
  if (!text) return false;
  return RESIDUAL_TOOL_CALL_PATTERN.test(text);
}

export function isValidFinalAnswer(content: string | null | undefined): boolean {
  const text = (content ?? "").trim();
  if (!text) return false;
  if (isGenericRuntimeErrorSentinel(text)) return false;
  if (isToolOnlyAnswer(text)) return false;
  return true;
}

function redactPreview(raw: string, maxBytes = 4096): string {
  let preview = raw.slice(0, maxBytes);
  preview = preview.replace(/([A-Za-z]:\\[^\s"']+)/g, "[path]");
  preview = preview.replace(/(\/Users\/[^\s"']+|\/home\/[^\s"']+)/g, "[path]");
  preview = preview.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  return preview;
}

function defaultUserMessage(outcome: RuntimeRunOutcome): string {
  switch (outcome) {
    case "success":
      return "Antwort erfolgreich abgeschlossen";
    case "needs_user_input":
      return "Weitere Eingabe erforderlich";
    case "cancelled":
      return "Lauf abgebrochen";
    case "context_overflow":
      return "Ich habe mehr Kontext gesammelt, als in das aktuelle Kontextfenster des Modells passt. Wenn du willst, machen wir mit weniger Kontext weiter oder wechseln auf ein passenderes Profil.";
    case "empty_final_answer":
      return "Ich habe keine verwertbare Endantwort vom Modell bekommen. Wir können die Anfrage direkt noch einmal kleiner oder klarer versuchen.";
    case "agent_output_invalid":
      return "Ich habe eine Antwort bekommen, konnte sie aber nicht sauber als nutzbare Endantwort übernehmen.";
    case "agent_loop_incomplete":
      return "Der Agentenlauf ist ohne sauberen Abschluss geendet. Ich kann den nächsten Versuch gezielter und kompakter ansetzen.";
    case "tool_loop_failed":
      return "Ein Tool-Schritt ist schiefgelaufen, deshalb habe ich den Lauf ohne unsaubere Endantwort gestoppt.";
    case "generation_failed":
      return "Die Generierung ist unterwegs abgebrochen. Wir können denselben Schritt erneut oder mit weniger Last versuchen.";
    case "first_token_timeout":
      return "First-Token-Timeout: Modell war erreichbar, lieferte aber kein erstes Token rechtzeitig.";
    case "process_start_timeout":
      return "Prozessstart-Timeout: Runtime-Prozess startete nicht rechtzeitig.";
    case "endpoint_ready_timeout":
      return "Endpoint-Timeout: Runtime-Endpoint wurde nicht rechtzeitig erreichbar.";
    case "model_load_timeout":
      return "Modelllade-Timeout: Modell wurde nicht rechtzeitig geladen.";
    case "prompt_eval_timeout":
      return "Prompt-Eval-Timeout: Prompt-Auswertung lieferte kein erstes Token rechtzeitig.";
    case "stream_idle_timeout":
      return "Stream-Idle-Timeout: Streaming lieferte zu lange keine weiteren Tokens.";
    case "partial_output_stream_incomplete":
      return "Der Stream lieferte Teiltext, aber kein gültiges Abschlussereignis. Die Ausgabe gilt nicht als Erfolg.";
    case "generation_timeout":
      return "Generation-Timeout: Gesamte Generierung überschritt das Zeitlimit.";
    case "runtime_oom":
      return "Das aktuelle Modell oder der Kontext passt gerade nicht in den gewählten Slot. Ich kann mit kleinerem Profil oder anderem Modell weitermachen.";
    case "warmup_failed":
      return "Das Rollenmodell ist nicht sauber inferenzbereit geworden. Sinnvoll wäre jetzt ein kleineres Profil, ein anderes Modell oder ein degradiertes Weiterarbeiten.";
    case "runtime_start_failed":
      return "Das Arbeitsmodell konnte nicht starten. Ich kann als Nächstes einen Retry, ein anderes Profil oder ein anderes Modell anbieten.";
    case "answer_relevance_failed":
      return "Die Antwort war thematisch nicht an den aktiven Auftrag gebunden.";
    case "execution_no_action":
      return "Im Ausführungsmodus wurden keine Tools, Patches oder Commands ausgeführt.";
    case "invalid_protocol":
      return "Die strukturierte Agent-Ausgabe war ungültig (Protocol Failure).";
    case "skill_tool_policy_violation":
      return "Der aktive Skill hat den angeforderten Tool-Aufruf nicht erlaubt.";
    case "command_spawn_failed":
      return "Ein Workspace-Befehl konnte nicht gestartet werden.";
    case "dependency_install_failed":
      return "Die Dependency-Installation ist fehlgeschlagen.";
    case "patch_failed":
      return "Der Patch konnte nicht angewendet oder verifiziert werden.";
    case "validation_failed":
      return "Die Validierung nach der Umsetzung ist fehlgeschlagen.";
    case "request_binding_mismatch":
      return "Provider-Request stimmt nicht mit dem Post-Fallback-Kontext überein. Lauf gestoppt.";
    case "workflow_state_invalid":
      return "Ungültige Phase-/Agent-Kombination. Lauf gestoppt.";
    case "internal_error":
    case "runtime_error":
    case "runtime_timeout":
    case "runtime_unreachable":
      return "Die Runtime hat den Lauf nicht sauber zu Ende gebracht. Wenn du willst, arbeiten wir direkt mit einer stabileren Recovery-Option weiter.";
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

function inferFailureOutcome(input: FinalizeRuntimeRunInput, answer: string): RuntimeRunOutcome {
  if (input.outcome && input.outcome !== "success") {
    return input.outcome;
  }
  if (input.providerError || input.safeFallback || isGenericRuntimeErrorSentinel(answer)) {
    if (looksLikeContextOverflowMessage(answer)) {
      const overflowTokens =
        input.contextWindowTokens != null && input.totalRequiredTokens != null
          ? Math.max(0, input.totalRequiredTokens - input.contextWindowTokens)
          : null;
      // Never claim context_overflow when the last budget snapshot shows room.
      if (overflowTokens === 0 && !input.providerError) {
        return "generation_failed";
      }
      // Structured provider overflow may still map to context_overflow.
      if (overflowTokens === 0) {
        return "generation_failed";
      }
      return "context_overflow";
    }
    return "generation_failed";
  }
  if (!answer.trim()) {
    return "empty_final_answer";
  }
  if (isToolOnlyAnswer(answer)) {
    return "invalid_protocol";
  }
  if (input.pendingToolCalls && input.pendingToolCalls > 0) {
    return "tool_loop_failed";
  }
  if (input.trajectoryStatus === "budget_exceeded") {
    return "agent_loop_incomplete";
  }
  if (input.requiresStructuredOutput && input.pipeline?.outputParsed === false) {
    return "agent_output_invalid";
  }
  if (input.pipeline?.agentLoopCompleted === false) {
    return "agent_loop_incomplete";
  }
  return "generation_failed";
}

/** True only for explicit n_ctx / context-window failures — not any mention of "context". */
export function looksLikeContextOverflowMessage(content: string | null | undefined): boolean {
  const text = (content ?? "").toLowerCase();
  if (!text.trim()) return false;
  if (
    text.includes("kontextfenster") ||
    text.includes("context_overflow") ||
    text.includes("n_ctx") ||
    /anfrage ist größer als das aktuelle runtime-kontextfenster/i.test(text)
  ) {
    return true;
  }
  const mentionsContextLimit = /context\s*(window|length|limit|size)/i.test(text);
  const mentionsOverflow = /(exceed|overflow|too large|größer)/i.test(text);
  return mentionsContextLimit && mentionsOverflow;
}

/**
 * Single finalization gate for Runtime Chat runs.
 * Terminal outcome is set exactly once per runId.
 */
export function finalizeRuntimeRun(input: FinalizeRuntimeRunInput): FinalizeRuntimeRunResult {
  const existing = finalizedRuns.get(input.runId);
  if (existing) {
    console.warn(`[finalizeRuntimeRun] duplicate finalization ignored for ${input.runId}`, {
      previous: existing.outcome,
      attempted: input.outcome
    });
    return existing;
  }

  const answer = (input.finalAnswer ?? "").trim();
  const raw = input.rawContent ?? answer;
  const pipeline: RuntimePipelineState = {
    runtimeReady: input.pipeline?.runtimeReady ?? true,
    inferenceReady: input.pipeline?.inferenceReady ?? true,
    firstTokenReceived: input.pipeline?.firstTokenReceived ?? Boolean(answer),
    modelOutputReceived: input.pipeline?.modelOutputReceived ?? Boolean(raw),
    outputParsed: input.pipeline?.outputParsed ?? true,
    agentLoopCompleted: input.pipeline?.agentLoopCompleted ?? true,
    finalAnswerDelivered: false
  };

  let outcome: RuntimeRunOutcome = input.outcome ?? "success";
  let error: RuntimeRunError | null = input.error ?? null;
  let suppressAssistantSuccess = false;

  if (outcome === "needs_user_input") {
    const result: FinalizeRuntimeRunResult = {
      outcome,
      status: "waiting_for_plan_approval",
      finalAnswerDelivered: false,
      userMessage: defaultUserMessage(outcome),
      error: null,
      suppressAssistantSuccess: false,
      diagnostics: buildDiagnostics(input, outcome, answer, raw, false)
    };
    finalizedRuns.set(input.runId, result);
    return result;
  }

  if (outcome === "cancelled") {
    const result: FinalizeRuntimeRunResult = {
      outcome,
      status: "cancelled",
      finalAnswerDelivered: false,
      userMessage: defaultUserMessage(outcome),
      error: null,
      suppressAssistantSuccess: false,
      diagnostics: buildDiagnostics(input, outcome, answer, raw, false)
    };
    finalizedRuns.set(input.runId, result);
    return result;
  }

  const answerOk =
    isValidFinalAnswer(answer) &&
    !input.safeFallback &&
    !input.providerError &&
    pipeline.modelOutputReceived &&
    pipeline.agentLoopCompleted &&
    (!input.requiresStructuredOutput || pipeline.outputParsed) &&
    (input.pendingToolCalls ?? 0) === 0;

  if (outcome === "success" && !answerOk) {
    outcome = inferFailureOutcome(input, answer);
  }

  if (outcome !== "success") {
    suppressAssistantSuccess = true;
    pipeline.finalAnswerDelivered = false;
    if (!error) {
      error = {
        kind: "run_error",
        outcome: outcome as Exclude<RuntimeRunOutcome, "success" | "needs_user_input">,
        stage: outcome === "agent_output_invalid" || outcome === "answer_relevance_failed" || outcome === "invalid_protocol"
          ? "output_parse"
          : outcome === "tool_loop_failed"
            ? "tool_execution"
            : outcome === "agent_loop_incomplete"
              ? "agent_loop"
              : outcome === "warmup_failed"
                ? "warmup"
                : outcome === "runtime_start_failed"
                  ? "runtime_start"
                  : "generation",
        userMessage: defaultUserMessage(outcome),
        technicalDetail: isGenericRuntimeErrorSentinel(answer) ? answer.slice(0, 400) : undefined,
        retryable: outcome !== "cancelled",
        correlationId: input.runId
      };
    }
  } else {
    pipeline.finalAnswerDelivered = true;
  }

  const result: FinalizeRuntimeRunResult = {
    outcome,
    status: outcome === "success" ? "completed" : "failed",
    finalAnswerDelivered: pipeline.finalAnswerDelivered,
    userMessage:
      outcome === "success"
        ? "Antwort erfolgreich abgeschlossen · Gültige Endantwort ausgeliefert"
        : error?.userMessage ?? defaultUserMessage(outcome),
    error,
    suppressAssistantSuccess,
    diagnostics: buildDiagnostics(input, outcome, answer, raw, pipeline.finalAnswerDelivered)
  };
  finalizedRuns.set(input.runId, result);
  return result;
}

function buildDiagnostics(
  input: FinalizeRuntimeRunInput,
  outcome: RuntimeRunOutcome,
  answer: string,
  raw: string,
  delivered: boolean
): FinalAnswerDiagnostics {
  const margin =
    typeof input.contextWindowTokens === "number" && typeof input.totalRequiredTokens === "number"
      ? Math.max(0, input.contextWindowTokens - input.totalRequiredTokens)
      : undefined;

  return {
    correlationId: input.runId,
    runId: input.runId,
    modelId: input.modelId ?? "",
    modelName: input.modelName ?? "",
    slotId: (input.slotId) ?? "",
    finishReason: input.finishReason ?? undefined,
    rawContentLength: raw.length,
    rawContentPreview: raw ? redactPreview(raw) : undefined,
    parserSucceeded:
      input.providerError || input.safeFallback || input.parserSkippedReason
        ? false
        : input.pipeline?.outputParsed !== false,
    parserError: input.diagnostics?.parserError,
    parserUsed: input.diagnostics?.parserUsed,
    parserSkippedReason:
      input.parserSkippedReason ??
      (input.providerError || input.safeFallback ? "provider_error" : undefined),
    agentTurnCount: input.agentTurnCount ?? 0,
    pendingToolCalls: input.pendingToolCalls ?? 0,
    completedToolCalls: input.completedToolCalls ?? 0,
    finalAnswerLength: answer.length,
    finalAnswerDelivered: delivered,
    finalOutcome: outcome,
    contextSafetyMarginTokens: margin,
    ...input.diagnostics
  };
}
