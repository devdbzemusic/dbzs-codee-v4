/**
 * Separated stream-phase timeouts: prompt-eval, first-token, stream-idle, generation.
 */

import type { RuntimeRunOutcome } from "@dbzs/shared";

export type PhaseTimeoutKind =
  | "prompt_eval_timeout"
  | "first_token_timeout"
  | "stream_idle_timeout"
  | "generation_timeout";

export interface PhaseTimeoutHandlers {
  onTimeout: (kind: PhaseTimeoutKind, message: string) => void;
  isAborted: () => boolean;
  hasFirstToken: () => boolean;
}

export interface PhaseTimeoutController {
  startPreTokenWatchdogs: (opts: {
    promptEvalTimeoutMs: number;
    firstTokenTimeoutMs: number;
  }) => void;
  onFirstToken: (opts: {
    streamIdleTimeoutMs: number;
    generationTimeoutMs: number;
  }) => void;
  touchStreamActivity: () => void;
  clearAll: () => void;
}

export function createPhaseTimeoutController(handlers: PhaseTimeoutHandlers): PhaseTimeoutController {
  let promptEvalTimer: ReturnType<typeof setTimeout> | null = null;
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = null;
  let streamIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let generationTimer: ReturnType<typeof setTimeout> | null = null;
  let streamIdleMs = 0;
  let firstTokenSeen = false;

  const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer) clearTimeout(timer);
    return null;
  };

  const fire = (kind: PhaseTimeoutKind, message: string) => {
    if (handlers.isAborted()) return;
    if (kind === "prompt_eval_timeout" || kind === "first_token_timeout") {
      if (handlers.hasFirstToken() || firstTokenSeen) return;
    }
    handlers.onTimeout(kind, message);
  };

  const clearAll = () => {
    promptEvalTimer = clearTimer(promptEvalTimer);
    firstTokenTimer = clearTimer(firstTokenTimer);
    streamIdleTimer = clearTimer(streamIdleTimer);
    generationTimer = clearTimer(generationTimer);
  };

  const armStreamIdle = () => {
    if (streamIdleMs <= 0) return;
    streamIdleTimer = clearTimer(streamIdleTimer);
    streamIdleTimer = setTimeout(() => {
      fire("stream_idle_timeout", `Stream-Idle-Timeout nach ${streamIdleMs / 1000}s ohne Token`);
    }, streamIdleMs);
  };

  return {
    startPreTokenWatchdogs({ promptEvalTimeoutMs, firstTokenTimeoutMs }) {
      clearAll();
      firstTokenSeen = false;
      if (promptEvalTimeoutMs > 0) {
        promptEvalTimer = setTimeout(() => {
          fire(
            "prompt_eval_timeout",
            `Prompt-Eval-Timeout nach ${promptEvalTimeoutMs / 1000}s (kein erstes Token)`
          );
        }, promptEvalTimeoutMs);
      }
      if (firstTokenTimeoutMs > 0) {
        firstTokenTimer = setTimeout(() => {
          fire(
            "first_token_timeout",
            `First-Token-Timeout nach ${firstTokenTimeoutMs / 1000}s`
          );
        }, firstTokenTimeoutMs);
      }
    },

    onFirstToken({ streamIdleTimeoutMs, generationTimeoutMs }) {
      if (firstTokenSeen) {
        armStreamIdle();
        return;
      }
      firstTokenSeen = true;
      promptEvalTimer = clearTimer(promptEvalTimer);
      firstTokenTimer = clearTimer(firstTokenTimer);
      streamIdleMs = streamIdleTimeoutMs;
      armStreamIdle();
      if (generationTimeoutMs > 0) {
        generationTimer = clearTimer(generationTimer);
        generationTimer = setTimeout(() => {
          fire(
            "generation_timeout",
            `Generation-Timeout nach ${generationTimeoutMs / 1000}s`
          );
        }, generationTimeoutMs);
      }
    },

    touchStreamActivity() {
      if (!firstTokenSeen) return;
      armStreamIdle();
    },

    clearAll
  };
}

export function outcomeForPhaseTimeout(kind: PhaseTimeoutKind): RuntimeRunOutcome {
  switch (kind) {
    case "prompt_eval_timeout":
      return "prompt_eval_timeout";
    case "first_token_timeout":
      return "first_token_timeout";
    case "stream_idle_timeout":
      return "stream_idle_timeout";
    case "generation_timeout":
      return "generation_timeout";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
