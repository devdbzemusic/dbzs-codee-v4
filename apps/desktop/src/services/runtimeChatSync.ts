import type { RuntimeChatMessage } from "@dbzs/shared";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";

const STORAGE_KEY = "dbzs-runtime-chat-state";

interface RuntimeChatPersistedState {
  messages: RuntimeChatMessage[];
  isSending: boolean;
  error: string | null;
}

function readPersistedState(): RuntimeChatPersistedState | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as RuntimeChatPersistedState;
    if (!Array.isArray(parsed.messages)) {
      return null;
    }

    return {
      messages: parsed.messages,
      isSending: Boolean(parsed.isSending),
      error: typeof parsed.error === "string" ? parsed.error : null
    };
  } catch {
    return null;
  }
}

function writePersistedState(state: RuntimeChatPersistedState): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function statesEqual(left: RuntimeChatPersistedState, right: RuntimeChatPersistedState): boolean {
  return (
    left.isSending === right.isSending &&
    left.error === right.error &&
    JSON.stringify(left.messages) === JSON.stringify(right.messages)
  );
}

let syncInitialized = false;
let applyingRemoteState = false;

export function initRuntimeChatSync(): () => void {
  if (syncInitialized || typeof window === "undefined") {
    return () => undefined;
  }

  syncInitialized = true;

  const persisted = readPersistedState();
  if (persisted) {
    useRuntimeChatStore.setState(persisted);
  }

  const unsubscribe = useRuntimeChatStore.subscribe((state) => {
    if (applyingRemoteState) {
      return;
    }

    writePersistedState({
      messages: state.messages,
      isSending: state.isSending,
      error: state.error
    });
  });

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      const parsed = JSON.parse(event.newValue) as RuntimeChatPersistedState;
      if (!Array.isArray(parsed.messages)) {
        return;
      }

      const current = useRuntimeChatStore.getState();
      const nextState: RuntimeChatPersistedState = {
        messages: parsed.messages,
        isSending: Boolean(parsed.isSending),
        error: typeof parsed.error === "string" ? parsed.error : null
      };

      if (
        statesEqual(
          {
            messages: current.messages,
            isSending: current.isSending,
            error: current.error
          },
          nextState
        )
      ) {
        return;
      }

      applyingRemoteState = true;
      useRuntimeChatStore.setState(nextState);
      applyingRemoteState = false;
    } catch {
      // Ignore malformed cross-window payloads.
    }
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    unsubscribe();
    window.removeEventListener("storage", handleStorage);
    syncInitialized = false;
  };
}

export function resetRuntimeChatSyncForTests(): void {
  syncInitialized = false;
  applyingRemoteState = false;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}
