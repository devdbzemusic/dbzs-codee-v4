import type {
  ModelTargetAgent,
  ReasoningTraceEvent,
  RuntimeChatAttachment,
  RuntimeChatMessage,
  RuntimeChatRun,
  RuntimeChatTurn,
  RuntimeRunOutcome,
  RuntimeStatus,
  WorkspaceFile
} from "@dbzs/shared";
import type { RuntimeChatState } from "@/stores/runtimeChatStore";
import type { RuntimeChatActivityRun } from "@/types/runtimeChatActivity";
import {
  createActivityRun,
  appendActivityStepDetail,
  upsertActivityStep
} from "@/services/runtimeChatActivityHelpers";
import {
  appendRunEvent,
  createChatRun,
  updateRunStatus
} from "@/services/runtimeChatRunHelpers";
import {
  buildFileContext,
  patchActivityRun,
  patchActivitySteps,
  refreshRuntimeStatus,
  sleep
} from "@/stores/runtimeChatStoreRuntimeHelpers";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";
import { createTraceEvent } from "@/services/ragClient";
import { startChatSession } from "@/services/runtimeChatObservability";
import {
  TimeoutManager,
  applySettingsTimeoutOverrides,
  selectTimeoutProfile
} from "@/services/timeoutConfig";
import { createPhaseTimeoutController } from "@/services/runtimePhaseTimeouts";
import { useSettingsStore } from "@/stores/settingsStore";

type Setter = (
  partial:
    | RuntimeChatState
    | Partial<RuntimeChatState>
    | ((state: RuntimeChatState) => RuntimeChatState | Partial<RuntimeChatState>)
) => void;

type Getter = () => RuntimeChatState;

function finalizeExecutionExitState(input: {
  set: Setter;
  get: Getter;
  activity: RuntimeChatActivityRun;
  errorMessage: string;
}) {
  const finishedRun = input.get().activeRun;
  input.set((state) => ({
    error: input.errorMessage,
    isSending: false,
    isStreaming: false,
    lastActivity: input.activity,
    currentActivity: null,
    activeRun: null,
    historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
  }));
}

async function probeBackendSlotsReachable(currentStatus: RuntimeStatus) {
  try {
    await runtimeSlotManager.getAllSlotsStatus();
    return true;
  } catch {
    return currentStatus.state === "running";
  }
}

export function createActiveRunUpdater(set: Setter) {
  return (updater: (run: RuntimeChatRun) => RuntimeChatRun) => {
    set((state) => ({
      activeRun: state.activeRun ? updater(state.activeRun) : null
    }));
  };
}

export function initializeSendRun(args: {
  set: Setter;
  get: Getter;
  trimmedContent: string;
  attachments?: RuntimeChatAttachment[];
  effectiveAgent: ModelTargetAgent;
  taskType: string;
  includeWorkspaceContext: boolean;
  workspaceRoot?: string | null;
  activeFile: WorkspaceFile | null;
  agentMode?: "auto" | "agent";
}) {
  const startedAt = Date.now();
  const activity = createActivityRun(args.trimmedContent, args.effectiveAgent);
  const sessionId = startChatSession(args.workspaceRoot ?? null, args.effectiveAgent, {
    id: `msg-${Date.now().toString(36)}-start`,
    role: "user",
    content: args.trimmedContent
  });
  const userMsgId = `msg-${Date.now().toString(36)}-user`;
  const initialRun = createChatRun(
    userMsgId,
    args.agentMode ?? "auto",
    useSettingsStore.getState().settings.defaultModelId ? "full" : "ask",
    args.includeWorkspaceContext,
    args.workspaceRoot ?? undefined,
    args.activeFile?.path
  );
  const safeTraceEvents: ReasoningTraceEvent[] = [
    createTraceEvent(initialRun.id, "intent_detected", "Auftrag erkannt", `Intent: ${args.taskType}`)
  ];
  const runAbortController = new AbortController();
  const userMessage: RuntimeChatMessage = {
    id: `msg-${Date.now().toString(36)}-user`,
    role: "user",
    content: args.trimmedContent,
    attachments: args.attachments?.length ? args.attachments : undefined
  };
  const nextMessages = [...args.get().messages, userMessage];

  args.set({
    messages: nextMessages,
    currentActivity: activity,
    isSending: true,
    error: null,
    activeRun: appendRunEvent(initialRun, "chat.accepted", "Nachricht angenommen")
  });

  return {
    startedAt,
    activity,
    sessionId,
    initialRun,
    safeTraceEvents,
    runAbortController,
    userMessage,
    nextMessages
  };
}

