import { workspaceScopeId } from "@dbzs/shared";
import type { ChatActionRequest, RuntimeChatMessage } from "@dbzs/shared";
import type { RuntimeChatSendOptions, RuntimeChatState } from "@/stores/runtimeChatStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { mapWorkflowScopeTextAlias } from "@/services/workflowContinuation";
import { directIntentClassifier } from "@/services/directIntentClassifier";
import { createMessageId } from "@/stores/runtimeChatStoreRuntimeHelpers";

type Setter = (
  partial:
    | RuntimeChatState
    | Partial<RuntimeChatState>
    | ((state: RuntimeChatState) => RuntimeChatState | Partial<RuntimeChatState>)
) => void;

type Getter = () => RuntimeChatState;

function findPendingWorkflowScopeAction(
  messages: RuntimeChatMessage[],
  workspaceId: string
): { messageId: string; action: ChatActionRequest } | null {
  for (const message of messages) {
    for (const action of message.actions ?? []) {
      if (action.kind !== "answer_question") continue;
      if (action.state !== "pending") continue;
      if (action.workspaceId !== workspaceId) continue;
      const question = action.payload?.question as { requiredField?: string } | undefined;
      if (question?.requiredField === "workflow_scope_decision") {
        return { messageId: message.id, action };
      }
    }
  }
  return null;
}

export async function handleSendPreflightAction(
  set: Setter,
  get: Getter,
  content: string,
  sendOptions: RuntimeChatSendOptions | undefined
): Promise<{ handled: boolean; result: boolean }> {
  const trimmedContent = content.trim();
  const workspaceRootEarly =
    sendOptions?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath ?? null;
  const workspaceIdEarly = workspaceRootEarly ? workspaceScopeId(workspaceRootEarly) : "";

  if (workspaceIdEarly) {
    const pendingScope = findPendingWorkflowScopeAction(get().messages, workspaceIdEarly);
    if (pendingScope) {
      const alias = mapWorkflowScopeTextAlias(trimmedContent);
      if (alias) {
        await get().submitAssistantAnswer(
          pendingScope.action.id,
          pendingScope.messageId,
          {
            questionId:
              (pendingScope.action.payload?.question as { id?: string } | undefined)?.id ??
              pendingScope.action.id,
            answeredAt: new Date().toISOString(),
            optionIds: [alias]
          },
          workspaceIdEarly
        );
        return { handled: true, result: true };
      }

      set((state) => ({
        messages: [
          ...state.messages,
          { id: createMessageId("user-scope-alias"), role: "user", content: trimmedContent },
          {
            id: createMessageId("system-scope-alias"),
            role: "system",
            content: "Bitte wähle eine der beiden Optionen."
          }
        ],
        error: null
      }));
      return { handled: true, result: false };
    }
  }

  const directIntent = directIntentClassifier(trimmedContent);
  if (!directIntent) {
    return { handled: false, result: false };
  }

  let workspaceFilesForIntent = useWorkspaceStore.getState().files;
  if (workspaceFilesForIntent.length === 0 && workspaceRootEarly) {
    await useWorkspaceStore.getState().scanFiles();
    workspaceFilesForIntent = useWorkspaceStore.getState().files;
  }

  const pattern = directIntent.pattern.replace(/\*/g, "").toLowerCase();
  const matches = workspaceFilesForIntent.filter((file) => {
    const lowerPath = file.relativePath.toLowerCase();
    if (directIntent.operation === "count_files" || directIntent.operation === "list_files") {
      return lowerPath.endsWith(pattern);
    }
    if (directIntent.operation === "search_files") {
      return lowerPath.includes(pattern);
    }
    return false;
  });

  let responseText = `Keine Dateien passend zu \`${directIntent.pattern}\` im Workspace gefunden.`;
  if (directIntent.operation === "count_files") {
    responseText = `${matches.length} Datei${matches.length === 1 ? "" : "en"} passend zu \`${directIntent.pattern}\` im Workspace gefunden.`;
  } else if (directIntent.operation === "search_files" && matches.length > 0) {
    responseText = `Ich habe ${matches.length} Datei(en) gefunden, die auf \`${directIntent.pattern}\` passen:\n\n- ${matches.map((file) => file.relativePath).join("\n- ")}`;
  } else if (directIntent.operation === "list_files" && matches.length > 0) {
    responseText = `Hier sind die ${matches.length} gefundenen Dateien für \`${directIntent.pattern}\`:\n\n- ${matches.map((file) => file.relativePath).join("\n- ")}`;
  }

  set((state) => ({
    messages: [
      ...state.messages,
      { id: createMessageId("user"), role: "user", content: trimmedContent },
      { id: createMessageId("assistant"), role: "assistant", content: responseText }
    ],
    error: null
  }));
  return { handled: true, result: true };
}
