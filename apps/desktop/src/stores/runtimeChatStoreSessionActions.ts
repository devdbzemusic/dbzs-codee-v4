import { workspaceScopeId } from "@dbzs/shared";
import type { ChatActionRequest } from "@dbzs/shared";
import type { RuntimeChatState } from "@/stores/runtimeChatStore";
import { clearPendingQuestion, readPendingQuestion } from "@/services/pendingQuestionPersistence";
import { answeredFieldIds, readActiveTaskContract } from "@/services/activeTaskContract";
import { createChatRun, appendRunEvent, updateRunStatus } from "@/services/runtimeChatRunHelpers";
import { listRuntimeToolNames } from "@/services/runtimeKernelService";
import { orchestrationClient } from "@/services/orchestrationClient";
import { bootstrapRuntimeLayer } from "@/services/runtimeBootstrap";
import { saveEnabledSkillIds } from "@/services/runtimeChatSkills";
import { setSkillEnabled } from "@/services/skillsLoader";
import { backendClient } from "@/services/backendClient";

type Setter = (
  partial:
    | RuntimeChatState
    | Partial<RuntimeChatState>
    | ((state: RuntimeChatState) => RuntimeChatState | Partial<RuntimeChatState>)
) => void;

type Getter = () => RuntimeChatState;

export async function checkForPendingQuestionAction(
  set: Setter,
  workspaceRoot: string
): Promise<void> {
  const pending = await readPendingQuestion(workspaceRoot);
  if (!pending) return;

  const contract = readActiveTaskContract(workspaceRoot);
  const requiredField = pending.question.requiredField;
  if (requiredField && answeredFieldIds(contract).has(requiredField)) {
    await clearPendingQuestion(workspaceRoot).catch(() => {});
    return;
  }

  const messageId = `msg-${Date.now().toString(36)}-rehydrated-ask`;
  const action: ChatActionRequest = {
    id: `act-${Math.random().toString(36).substring(2, 10)}`,
    runId: pending.runId,
    messageId,
    workspaceRoot: pending.workspaceRoot,
    workspaceId: workspaceScopeId(pending.workspaceRoot),
    kind: "answer_question",
    title: pending.question.prompt,
    description: pending.question.context,
    riskLevel: pending.question.riskLevel,
    payload: { question: pending.question, requestId: pending.toolCallRequestId },
    state: "pending",
    createdAt: pending.askedAt
  };

  const rehydratedRun = createChatRun(messageId, "agent", pending.profile, true, pending.workspaceRoot);
  const runWithStatus = updateRunStatus(
    appendRunEvent(rehydratedRun, "chat.question_asked", pending.question.prompt),
    "waiting_for_user_answer"
  );

  set((state) => ({
    messages: [
      ...state.messages,
      {
        id: messageId,
        role: "system",
        content: pending.question.prompt,
        actions: [action]
      }
    ],
    activeRun: { ...runWithStatus, id: pending.runId },
    rehydratedPendingQuestion: pending
  }));
}

export function handoffJobContextAction(
  set: Setter,
  input: {
    jobId: string;
    title: string;
    workspaceRoot: string;
    description?: string | null;
    artifactSummary?: string | null;
  }
): void {
  const hint = [
    "[Job Handoff]",
    `Job: ${input.title} (${input.jobId})`,
    `Workspace: ${input.workspaceRoot}`,
    input.description ? `Beschreibung: ${input.description}` : "",
    input.artifactSummary ? `Artefakte:\n${input.artifactSummary}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  set({ pendingJobContextHint: hint });
}

export function consumeJobContextHintAction(set: Setter, get: Getter): string | null {
  const hint = get().pendingJobContextHint;
  if (hint) {
    set({ pendingJobContextHint: null });
  }
  return hint;
}

export async function loadToolCatalogAction(set: Setter): Promise<void> {
  const fallbackDesktopTools = listRuntimeToolNames();
  try {
    await bootstrapRuntimeLayer();
    const catalog = await orchestrationClient.listTools();
    set({
      availableTools: catalog.tools.filter((tool: { enabled: boolean }) => tool.enabled),
      desktopToolNames: listRuntimeToolNames()
    });
  } catch {
    set((state) => ({
      availableTools: state.availableTools,
      desktopToolNames: fallbackDesktopTools
    }));
  }
}

export function toggleSkillAction(set: Setter, get: Getter, skillId: string): void {
  const current = get().enabledSkillIds;
  const next = current.includes(skillId)
    ? current.filter((id) => id !== skillId)
    : [...current, skillId];
  saveEnabledSkillIds(next);
  setSkillEnabled(skillId, next.includes(skillId));
  set({ enabledSkillIds: next });
}

export function setToolsEnabledAction(set: Setter, enabled: boolean, storageKey: string): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(storageKey, enabled ? "1" : "0");
  }
  set({ toolsEnabled: enabled });
}

export function cancelSendAction(
  set: Setter,
  get: Getter,
  runId: string | undefined,
  abortControllers: Record<string, AbortController>
): void {
  const targetRunId = runId ?? get().activeRun?.id;
  if (targetRunId && abortControllers[targetRunId]) {
    abortControllers[targetRunId].abort();
    delete abortControllers[targetRunId];
  }
  void backendClient.cancelRuntimeChatStream?.();
  const run = get().activeRun;
  if (run && (!runId || run.id === runId)) {
    const updated = updateRunStatus(appendRunEvent(run, "chat.cancelled", "Vorgang abgebrochen"), "cancelled");
    set((state) => ({
      activeRun: null,
      historicalRuns: { ...state.historicalRuns, [updated.id]: updated }
    }));
  }
  set({ isSending: false, isStreaming: false, currentActivity: null });
}