export function createTimeoutLifecycle(args: {
  set: Setter;
  get: Getter;
  taskType: string;
  activeFile: WorkspaceFile | null;
  workspaceRootPathLength: number;
  runAbortController: AbortController;
}) {
  const timeoutManager = new TimeoutManager(
    applySettingsTimeoutOverrides(
      selectTimeoutProfile(
        args.taskType,
        (buildFileContext(args.activeFile)?.content?.length ?? 0) + args.workspaceRootPathLength
      ),
      useSettingsStore.getState().settings
    )
  );

  const phaseTimeouts = createPhaseTimeoutController({
    isAborted: () => args.runAbortController.signal.aborted,
    hasFirstToken: () => Boolean(args.get().activeRun?.firstTokenAt),
    onTimeout: (_kind, message) => {
      if (args.runAbortController.signal.aborted) return;
      args.runAbortController.abort(new Error(message));
      args.set({
        isSending: false,
        isStreaming: false,
        error: message
      });
    }
  });

  const updateActiveRun = createActiveRunUpdater(args.set);
  const totalTimeout = setTimeout(() => {
    if (!args.runAbortController.signal.aborted) {
      args.runAbortController.abort(new Error("Gesamt-Timeout: Laufzeit überschritten"));
      updateActiveRun((run) =>
        appendRunEvent(
          {
            ...updateRunStatus(run, "timeout"),
            outcome: "generation_timeout" satisfies RuntimeRunOutcome
          },
          "chat.timeout",
          "Gesamt-Timeout"
        )
      );
      args.set({
        isSending: false,
        isStreaming: false,
        error: `Gesamtlaufzeit überschritten (${timeoutManager.getTotal() / 1_000 / 60}m). Bitte Anfrage vereinfachen.`
      });
    }
  }, timeoutManager.getTotal());

  return {
    timeoutManager,
    totalTimeout,
    updateActiveRun,
    resetFirstTokenTimeout: () => {
      phaseTimeouts.clearAll();
    },
    startFirstTokenTimeout: (timeoutMs: number) => {
      phaseTimeouts.startPreTokenWatchdogs({
        promptEvalTimeoutMs: Math.min(timeoutManager.getPromptEval(), timeoutMs),
        firstTokenTimeoutMs: timeoutMs
      });
    },
    onStreamTokenActivity: () => {
      phaseTimeouts.onFirstToken({
        streamIdleTimeoutMs: timeoutManager.getStreamIdle(),
        generationTimeoutMs: timeoutManager.getGeneration()
      });
    }
  };
}

export function createActivityController(
  set: Setter,
  initialActivity: RuntimeChatActivityRun
) {
  let activity = initialActivity;

  const updateActivity = (nextRun: RuntimeChatActivityRun) => {
    activity = nextRun;
    set({ currentActivity: nextRun });
  };

  return {
    getActivity: () => activity,
    updateActivity,
    beginStep: (id: string, label: string, detail = "") => {
      updateActivity(
        patchActivitySteps(activity, upsertActivityStep(activity.steps, id, label, "running", detail))
      );
    },
    finishStep: (id: string, label: string, detail = "") => {
      updateActivity(
        patchActivitySteps(activity, upsertActivityStep(activity.steps, id, label, "done", detail))
      );
    },
    failStep: (id: string, label: string, detail: string) => {
      updateActivity(
        patchActivitySteps(activity, upsertActivityStep(activity.steps, id, label, "error", detail))
      );
    },
    appendStepDetail: (id: string, line: string) => {
      updateActivity(patchActivitySteps(activity, appendActivityStepDetail(activity.steps, id, line)));
    },
    completeAsOfflineFailure: () => {
      updateActivity(
        patchActivityRun(activity, {
          finishedAt: new Date().toISOString(),
          summary: "Abgebrochen: Backend offline"
        })
      );
    }
  };
}

export function buildRunTurnSnapshot(
  runId: string,
  get: Getter,
  input: {
    turnNumber: number;
    prompt: string;
    response?: string | null;
    startedAt?: string;
    finishedAt?: string;
  }
): RuntimeChatTurn {
  const startedAt = input.startedAt ?? get().activeRun?.startedAt ?? new Date().toISOString();
  return {
    id: `turn-${runId}-${input.turnNumber}`,
    turnNumber: Math.max(1, input.turnNumber),
    prompt: input.prompt,
    response: input.response ?? undefined,
    startedAt,
    finishedAt: input.finishedAt ?? new Date().toISOString(),
    durationMs: Date.now() - new Date(startedAt).getTime()
  };
}

export async function ensureBackendReachable(
  runtimeStatus: RuntimeStatus | null
): Promise<{ backendReachable: boolean; currentStatus: RuntimeStatus }> {
  let currentStatus = await refreshRuntimeStatus(runtimeStatus);
  let backendReachable = await probeBackendSlotsReachable(currentStatus);

  if (!backendReachable) {
    await sleep(250);
    currentStatus = await refreshRuntimeStatus(currentStatus);
    backendReachable = await probeBackendSlotsReachable(currentStatus);
  }

  return { backendReachable, currentStatus };
}

export function finalizeOfflineBackendFailure(
  set: Setter,
  get: Getter,
  activity: RuntimeChatActivityRun,
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void
) {
  updateActiveRun((run) =>
    appendRunEvent(updateRunStatus(run, "failed"), "chat.failed", "Backend nicht erreichbar")
  );
  finalizeExecutionExitState({
    set,
    get,
    activity,
    errorMessage: "Backend nicht erreichbar. Starte zuerst das Backend."
  });
}
