/*
 * DBZS – Division By Zeros
 * Datei: chatSessionTrace.ts
 * Bereich: Runtime Observability
 *
 * Zweck:
 *   Definiert Typen und Interfaces für die Nachverfolgung von Runtime-Chat-Sessions,
 *   Context-Proofs und Agent-Handoffs.
 *
 * Warum:
 *   Ohne detaillierte Traces ist nicht nachvollziehbar, welcher Kontext verwendet wurde,
 *   welche Agenten beteiligt waren und wie Entscheidungen zustande kamen.
 *
 * Wozu:
 *   Ermöglicht vollständige Audit-Logs für Debugging, Review und Compliance.
 *
 * Input:
 *   Chat-Nachrichten, Context-Daten, Agent-Routing-Entscheidungen, Tool-Aufrufe
 *
 * Output:
 *   Serialisierbare Trace-Objekte mit Zeitstempeln und Metadaten
 *
 * Eltern:
 *   runtimeChatStore, runtimeChatAgentRunner, orchestrationClient
 *
 * Kinder:
 *   observabilityService (Speicherung/Export)
 *
 * Hinweise:
 *   - Alle Zeitstempel ISO-8601
 *   - Keine Secrets speichern
 *   - Traces müssen serialisierbar sein (JSON)
 */

import type { ModelTargetAgent, RuntimeChatMessage, RuntimeChatToolCallRecord } from "@dbzs/shared";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import type { ToolName } from "@/runtime/tool/toolContracts";

/**
 * Ein Context-Proof dokumentiert, welche Kontextdaten zu einem bestimmten
 * Zeitpunkt in eine Chat-Anfrage eingeflossen sind.
 */
export interface ContextProof {
  /** Eindeutige ID des Proofs */
  id: string;
  /** Zeitpunkt der Erstellung */
  timestamp: string;
  /** Workspace-Root-Pfad */
  workspaceRoot: string | null;
  /** Name des Workspaces */
  workspaceName: string | null;
  /** Pfad der aktiven Datei (falls vorhanden) */
  activeFilePath: string | null;
  /** Inhalt der aktiven Datei (gekappt auf max. 2000 Zeichen) */
  activeFileContent: string | null;
  /** Liste der geladenen Kontext-Dateien mit Pfad und Länge */
  sampledFiles: Array<{
    relativePath: string;
    language: string;
    contentLength: number;
    contentHash: string;
  }>;
  /** Dateibaum des Workspaces (gekappt) */
  fileTree: string[];
  /** Erwähnte Context-Mentions aus der User-Nachricht */
  contextMentions: string[];
  /** Skill-IDs die aktiv waren */
  enabledSkillIds: string[];
  /** Tool-Profil das verwendet wurde */
  toolProfile?: AgentToolProfile;
  /** Indexierte Datei-Anzahl zum Zeitpunkt der Anfrage */
  indexedFileCount?: number;
}

/**
 * Ein Agent-Handoff-Log dokumentiert die Übergabe zwischen Agenten.
 */
export interface AgentHandoffLog {
  /** Eindeutige ID des Handoffs */
  id: string;
  /** Zeitpunkt */
  timestamp: string;
  /** Von welchem Agent */
  fromAgent: ModelTargetAgent | "user" | "system";
  /** Zu welchem Agent */
  toAgent: ModelTargetAgent;
  /** Grund für die Übergabe (Routing-Entscheidung) */
  reason: string;
  /** Eingehende Nachricht/Goal */
  inputSummary: string;
  /** Erwartetes Ergebnis */
  expectedOutput?: string;
  /** Tatsächliches Ergebnis (wenn abgeschlossen) */
  actualOutput?: string;
  /** Dauer in ms */
  durationMs?: number;
  /** Status */
  status: "pending" | "completed" | "failed" | "cancelled";
  /** Fehlermeldung falls fehlgeschlagen */
  error?: string;
}

/**
 * Ein Tool-Execution-Log dokumentiert einen einzelnen Tool-Aufruf.
 */
