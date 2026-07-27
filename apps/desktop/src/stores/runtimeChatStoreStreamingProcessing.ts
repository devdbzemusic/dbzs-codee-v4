import type {
  ContextManifest,
  ProposedChange,
  ReasoningTraceEvent,
  RetrievalManifest,
  RuntimeChatMessage,
  RuntimeChatResponse,
  RuntimeRunOutcome,
  RuntimeTaskType,
  SourceReference,
  WorkspaceFile
} from "@dbzs/shared";
import type { RuntimeChatWorkspaceContext } from "@dbzs/shared";
import type { RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";
import { AgentOutputParseError, looksLikeAgentChangePayload, parseAgentOutputToProposedChanges } from "@/services/agentOutputParser";
import { parseRuntimeToolCallsFromAssistant } from "@/services/runtimeChatToolParser";
import { buildRuntimeToolRequest } from "@/services/runtimeKernelService";
import { buildResponseAnalysisMessage } from "@/services/runtimeChatActivityHelpers";
import { createTraceEvent } from "@/services/ragClient";
import {
  collectEvidenceFromToolResult,
  type VerifiedWorkspaceEvidence,
  verifiedPathsList
} from "@/services/verifiedWorkspaceEvidence";
import { useEditorStore } from "@/stores/editorStore";
import { useRuntimeAgentStore } from "@/stores/runtimeAgentStore";
import { mergeAssistantMessageState, syncRuntimeAgentActions } from "@/stores/runtimeChatStoreMessageHelpers";

export interface StreamToolExecutionArtifact {
  name: string;
  status: "ok" | "error";
  summary: string;
  patchEffects: ProposedChange[];
}

export interface StreamingProcessingArtifacts {
  resultMessages: RuntimeChatMessage[];
  finalizedAssistantMessage: RuntimeChatMessage | null;
  assistantContent: string;
  patchDetected: boolean;
  patchCount: number;
  runtimeToolSummaries: string[];
  runtimeToolArtifacts: StreamToolExecutionArtifact[];
  streamToolNames: string[];
  relevanceOutcome?: RuntimeRunOutcome;
}

export async function processStreamingResponseArtifacts(input: {
  response: RuntimeChatResponse;
  currentMessages: RuntimeChatMessage[];
  workspaceRoot?: string | null;
  routing: RuntimeChatRoutingInfo;
  taskType: RuntimeTaskType;
  activeTaskPhase?: string | null;
  initialRunId: string;
  startedAt: number;
  requestMessages: RuntimeChatMessage[];
  systemMessages: RuntimeChatMessage[];
  resolvedWorkspaceContext: RuntimeChatWorkspaceContext | null | undefined;
  activeFile: WorkspaceFile | null;
  sendOptions: {
    showAnalysisProtocol?: boolean;
    workspaceRoot?: string | null;
  };
  ragManifest?: RetrievalManifest;
  ragSourceReferences?: SourceReference[];
  spoolerManifest?: ContextManifest | null;
  traceEvents: ReasoningTraceEvent[];
  verifiedEvidence: VerifiedWorkspaceEvidence;
  callbacks: {
    beginStep: (id: string, label: string, detail?: string) => void;
    finishStep: (id: string, label: string, detail?: string) => void;
    appendStepDetail: (id: string, line: string) => void;
    updateActiveRun: (updater: (run: any) => any) => void;
    setMessagesAndActions: (messages: RuntimeChatMessage[], finalized: RuntimeChatMessage | null) => void;
    applyPlanningRelevanceGate: (answer: string, toolResultCount: number) => Promise<{
      content: string;
      outcome?: RuntimeRunOutcome;
    }>;
  };
}): Promise<StreamingProcessingArtifacts> {
  const {
    response,
    currentMessages,
    workspaceRoot,
    routing,
    taskType,
    activeTaskPhase,
    initialRunId,
    startedAt,
    requestMessages,
    systemMessages,
    resolvedWorkspaceContext,
    activeFile,
    sendOptions,
    traceEvents,
    verifiedEvidence,
    callbacks
  } = input;

  callbacks.beginStep("response-structure", "Antwort strukturieren", "Direktiven und Artefakte werden extrahiert");

  const currentLastIndex = currentMessages.length - 1;
  const currentAssistantMessage =
    currentLastIndex >= 0 && currentMessages[currentLastIndex]?.role === "assistant"
      ? currentMessages[currentLastIndex]
      : null;
  const finalizedAssistantMessage = currentAssistantMessage
    ? mergeAssistantMessageState(
        currentAssistantMessage,
        {
          ...response.message,
          rawContent: response.message.rawContent ?? response.message.content,
          visibleContent: response.message.visibleContent ?? response.message.content
        },
        { workspaceRoot: workspaceRoot ?? undefined }
      )
    : null;

  const detectedToolCalls = workspaceRoot
    ? parseRuntimeToolCallsFromAssistant(response.message.content)
    : [];
  const patchPayloadLikely =
    Boolean(workspaceRoot) &&
    response.message.role === "assistant" &&
    looksLikeAgentChangePayload(response.message.content);

  callbacks.finishStep(
    "response-structure",
    "Antwort strukturieren",
    `Patch-Payload: ${patchPayloadLikely ? "ja" : "nein"} · Toolaufrufe: ${detectedToolCalls.length}`
  );

  let patchDetected = false;
  let patchCount = 0;
  if (patchPayloadLikely && workspaceRoot) {
    callbacks.beginStep("patch-analysis", "Patch-Artefakte ableiten");
    try {
      const proposedChanges = parseAgentOutputToProposedChanges(response.message.content, {
        agentId: "runtime-chat",
        workspaceRoot
      });
      patchCount = proposedChanges.length;
      patchDetected = patchCount > 0;
      if (patchDetected) {
        traceEvents.push(
          createTraceEvent(
            initialRunId,
            "patch_proposed",
            "Patch vorgeschlagen",
            `${patchCount} Dateiänderungen vorbereitet`
          )
        );
      }
      callbacks.updateActiveRun((run) => {
        const fileChanges = [...run.fileChanges];
        proposedChanges.forEach((change) => {
          if (!fileChanges.some((fileChange) => fileChange.id === change.id)) {
            const lines = change.proposedContent.split("\n");
            fileChanges.push({
              id: change.id,
              filePath: change.filePath,
              additions: lines.length,
              deletions: 0,
              diff: change.proposedContent,
              status: "proposed",
              timestamp: new Date().toISOString()
            });
          }
        });
        return { ...run, fileChanges };
      });
      await useEditorStore.getState().queueProposedChanges(proposedChanges);
      callbacks.finishStep(
        "patch-analysis",
        "Patch-Artefakte ableiten",
        `${patchCount} Patch-Vorschlag/Vorschlaege vorbereitet`
      );
    } catch (error) {
      if (error instanceof AgentOutputParseError) {
        callbacks.finishStep(
          "patch-analysis",
          "Patch-Artefakte ableiten",
          `Patch-JSON erkannt, aber nicht anwendbar: ${error.message}`
        );
      } else {
        throw error;
      }
    }
  } else {
    callbacks.finishStep(
      "patch-analysis",
      "Patch-Artefakte ableiten",
      "Kein direktes Patch-Payload erkannt"
    );
  }

  const runtimeToolSummaries: string[] = [];
  const runtimeToolArtifacts: StreamToolExecutionArtifact[] = [];
  const streamToolNames = detectedToolCalls.map((call) => call.name);
  if (detectedToolCalls.length > 0 && workspaceRoot) {
    callbacks.beginStep("runtime-tools", "Desktop-Tools", `${detectedToolCalls.length} Aufruf(e) geplant`);
    for (const call of detectedToolCalls) {
      try {
        traceEvents.push(
          createTraceEvent(initialRunId, "tool_started", `Tool: ${call.name}`, "Desktop-Tool gestartet", "running")
        );
        callbacks.appendStepDetail("runtime-tools", `${call.name} …`);
        const result = await useRuntimeAgentStore.getState().runTool(
          buildRuntimeToolRequest(call.name, workspaceRoot, call.input)
        );
        collectEvidenceFromToolResult(
          verifiedEvidence,
          call.name,
          result.output,
          workspaceRoot
        );

        const summary =
          `[Desktop Tool ${call.name}]\nStatus: ${result.status}\n${JSON.stringify(result.output, null, 2).slice(0, 3000)}`;
        runtimeToolSummaries.push(summary);
        traceEvents.push(
          createTraceEvent(
            initialRunId,
            "tool_completed",
            `Tool: ${call.name}`,
            `Status: ${result.status}`,
            result.status === "ok" ? "completed" : "failed"
          )
        );

        const patchEffects: ProposedChange[] = [];
        if (call.name === "apply_patch" && result.status === "ok" && result.output) {
          const output = result.output as {
            filePath?: string;
            afterContent?: string;
          };
          if (output.afterContent && output.filePath) {
            const queuedPatch: ProposedChange = {
              id: `tool-patch-${Date.now()}`,
              agentId: "runtime-chat",
              filePath: output.filePath,
              proposedContent: output.afterContent,
              reason: "Runtime tool apply_patch preview",
              createdAt: new Date().toISOString(),
              status: "pending"
            };
            await useEditorStore.getState().queueProposedChanges([queuedPatch]);
            patchEffects.push(queuedPatch);
            patchDetected = true;
            patchCount += 1;
          }
        }

        runtimeToolArtifacts.push({
          name: call.name,
          status: result.status === "ok" ? "ok" : "error",
          summary,
          patchEffects
        });
      } catch (error) {
        const summary = `[Desktop Tool ${call.name}] Fehler: ${error instanceof Error ? error.message : "unbekannt"}`;
        runtimeToolSummaries.push(summary);
        runtimeToolArtifacts.push({
          name: call.name,
          status: "error",
          summary,
          patchEffects: []
        });
        traceEvents.push(
          createTraceEvent(
            initialRunId,
            "tool_completed",
            `Tool: ${call.name}`,
            error instanceof Error ? error.message : "Tool fehlgeschlagen",
            "failed"
          )
        );
      }
    }
    callbacks.finishStep(
      "runtime-tools",
      "Desktop-Tools",
      `${detectedToolCalls.length} Aufruf(e) · ${runtimeToolArtifacts.filter((item) => item.status === "ok").length} erfolgreich`
    );
  }

  let assistantContent = response.message.content;
  let relevanceOutcome: RuntimeRunOutcome | undefined;
  const isPlanningLike =
    taskType === "planning" ||
    taskType === "architecture" ||
    activeTaskPhase === "planning";
  callbacks.beginStep("answer-verify", "Antwort verifizieren", "Antwort wird gegen Evidenz und Workflow geprüft");
  if (isPlanningLike && typeof assistantContent === "string") {
    const gated = await callbacks.applyPlanningRelevanceGate(
      assistantContent,
      runtimeToolSummaries.length + verifiedPathsList(verifiedEvidence).length
    );
    assistantContent = gated.content;
    relevanceOutcome = gated.outcome;
  }
  callbacks.finishStep(
    "answer-verify",
    "Antwort verifizieren",
    relevanceOutcome === "answer_relevance_failed"
      ? "Antwort wurde als thematisch nicht belastbar markiert"
      : `Antwort belastbar · Patches ${patchCount} · Tools ${runtimeToolArtifacts.length}`
  );

  const artifactSummaryMessage = [
    "[Stream-Artefakte]",
    `Patch-Vorschläge: ${patchCount}`,
    `Desktop-Tools: ${runtimeToolArtifacts.length}`,
    runtimeToolArtifacts.length > 0
      ? `Erfolgreich: ${runtimeToolArtifacts.filter((item) => item.status === "ok").length}`
      : null
  ]
    .filter(Boolean)
    .join("\n");

  const protocolMessage =
    sendOptions.showAnalysisProtocol === false
      ? null
      : buildResponseAnalysisMessage({
          routing,
          workspaceContext: resolvedWorkspaceContext,
          activeFile,
          historyMessageCount: requestMessages.length,
          systemContextCount: systemMessages.length,
          responseLength: assistantContent.length,
          modelId: response.model_id,
          modelName: response.model_name ?? routing.modelName,
          patchDetected,
          patchCount,
          durationMs: Date.now() - startedAt
        });

  const resultMessages: RuntimeChatMessage[] = [...currentMessages];
  if (finalizedAssistantMessage) {
    resultMessages[currentLastIndex] = finalizedAssistantMessage;
  }
  resultMessages.push({
    id: `msg-${Date.now().toString(36)}-stream-artifacts`,
    role: "system",
    content: artifactSummaryMessage
  });
  for (const summary of runtimeToolSummaries) {
    resultMessages.push({
      id: `msg-${Date.now().toString(36)}-tool-summary`,
      role: "system",
      content: summary
    });
  }
  if (protocolMessage) {
    resultMessages.push({
      id: `msg-${Date.now().toString(36)}-analysis`,
      role: "system",
      content: protocolMessage
    });
  }

  callbacks.setMessagesAndActions(resultMessages, finalizedAssistantMessage);

  return {
    resultMessages,
    finalizedAssistantMessage,
    assistantContent,
    patchDetected,
    patchCount,
    runtimeToolSummaries,
    runtimeToolArtifacts,
    streamToolNames,
    relevanceOutcome
  };
}
