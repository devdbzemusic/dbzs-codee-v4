/*
 * DBZS – Division By Zeros
 * Datei: runtimeChatObservability.ts
 * Bereich: Runtime Chat Services
 *
 * Zweck:
 *   Integriert Observability in den Runtime-Chat-Store.
 *   Erfasst Context-Proofs, Agent-Handoffs und Tool-Ausführungen.
 *
 * Warum:
 *   Der Store benötigt eine zentrale Schnittstelle zur Observability.
 *
 * Wozu:
 *   Nachweis von Kontext, Agenten-Routing und Tool-Einsatz.
 */

import type { ModelTargetAgent, RuntimeChatMessage, RuntimeChatWorkspaceContext, WorkspaceFile } from "@dbzs/shared";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import {
  createChatSessionTrace,
  createContextProof,
  createAgentHandoffLog,
  createToolExecutionLog,
  finalizeChatSessionTrace,
  updateTraceMetadata,
  type ChatSessionTrace,
  type ContextProof,
  type AgentHandoffLog,
  type ToolExecutionLog
} from "@/runtime/observability/chatSessionTrace";
import { observabilityService } from "@/runtime/observability/observabilityService";
import { parseContextMentions } from "@/services/runtimeChatContextMentions";

interface ObservabilitySession {
  trace: ChatSessionTrace;
  contextProofCreated: boolean;
}

const activeSessions = new Map<string, ObservabilitySession>();

/**
 * Initialisiert die Observability für Runtime-Chat.
 */
export async function initializeRuntimeChatObservability(): Promise<void> {
  await observabilityService.initialize();
  console.log("[RuntimeChatObservability] Initialisiert");
}

/**
 * Startet eine neue Chat-Session mit Observability-Tracking.
 */
export function startChatSession(
  workspaceRoot: string | null,
  targetAgent: ModelTargetAgent,
  firstMessage: RuntimeChatMessage
): string {
  const trace = createChatSessionTrace({ workspaceRoot, targetAgent, firstMessage });
  activeSessions.set(trace.sessionId, { trace, contextProofCreated: false });

  observabilityService.handleEvent({ type: "chat_session_started", trace });

  return trace.sessionId;
}

/**
 * Erstellt einen Context-Proof für die aktuelle Session.
 */
export function captureContextProof(
  sessionId: string,
  input: {
    workspaceRoot: string | null;
    workspaceName: string | null;
    activeFile: { path: string; content: string; language: string } | null;
    sampledFiles: Array<{ relativePath: string; language: string; content: string }>;
    fileTree: string[];
    contextMentions: string[];
    enabledSkillIds: string[];
    toolProfile?: AgentToolProfile;
    indexedFileCount?: number;
  }
): ContextProof | null {
  const session = activeSessions.get(sessionId);
  if (!session || session.contextProofCreated) {
    return null;
  }

  const proof = createContextProof(input);
  session.trace.contextProofs.push(proof);
  session.contextProofCreated = true;

  observabilityService.handleEvent({ type: "context_proof_created", sessionId, proof });

  return proof;
}

/**
 * Erfasst einen Agent-Handoff.
 */
export function captureAgentHandoff(
  sessionId: string,
  input: {
    fromAgent: ModelTargetAgent | "user" | "system";
    toAgent: ModelTargetAgent;
    reason: string;
    inputSummary: string;
    expectedOutput?: string;
  }
): AgentHandoffLog | null {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return null;
  }

  const handoff = createAgentHandoffLog(input);
  session.trace.handoffLogs.push(handoff);

  observabilityService.handleEvent({ type: "agent_handoff_initiated", sessionId, handoff });

  return handoff;
}

/**
 * Schließt einen Agent-Handoff ab.
 */
export function completeAgentHandoff(
  sessionId: string,
  handoffId: string,
  output: string
): void {
  observabilityService.handleEvent({
    type: "agent_handoff_completed",
    sessionId,
    handoffId,
    output
  });

  const session = activeSessions.get(sessionId);
  if (session) {
    const handoff = session.trace.handoffLogs.find((h) => h.id === handoffId);
    if (handoff) {
      handoff.status = "completed";
      handoff.actualOutput = output;
      handoff.durationMs = Date.now() - new Date(handoff.timestamp).getTime();
    }
  }
}

/**
 * Erfasst einen Tool-Aufruf.
 */
export function captureToolExecutionStart(
  sessionId: string,
  input: {
    toolName: string;
    input: Record<string, unknown>;
    turn?: number;
  }
): ToolExecutionLog | null {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return null;
  }

  const toolLog = createToolExecutionLog({
    toolName: input.toolName,
    input: input.input,
    runId: sessionId,
    turn: input.turn
  });

  session.trace.toolExecutionLogs.push(toolLog);

  observabilityService.handleEvent({
    type: "tool_execution_started",
    sessionId,
    toolCall: toolLog
  });

  return toolLog;
}

/**
 * Schließt einen Tool-Aufruf ab.
 */
export function completeToolExecution(
  sessionId: string,
  toolCallId: string,
  output: unknown,
  status: "ok" | "error" | "cancelled",
  error?: string
): void {
  observabilityService.handleEvent({
    type: "tool_execution_completed",
    sessionId,
    toolCallId,
    output
  });

  const session = activeSessions.get(sessionId);
  if (session) {
    const toolLog = session.trace.toolExecutionLogs.find((t) => t.id === toolCallId);
    if (toolLog) {
      toolLog.output = output;
      toolLog.durationMs = Date.now() - new Date(toolLog.timestamp).getTime();
      toolLog.status = status;
      if (error) {
        toolLog.error = error;
      }
    }
  }
}

/**
 * Fügt eine Nachricht zum Trace hinzu.
 */
export function addMessageToTrace(sessionId: string, message: RuntimeChatMessage): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.trace.messages.push(message);
    updateTraceMetadata(session.trace);
  }
}

/**
 * Beendet eine Chat-Session.
 */
export function finishChatSession(
  sessionId: string,
  status: "completed" | "failed" | "cancelled",
  error?: string
): void {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return;
  }

  finalizeChatSessionTrace(session.trace, status, error);
  observabilityService.handleEvent({ type: "chat_session_finished", trace: session.trace });
  activeSessions.delete(sessionId);
}

/**
 * Ruft den aktuellen Trace ab.
 */
export function getTrace(sessionId: string): ChatSessionTrace | undefined {
  return activeSessions.get(sessionId)?.trace;
}

/**
 * Extrahiert Context-Mentions aus einer Nachricht und erstellt Proof-Daten.
 */
export function extractContextMentionsFromMessage(content: string): string[] {
  return parseContextMentions(content).map(m => m.path);
}


