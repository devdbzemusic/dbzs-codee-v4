import type {
  JobEnqueueRequest,
  RuntimeChatWorkspaceContext,
  WorkspaceFile
} from "@dbzs/shared";
import { looksLikeAgentChangePayload, parseAgentOutputToProposedChanges } from "@/services/agentOutputParser";
import { backendClient } from "@/services/backendClient";

export function buildAgentImplementationPrompt(proposal: string): string {
  const cleanProposal = proposal.trim();
  return [
    "[Agent Build Mode]",
    "Setze den folgenden Vorschlag jetzt praktisch um.",
    "Erwarte konkreten Umsetzungsoutput: betroffene Dateien, Schrittfolge, Patch-Entwurf und Testschritte.",
    "Wenn etwas unklar ist, triff eine sinnvolle Annahme und markiere sie explizit.",
    "",
    "Vorschlag:",
    cleanProposal
  ].join("\n");
}

export function buildJobTakeoverRequest(
  proposal: string,
  workspaceContext: RuntimeChatWorkspaceContext | null,
  activeFile: WorkspaceFile | null
): JobEnqueueRequest {
  const cleanProposal = proposal.trim();
  const titleSource = cleanProposal.split(/\r?\n/, 1)[0].trim() || "Vorschlag";
  return {
    title: `Uebernehmen: ${titleSource.slice(0, 120)}`,
    task_type: "implementation",
    priority: 2,
    assigned_agent_role: "coder",
    input_payload: {
      source: "assistant_takeover",
      proposal: cleanProposal,
      proposal_prompt: buildAgentImplementationPrompt(cleanProposal),
      workspace_context: workspaceContext,
      active_file: activeFile
        ? {
            path: activeFile.path,
            name: activeFile.name,
            language: activeFile.language,
            content: activeFile.content.slice(0, 16_000)
          }
        : null
    },
    max_attempts: 3
  };
}

export async function executeAssistantTakeover(options: {
  proposal: string;
  workspaceRoot: string;
  workspaceContext: RuntimeChatWorkspaceContext | null;
  activeFile: WorkspaceFile | null;
  queueProposedChanges: (changes: ReturnType<typeof parseAgentOutputToProposedChanges>) => Promise<void>;
}): Promise<string> {
  if (looksLikeAgentChangePayload(options.proposal)) {
    const parsed = parseAgentOutputToProposedChanges(options.proposal, {
      agentId: "runtime-chat",
      workspaceRoot: options.workspaceRoot
    });
    await options.queueProposedChanges(parsed);
    return `${parsed.length} Patch-Vorschlag/Vorschlaege vorbereitet.`;
  }

  const job = await backendClient.enqueueJob(
    buildJobTakeoverRequest(options.proposal, options.workspaceContext, options.activeFile)
  );
  return `Job eingereiht: ${job.title}`;
}