export interface ToolExecutionLog {
  /** Eindeutige ID */
  id: string;
  /** Zeitpunkt */
  timestamp: string;
  /** Name des Tools */
  toolName: ToolName | string;
  /** Input-Parameter (ohne Secrets) */
  input: Record<string, unknown>;
  /** Output-Ergebnis */
  output: unknown;
  /** Dauer in ms */
  durationMs: number;
  /** Status */
  status: "ok" | "error" | "cancelled";
  /** Fehlermeldung falls vorhanden */
  error?: string;
  /** Zugehörige Run-ID */
  runId: string;
  /** Zugehöriger Turn */
  turn?: number;
}

/**
 * Ein Chat-Session-Trace fasst eine komplette Session zusammen.
 */
export interface ChatSessionTrace {
  /** Eindeutige Session-ID */
  sessionId: string;
  /** Start-Zeitpunkt */
  startedAt: string;
  /** End-Zeitpunkt (wenn abgeschlossen) */
  finishedAt?: string;
  /** Workspace-Root */
  workspaceRoot: string | null;
  /** Liste aller Nachrichten */
  messages: RuntimeChatMessage[];
  /** Liste aller Context-Proofs */
  contextProofs: ContextProof[];
  /** Liste aller Agent-Handoffs */
  handoffLogs: AgentHandoffLog[];
  /** Liste aller Tool-Aufrufe */
  toolExecutionLogs: ToolExecutionLog[];
  /** Ziel-Agent der Session */
  targetAgent: ModelTargetAgent;
  /** Verwendetes Modell */
  modelId?: string | null;
  /** Modell-Name */
  modelName?: string | null;
  /** Provider-ID */
  providerId?: string | null;
  /** Status der Session */
  status: "active" | "completed" | "failed" | "cancelled";
  /** Fehlermeldung falls vorhanden */
  error?: string;
  /** Metadaten */
  metadata: {
    userPromptCount: number;
    assistantResponseCount: number;
    systemMessageCount: number;
    toolCallCount: number;
    totalCharacters: number;
  };
}

/**
 * Ein Observability-Event das an den Event-Bus gesendet werden kann.
 */
export type ObservabilityEvent =
  | { type: "chat_session_started"; trace: ChatSessionTrace }
  | { type: "chat_message_sent"; sessionId: string; message: RuntimeChatMessage }
  | { type: "context_proof_created"; sessionId: string; proof: ContextProof }
  | { type: "agent_handoff_initiated"; sessionId: string; handoff: AgentHandoffLog }
  | { type: "agent_handoff_completed"; sessionId: string; handoffId: string; output: string }
  | { type: "tool_execution_started"; sessionId: string; toolCall: ToolExecutionLog }
  | { type: "tool_execution_completed"; sessionId: string; toolCallId: string; output: unknown }
  | { type: "chat_session_finished"; trace: ChatSessionTrace };

/**
 * Erstellt eine eindeutige ID für Traces/Logs.
 */
export function createTraceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Erstellt einen Content-Hash für eine Datei (simuliert, da kein echter Hash im Browser).
 * Verwendet den DJB2-Algorithmus, um auch bei Unicode-Zeichen absturzsicher zu sein.
 */
