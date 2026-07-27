import type { AssistantQuestion, ReviewArtifactSummary, RuntimeChatMessage } from "@dbzs/shared";

export interface PendingAssistantQuestion {
  actionId: string;
  messageId: string;
  question: AssistantQuestion;
  remediationReviews?: ReviewArtifactSummary[];
}

export function collectPendingAssistantQuestions(
  messages: RuntimeChatMessage[],
  workspaceId?: string
): PendingAssistantQuestion[] {
  const result: PendingAssistantQuestion[] = [];
  for (const message of messages) {
    for (const action of message.actions ?? []) {
      if (
        action.kind !== "answer_question" ||
        action.state !== "pending" ||
        (workspaceId && action.workspaceId !== workspaceId)
      ) {
        continue;
      }
      const payload = action.payload as
        | {
            question?: AssistantQuestion;
            remediationReviews?: ReviewArtifactSummary[];
          }
        | undefined;
      const question = payload?.question;
      if (question) {
        result.push({
          actionId: action.id,
          messageId: message.id,
          question,
          remediationReviews: payload?.remediationReviews
        });
      }
    }
  }
  return result;
}

export function approvalRiskClass(riskLevel: string): string {
  switch (riskLevel) {
    case "low":
      return "text-green-400 border-green-400/30 bg-green-400/10";
    case "high":
      return "text-red-400 border-red-400/30 bg-red-400/10";
    default:
      return "text-amber-400 border-amber-400/30 bg-amber-400/10";
  }
}
