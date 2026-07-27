import type {
  AgentAction,
  AgentPlanProposal,
  AgentReasoningSummary,
  RuntimeChatMessage,
  RuntimeChatToolCallRecord
} from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import { parseAssistantPayload } from "@/services/assistantPayloadParser";
import { buildRuntimeAgentActionRegistry } from "@/services/runtimeAgentActions";

export const REASONING_SYSTEM_HINT = `
Du musst jede finale Antwort oder Aktion mit einer strukturierten Begründung und Ablaufzusammenfassung in folgendem XML-Format beginnen:
<reasoning-summary>
{
  "title": "Kurzer, prägnanter Titel der Aktion oder Strategie",
  "summary": "1 bis 3 Sätze Zusammenfassung, warum dieser Weg gewählt wird",
  "steps": ["Schritt 1", "Schritt 2"],
  "assumptions": ["Optionale Annahme 1"],
  "risks": ["Optionales Risiko 1"],
  "nextAction": "Optionale nächste geplante Aktion oder Tool-Name"
}
</reasoning-summary>

Wenn ein ausführbarer Plan erforderlich ist, muss zusätzlich ein separater <plan>-Block erzeugt werden:
<plan>
{
  "type": "agent_plan_proposal",
  "version": 1,
  "id": "plan-123",
  "runId": "run-123",
  "title": "Geplanter Ablauf",
  "summary": "Kurze Zusammenfassung",
  "steps": [
    {
      "id": "step-1",
      "title": "Dateien analysieren",
      "description": "Relevante Dateien prüfen.",
      "riskLevel": "low"
    }
  ],
  "createdAt": "2026-07-02T00:00:00.000Z",
  "state": "proposed"
}
</plan>

WICHTIG:
- Reasoning Summary ist kein Plan.
- Planinformationen dürfen nicht in reasoning-summary.steps versteckt werden.
- Wenn ein ausführbarer Plan erforderlich ist, muss zusätzlich ein separater <plan>-Block erzeugt werden.
- Ein Coding-Auftrag darf nicht nur mit reasoning-summary enden.
- Wenn direkte Dateiänderungen erforderlich sind, muss zusätzlich propose_file_changes verwendet werden.
- Gib keinen unvollständigen oder provisorischen Plan frei.
- Erzeuge niemals Roh-CoT, private Tokens oder Secrets im XML-Block.

Beispiele:
- Gut: reasoning-summary + separater plan-Block bei komplexen oder mehrstufigen Aufgaben.
- Gut: nur reasoning-summary bei trivialen Antworten ohne zusätzlichen Plan.
- Schlecht: Planinformationen als JSON in reasoning-summary.steps.
- Schlecht: nur allgemeine Planbeschreibung ohne gültigen <plan>-Block bei einem echten Coding- oder Ausführungsplan.
`;

export function extractReasoningSummary(content: string): {
  reasoningSummary: AgentReasoningSummary | undefined;
  planProposal: AgentPlanProposal | undefined;
  cleanContent: string;
} {
  const payload = parseAssistantPayload(content);
  return {
    reasoningSummary: undefined,
    planProposal: payload.planProposal,
    cleanContent: payload.visibleText
  };
}

