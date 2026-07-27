export interface CombinedAbortSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

function abortSignalWithReason(reason: unknown): AbortSignal {
  if (typeof AbortSignal.abort === "function") {
    return AbortSignal.abort(reason);
  }

  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
}

export function combineAbortSignals(signals: Array<AbortSignal | null | undefined>): CombinedAbortSignal {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));

  if (activeSignals.length === 0) {
    return {
      signal: new AbortController().signal,
      cleanup: () => undefined
    };
  }

  const alreadyAborted = activeSignals.find((signal) => signal.aborted);
  if (alreadyAborted) {
    return {
      signal: abortSignalWithReason(alreadyAborted.reason),
      cleanup: () => undefined
    };
  }

  if (activeSignals.length === 1) {
    return {
      signal: activeSignals[0],
      cleanup: () => undefined
    };
  }

  if (typeof AbortSignal.any === "function") {
    return {
      signal: AbortSignal.any(activeSignals),
      cleanup: () => undefined
    };
  }

  const controller = new AbortController();
  const subscriptions: Array<{ signal: AbortSignal; listener: () => void }> = [];

  const cleanup = () => {
    for (const subscription of subscriptions.splice(0)) {
      subscription.signal.removeEventListener("abort", subscription.listener);
    }
  };

  for (const signal of activeSignals) {
    const listener = () => {
      if (!controller.signal.aborted) {
        controller.abort(signal.reason);
      }
      cleanup();
    };
    subscriptions.push({ signal, listener });
    signal.addEventListener("abort", listener, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup
  };
}
