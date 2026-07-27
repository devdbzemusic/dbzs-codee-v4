import type {
  RuntimeChatRun,
  RuntimeChatWorkspaceContext,
  WorkspaceFile,
  WorkspaceProjectFile
} from "@dbzs/shared";
import type { RuntimeChatState, RuntimeChatSendOptions } from "@/stores/runtimeChatStore";
import type { RuntimeChatActivityRun } from "@/types/runtimeChatActivity";
import { buildWorkspaceContext } from "@/services/runtimeChatContext";
import { captureContextProof } from "@/services/runtimeChatObservability";
import { patchActivityRun, withTimeout } from "@/stores/runtimeChatStoreRuntimeHelpers";
import { appendRunEvent, updateRunStatus } from "@/services/runtimeChatRunHelpers";

type Setter = (
  partial:
    | RuntimeChatState
    | Partial<RuntimeChatState>
    | ((state: RuntimeChatState) => RuntimeChatState | Partial<RuntimeChatState>)
) => void;

type Getter = () => RuntimeChatState;

interface ContextPhaseCallbacks {
  beginStep: (id: string, label: string, detail?: string) => void;
  finishStep: (id: string, label: string, detail?: string) => void;
  failStep: (id: string, label: string, detail: string) => void;
  appendStepDetail: (id: string, line: string) => void;
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
  updateActivity: (nextRun: RuntimeChatActivityRun) => void;
  getActivity: () => RuntimeChatActivityRun;
}

export interface ContextPhaseResult {
  handled: boolean;
  result: boolean;
  resolvedWorkspaceContext: RuntimeChatWorkspaceContext | null;
}

export async function loadWorkspaceContextPhaseAction(input: {
  set: Setter;
  get: Getter;
  sendOptions: RuntimeChatSendOptions | undefined;
  workspaceContext: RuntimeChatWorkspaceContext | null | undefined;
  activeFile: WorkspaceFile | null;
  isAutoTrivial: boolean;
  sessionId: string | null;
  trimmedContent: string;
  contextMentionPaths: string[];
  skillIds: string[];
  timeoutMs: number;
  signal: AbortSignal;
  callbacks: ContextPhaseCallbacks;
  resetFirstTokenTimeout: () => void;
  clearTotalTimeout: () => void;
}): Promise<ContextPhaseResult> {
  const {
    set,
    get,
    sendOptions,
    workspaceContext,
    activeFile,
    isAutoTrivial,
    sessionId,
    trimmedContent,
    contextMentionPaths,
    skillIds,
    timeoutMs,
    signal,
    callbacks,
    resetFirstTokenTimeout,
    clearTotalTimeout
  } = input;

  let resolvedWorkspaceContext = workspaceContext ?? null;

  if (sendOptions?.includeWorkspaceContext && sendOptions.workspaceRoot && !isAutoTrivial) {
    callbacks.beginStep("workspace-context", "Workspace-Kontext laden");
    try {
      const buildResult = await withTimeout(
        buildWorkspaceContext(
          sendOptions.workspaceRoot,
          sendOptions.workspaceName ?? null,
          sendOptions.workspaceFiles ?? ([] as WorkspaceProjectFile[]),
          activeFile,
          (event) => {
            if (event.type === "start") {
              callbacks.appendStepDetail(
                "workspace-context",
                `Workspace ${event.workspaceName}: ${event.candidateCount} Kandidaten, ${event.treeFileCount} Dateien im Baum`
              );
            }
            if (event.type === "reading") {
              callbacks.appendStepDetail("workspace-context", `Lese ${event.relativePath} ...`);
            }
            if (event.type === "loaded") {
              callbacks.appendStepDetail(
                "workspace-context",
                `✓ ${event.relativePath} (${event.language}, ${event.charCount} Zeichen)`
              );
            }
            if (event.type === "failed") {
              callbacks.appendStepDetail("workspace-context", `✗ ${event.relativePath} (Lesefehler)`);
            }
          }
        ),
        timeoutMs,
        "Workspace-Kontext",
        signal
      );
      resolvedWorkspaceContext = buildResult.context;

      if (sessionId && resolvedWorkspaceContext) {
        captureContextProof(sessionId, {
          workspaceRoot: sendOptions.workspaceRoot,
          workspaceName: sendOptions.workspaceName ?? null,
          activeFile: activeFile
            ? { path: activeFile.path, content: activeFile.content, language: activeFile.language }
            : null,
          sampledFiles: resolvedWorkspaceContext.sampledFiles,
          fileTree: resolvedWorkspaceContext.fileTree,
          contextMentions: contextMentionPaths,
          enabledSkillIds: skillIds,
          toolProfile: sendOptions?.toolProfile ?? get().toolProfile,
          indexedFileCount: sendOptions?.indexedFileCount ?? 0
        });
      }

      callbacks.finishStep(
        "workspace-context",
        "Workspace-Kontext laden",
        `${buildResult.sampledCount} Dateien geladen${buildResult.failedCount > 0 ? `, ${buildResult.failedCount} fehlgeschlagen` : ""}`
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Workspace-Kontext konnte nicht geladen werden";
      callbacks.failStep("workspace-context", "Workspace-Kontext laden", errMsg);
      callbacks.updateActiveRun((run) => appendRunEvent(updateRunStatus(run, "failed"), "chat.failed", errMsg));
      callbacks.updateActivity(
        patchActivityRun(callbacks.getActivity(), {
          finishedAt: new Date().toISOString(),
          summary: `Abgebrochen: ${errMsg}`
        })
      );
      const finishedRun = get().activeRun;
      resetFirstTokenTimeout();
      clearTotalTimeout();
      set((state) => ({
        error: errMsg,
        isSending: false,
        lastActivity: callbacks.getActivity(),
        currentActivity: null,
        activeRun: null,
        historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
      }));
      return { handled: true, result: false, resolvedWorkspaceContext };
    }
  } else if (resolvedWorkspaceContext) {
    callbacks.beginStep("workspace-context", "Workspace-Kontext");
    callbacks.finishStep(
      "workspace-context",
      "Workspace-Kontext",
      `${resolvedWorkspaceContext.sampledFiles.length} Dateien, ${resolvedWorkspaceContext.fileTree.length} im Baum`
    );
  } else {
    callbacks.beginStep("workspace-context", "Workspace-Kontext");
    callbacks.finishStep(
      "workspace-context",
      "Workspace-Kontext",
      isAutoTrivial ? "Triviale Nachricht — Fast Path aktiv" : "Nicht eingebunden"
    );
  }

  if (activeFile && !isAutoTrivial) {
    callbacks.beginStep("file-context", "Aktive Datei");
    callbacks.finishStep(
      "file-context",
      "Aktive Datei",
      `${activeFile.name} (${activeFile.language}, ${Math.min(activeFile.content.length, 16_000)} Zeichen)`
    );
  } else {
    callbacks.beginStep("file-context", "Aktive Datei");
    callbacks.finishStep(
      "file-context",
      "Aktive Datei",
      isAutoTrivial ? "Fast Path aktiv" : "Keine Datei im Editor aktiv"
    );
  }

  return { handled: false, result: false, resolvedWorkspaceContext };
}
