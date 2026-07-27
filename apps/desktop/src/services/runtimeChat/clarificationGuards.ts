import type { RuntimeChatMessage } from "@dbzs/shared";

/**
 * True when a pending/completed/approved "answer_question" action already
 * exists in the conversation for the given workspace + required field — used
 * to avoid re-asking the same clarification question twice.
 */
export function isClarificationFieldBlockedInMessages(
  messages: RuntimeChatMessage[],
  workspaceId: string,
  requiredField: string
): boolean {
  for (const message of messages) {
    for (const action of message.actions ?? []) {
      if (action.kind !== "answer_question") continue;
      if (action.workspaceId !== workspaceId) continue;
      if (action.state !== "pending" && action.state !== "completed" && action.state !== "approved") continue;
      const question = action.payload?.question as { requiredField?: string } | undefined;
      if (question?.requiredField === requiredField) {
        return true;
      }
    }
  }
  return false;
}