export function createContentHash(content: string): string {
  let hash = 5381;
  const limit = Math.min(content.length, 1000);
  for (let i = 0; i < limit; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return `${content.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/**
 * Erstellt einen ContextProof aus den gegebenen Daten.
 */
export function createContextProof(input: {
  workspaceRoot: string | null;
  workspaceName: string | null;
  activeFile: { path: string; content: string; language: string } | null;
  sampledFiles: Array<{ relativePath: string; language: string; content: string }>;
  fileTree: string[];
  contextMentions: string[];
  enabledSkillIds: string[];
  toolProfile?: AgentToolProfile;
  indexedFileCount?: number;
}): ContextProof {
  return {
    id: createTraceId(),
    timestamp: new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    workspaceName: input.workspaceName,
    activeFilePath: input.activeFile?.path ?? null,
    activeFileContent: input.activeFile?.content.slice(0, 2000) ?? null,
    sampledFiles: input.sampledFiles.map((f) => ({
      relativePath: f.relativePath,
      language: f.language,
      contentLength: f.content.length,
      contentHash: createContentHash(f.content)
    })),
    fileTree: input.fileTree.slice(0, 80),
    contextMentions: input.contextMentions,
    enabledSkillIds: input.enabledSkillIds,
    toolProfile: input.toolProfile,
    indexedFileCount: input.indexedFileCount
  };
}

/**
 * Erstellt ein AgentHandoffLog.
 */
export function createAgentHandoffLog(input: {
  fromAgent: ModelTargetAgent | "user" | "system";
  toAgent: ModelTargetAgent;
  reason: string;
  inputSummary: string;
  expectedOutput?: string;
}): AgentHandoffLog {
  return {
    id: createTraceId(),
    timestamp: new Date().toISOString(),
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
    reason: input.reason,
    inputSummary: input.inputSummary,
    expectedOutput: input.expectedOutput,
    status: "pending"
  };
}

/**
 * Erstellt ein ToolExecutionLog.
 */
export function createToolExecutionLog(input: {
  toolName: ToolName | string;
  input: Record<string, unknown>;
  runId: string;
  turn?: number;
}): ToolExecutionLog {
  return {
    id: createTraceId(),
    timestamp: new Date().toISOString(),
    toolName: input.toolName,
    input: sanitizeInputForLogging(input.input),
    output: null as unknown,
    durationMs: 0,
    status: "ok",
    runId: input.runId,
    turn: input.turn
  };
}

/**
 * Bereinigt Input-Daten für Logs (entfernt potenzielle Secrets).
 */
function sanitizeInputForLogging(input: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = new Set(["api_key", "apiKey", "token", "secret", "password", "credential", "auth"]);
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(input)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 500) {
      result[key] = value.slice(0, 500) + `... (${value.length} chars total)`;
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Erstellt einen initialen ChatSessionTrace.
 */
export function createChatSessionTrace(input: {
  workspaceRoot: string | null;
  targetAgent: ModelTargetAgent;
  firstMessage: RuntimeChatMessage;
}): ChatSessionTrace {
  return {
    sessionId: createTraceId(),
    startedAt: new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    messages: [input.firstMessage],
    contextProofs: [],
    handoffLogs: [],
    toolExecutionLogs: [],
    targetAgent: input.targetAgent,
    status: "active",
    metadata: {
      userPromptCount: input.firstMessage.role === "user" ? 1 : 0,
      assistantResponseCount: input.firstMessage.role === "assistant" ? 1 : 0,
      systemMessageCount: input.firstMessage.role === "system" ? 1 : 0,
      toolCallCount: 0,
      totalCharacters: input.firstMessage.content.length
    }
  };
}

/**
 * Aktualisiert die Metadaten eines Traces.
 */
export function updateTraceMetadata(trace: ChatSessionTrace): void {
  trace.metadata.userPromptCount = trace.messages.filter((m) => m.role === "user").length;
  trace.metadata.assistantResponseCount = trace.messages.filter((m) => m.role === "assistant").length;
  trace.metadata.systemMessageCount = trace.messages.filter((m) => m.role === "system").length;
  trace.metadata.toolCallCount = trace.toolExecutionLogs.length;
  trace.metadata.totalCharacters = trace.messages.reduce((sum, m) => sum + m.content.length, 0);
}

/**
 * Finalisiert einen ChatSessionTrace.
 */
export function finalizeChatSessionTrace(
  trace: ChatSessionTrace,
  status: "completed" | "failed" | "cancelled",
  error?: string
): ChatSessionTrace {
  trace.finishedAt = new Date().toISOString();
  trace.status = status;
  if (error) {
    trace.error = error;
  }
  updateTraceMetadata(trace);
  return trace;
}
