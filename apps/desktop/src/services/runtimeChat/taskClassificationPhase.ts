import type { ModelTargetAgent, RuntimeTaskType } from "@dbzs/shared";
import { classifyTaskTypeDetailed, type IntentClassification } from "@/services/modelSelectionBroker";
import { resolveSkillTargetAgent } from "@/services/runtimeChatSkills";
import { isTrivialConversationMessage } from "@/services/runtimeChatAgentConfig";
import type { RuntimeChatSendOptions } from "@/stores/runtimeChatStore";

export interface TaskClassificationInput {
  trimmedContent: string;
  targetAgent: ModelTargetAgent;
  activeFileHasContent: boolean;
  contextHint?: string | null;
  sendOptions?: RuntimeChatSendOptions;
  enabledSkillIds: string[];
  jobContextHint: string | null;
  storeToolsEnabled: boolean;
}

export interface TaskClassificationResult {
  skillIds: string[];
  effectiveAgent: ModelTargetAgent;
  toolsEnabled: boolean;
  resolvedContextHint: string | null;
  isAutoTrivial: boolean;
  includeWorkspaceContext: boolean;
  intentClassification: IntentClassification;
  taskType: RuntimeTaskType;
}

/**
 * Resolves the effective agent/skill/task-type for a new chat turn, including
 * the "auto trivial" and "sticky task type" overrides. Pure — no store/IPC
 * access; `jobContextHint` must already have been consumed by the caller
 * since consuming it is itself a stateful side effect.
 */
export function classifyTaskForSend(input: TaskClassificationInput): TaskClassificationResult {
  const skillIds = input.sendOptions?.enabledSkillIds ?? input.enabledSkillIds;
  let effectiveAgent = resolveSkillTargetAgent(skillIds, input.targetAgent);
  const toolsEnabled = input.sendOptions?.toolsEnabled ?? input.storeToolsEnabled;
  const resolvedContextHint = input.sendOptions?.contextHint ?? input.contextHint ?? input.jobContextHint ?? null;
  const isAutoTrivial =
    input.sendOptions?.agentMode === "auto" && isTrivialConversationMessage(input.trimmedContent);
  const includeWorkspaceContext = input.sendOptions?.includeWorkspaceContext ?? true;

  const intentClassificationRaw = classifyTaskTypeDetailed(
    input.trimmedContent,
    effectiveAgent !== "runtime_chat",
    input.activeFileHasContent
  );
  let intentClassification = intentClassificationRaw;
  let taskType: RuntimeTaskType = intentClassification.taskType;

  if (isAutoTrivial) {
    taskType = "casual_chat";
    intentClassification = { ...intentClassification, taskType: "casual_chat" };
    effectiveAgent = "runtime_chat";
  }

  const sticky = input.sendOptions?.stickyTaskType;
  if (
    sticky &&
    sticky !== "casual_chat" &&
    sticky !== "normal_chat" &&
    (taskType === "casual_chat" || taskType === "normal_chat")
  ) {
    taskType = sticky;
    intentClassification = { ...intentClassification, taskType: sticky };
  }

  return {
    skillIds,
    effectiveAgent,
    toolsEnabled,
    resolvedContextHint,
    isAutoTrivial,
    includeWorkspaceContext,
    intentClassification,
    taskType
  };
}
