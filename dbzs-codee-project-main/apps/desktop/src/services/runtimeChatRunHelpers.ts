import type {
  RuntimeChatRun,
  RuntimeChatRunStatus,
  RuntimeChatEvent,
  RuntimeChatEventType,
  RuntimeChatTurn,
  RuntimeChatToolCall,
  RuntimeChatFileChange,
  RuntimeChatCommand,
  RuntimeChatError
} from "@dbzs/shared";

export function createChatRun(
  userMessageId: string,
  mode: "auto" | "agent",
  profile: "ask" | "agent" | "full",
  contextEnabled: boolean,
  workspaceRoot?: string,
  activeFile?: string
): RuntimeChatRun {
  const timestamp = new Date().toISOString();
  return {
    id: `run-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
    userMessageId,
    status: "preparing",
    startedAt: timestamp,
    mode,
    profile,
    contextEnabled,
    workspaceRoot,
    activeFile,
    events: [],
    turns: [],
    toolCalls: [],
    fileChanges: [],
    commands: []
  };
}

export function appendRunEvent(
  run: RuntimeChatRun,
  type: RuntimeChatEventType,
  message?: string,
  meta?: Record<string, unknown>
): RuntimeChatRun {
  const timestamp = new Date().toISOString();
  const newEvent: RuntimeChatEvent = {
    id: `ev-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
    type,
    timestamp,
    message,
    meta
  };

  // Duration calculation for the preceding matched event or start
  if (run.events.length > 0) {
    const lastEvent = run.events[run.events.length - 1];
    const durationMs = Date.now() - new Date(lastEvent.timestamp).getTime();
    newEvent.durationMs = durationMs;
  } else {
    newEvent.durationMs = Date.now() - new Date(run.startedAt).getTime();
  }

  return {
    ...run,
    events: [...run.events, newEvent]
  };
}

export function updateRunStatus(run: RuntimeChatRun, status: RuntimeChatRunStatus): RuntimeChatRun {
  const patch: Partial<RuntimeChatRun> = { status };
  if (status === "completed" || status === "cancelled" || status === "timeout" || status === "failed") {
    patch.finishedAt = new Date().toISOString();
  }
  return { ...run, ...patch };
}

export function upsertRunTurn(
  run: RuntimeChatRun,
  turn: RuntimeChatTurn,
): RuntimeChatRun {
  const turns = [...run.turns];
  const existingIndex = turns.findIndex(
    (candidate) => candidate.id === turn.id || candidate.turnNumber === turn.turnNumber
  );
  if (existingIndex >= 0) {
    turns[existingIndex] = {
      ...turns[existingIndex],
      ...turn
    };
  } else {
    turns.push(turn);
  }

  return {
    ...run,
    turns
  };
}