export function mergeAssistantMessageState(
  existingMessage: RuntimeChatMessage,
  incomingMessage: Partial<RuntimeChatMessage> & Pick<RuntimeChatMessage, "content"> & { planProposal?: AgentPlanProposal },
  options?: { allowActionCreation?: boolean; structuredParse?: "final" | "none"; workspaceRoot?: string }
): RuntimeChatMessage {
  const shouldParseStructured = options?.structuredParse !== "none";
  const incomingRawContent = incomingMessage.rawContent ?? incomingMessage.content ?? existingMessage.rawContent ?? existingMessage.content;
  const incomingVisibleContent = incomingMessage.visibleContent ?? incomingMessage.content ?? existingMessage.visibleContent ?? existingMessage.content;
  const payload = shouldParseStructured
    ? parseAssistantPayload(incomingRawContent)
    : {
        visibleText: incomingVisibleContent || incomingRawContent || existingMessage.visibleContent || existingMessage.content,
        reasoningSummary: undefined,
        planProposal: undefined,
        parseState: "none" as const,
        toolCalls: [],
        warnings: []
      };
  const mergedContent = shouldParseStructured
    ? payload.visibleText || incomingVisibleContent || incomingRawContent || existingMessage.content
    : incomingVisibleContent || incomingRawContent || existingMessage.visibleContent || existingMessage.content;
  const mergedRawContent = incomingRawContent ?? existingMessage.rawContent ?? mergedContent;
  const mergedVisibleContent = shouldParseStructured
    ? incomingVisibleContent || payload.visibleText || existingMessage.visibleContent || mergedContent
    : incomingVisibleContent || incomingRawContent || existingMessage.visibleContent || mergedContent;
  const toolCalls: RuntimeChatToolCallRecord[] | undefined =
    incomingMessage.toolCalls ?? existingMessage.toolCalls ??
    (shouldParseStructured
      ? payload.toolCalls.map((call, index) => ({
          id: `parsed-${index + 1}`,
          name: call.name,
          status: "done",
          input: call.arguments,
          outputSummary: undefined
        }))
      : undefined);

  const planActions = incomingMessage.actions ?? existingMessage.actions ?? [];
  const incomingPlanProposal = incomingMessage.planProposal ?? (incomingMessage as RuntimeChatMessage).planProposal;
  const resolvedPlanProposal = shouldParseStructured ? (payload.planProposal ?? incomingPlanProposal) : incomingPlanProposal;
  const planIsValid = (shouldParseStructured && payload.parseState === "valid") || Boolean(
    resolvedPlanProposal &&
    resolvedPlanProposal.type === "agent_plan_proposal" &&
    resolvedPlanProposal.version === 1 &&
    Boolean(resolvedPlanProposal.id)
  );
  const shouldCreatePlanActions = Boolean(
    shouldParseStructured &&
    options?.allowActionCreation !== false &&
    Boolean(options?.workspaceRoot) &&
    planIsValid &&
    resolvedPlanProposal &&
    resolvedPlanProposal.id &&
    resolvedPlanProposal.type === "agent_plan_proposal" &&
    resolvedPlanProposal.version === 1
  );
  const planProposalId = incomingMessage.planProposalId ?? existingMessage.planProposalId ?? resolvedPlanProposal?.id ?? (shouldParseStructured && payload.planProposal ? payload.planProposal.id : undefined);
  const actionWorkspaceRoot = options?.workspaceRoot ?? "";
  const actionWorkspaceId = actionWorkspaceRoot ? workspaceScopeId(actionWorkspaceRoot) : "";

  const nextActions = shouldCreatePlanActions && planProposalId && (!planActions.some((action) => action.kind === "approve_plan" || action.kind === "reject_plan"))
    ? [
        {
          id: `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`,
          runId: resolvedPlanProposal?.runId ?? "",
          messageId: incomingMessage.id ?? existingMessage.id,
          workspaceRoot: actionWorkspaceRoot,
          workspaceId: actionWorkspaceId,
          kind: "approve_plan" as const,
          title: "Plan übernehmen",
          description: "Fortfahren mit diesem Plan",
          riskLevel: "medium" as const,
          payload: { planProposalId },
          state: "pending" as const,
          createdAt: new Date().toISOString()
        },
        {
          id: `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`,
          runId: resolvedPlanProposal?.runId ?? "",
          messageId: incomingMessage.id ?? existingMessage.id,
          workspaceRoot: actionWorkspaceRoot,
          workspaceId: actionWorkspaceId,
          kind: "reject_plan" as const,
          title: "Ablehnen",
          description: "Plan abbrechen",
          riskLevel: "low" as const,
          payload: { planProposalId },
          state: "pending" as const,
          createdAt: new Date().toISOString()
        }
      ]
    : planActions;

  return {
    ...existingMessage,
    ...incomingMessage,
    content: mergedContent,
    rawContent: mergedRawContent,
    visibleContent: mergedVisibleContent,
    reasoningSummary: incomingMessage.reasoningSummary ?? existingMessage.reasoningSummary ?? (shouldParseStructured ? payload.reasoningSummary : undefined),
    toolCalls,
    actions: nextActions,
    planProposal: resolvedPlanProposal,
    planProposalId,
    patchProposalId: incomingMessage.patchProposalId ?? existingMessage.patchProposalId,
    patchPreviewId: incomingMessage.patchPreviewId ?? existingMessage.patchPreviewId,
    meta: incomingMessage.meta ?? existingMessage.meta
  };
}

export function mergeStreamingAssistantMessage({
  message,
  content,
  rawContent,
  reasoningSummary,
  planProposal,
  toolCalls
}: {
  message: RuntimeChatMessage;
  content: string;
  rawContent?: string;
  reasoningSummary?: AgentReasoningSummary;
  planProposal?: AgentPlanProposal;
  toolCalls?: RuntimeChatToolCallRecord[];
}): RuntimeChatMessage {
  const streamingContent = rawContent ?? content;
  return mergeAssistantMessageState(message, {
    id: message.id,
    role: message.role,
    content: streamingContent,
    rawContent,
    visibleContent: streamingContent,
    reasoningSummary,
    planProposal,
    toolCalls,
    planProposalId: planProposal?.id
  }, { allowActionCreation: false, structuredParse: "none" });
}

export function hasPendingPlanApproval(message: RuntimeChatMessage): boolean {
  if (message.planProposalId && (message.actionIds?.length ?? 0) > 0) {
    return true;
  }
  return Boolean(message.actions?.some((action) => action.kind === "approve_plan" && action.state === "pending"));
}

export function syncRuntimeAgentActions(
  messages: RuntimeChatMessage[],
  planProposalsById: Record<string, AgentPlanProposal>
) : { messages: RuntimeChatMessage[]; agentActionsById: Record<string, AgentAction> } {
  return buildRuntimeAgentActionRegistry(messages, { planProposalsById });
}
