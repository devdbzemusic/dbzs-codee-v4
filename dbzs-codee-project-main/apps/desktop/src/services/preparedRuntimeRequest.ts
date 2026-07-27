/**
 * Post-fallback provider request binding: freeze exactly what will be sent.
 */

import type { ContextStage, RuntimeChatMessage } from "@dbzs/shared";
import { estimateTokensCharHeuristic } from "@/runtime/context/contextSpooler";
import type { ToolProtocolMode } from "@/runtime/agent/toolProtocolAdapter";

export type PreparedRuntimeToolDefinition = {
  name: string;
  description?: string;
};

export interface PreparedRuntimeRequest {
  runId: string;
  turnIndex: number;
  bindingDecisionId: string;
  workflowKind: string;
  phase: string;
  targetAgent: string;
  modelRole: string;
  toolProfile: string;
  modelId: string;
  modelName: string;
  slotId: string;
  providerId: string;
  protocolMode: ToolProtocolMode | "none";
  messages: readonly RuntimeChatMessage[];
  tools: readonly PreparedRuntimeToolDefinition[];
  contextVersion: number;
  contextStage: ContextStage | number;
  /** Message-only prompt token estimate (post-fallback). */
  promptTokens: number;
  /** Tool catalog / native definition tokens included in the send. */
  toolPayloadTokens: number;
  outputReserveTokens: number;
  safetyMarginTokens: number;
  promptHash: string;
  toolsHash: string;
  source: "post_fallback";
  preparedAt: string;
}

export interface PromptBindingDiagnostics {
  preFallbackPromptTokens: number;
  postFallbackPromptTokens: number;
  sentPromptTokens: number;
  preFallbackPromptHash: string;
  postFallbackPromptHash: string;
  sentPromptHash: string;
  messageCountBefore: number;
  messageCountAfter: number;
  messageCountSent: number;
}

export interface ProviderRequestDiagnostics {
  endpoint: string;
  provider: string;
  modelId: string;
  slotId: string;
  sentMessageCount: number;
  sentToolCount: number;
  sentPromptTokens: number;
  /** Tokens attributed to tool catalog / native tool JSON (exact send payload). */
  sentToolTokens: number;
  /** Message + tool tokens before output reserve. */
  totalEstimatedInputTokens: number;
  /** Prompt + tools + reserved completion tokens. */
  totalRequiredTokens: number;
  outputReserveTokens: number;
  promptHash: string;
  toolsHash: string;
  requestBodyBytes: number;
  toolBodyBytes: number;
  protocolMode?: "prompt" | "native";
  stream: boolean;
}

/** Stable FNV-1a 32-bit hex — binding checks only (not crypto). */
export function hashPromptText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function serializeMessagesForHash(messages: readonly RuntimeChatMessage[]): string {
  return messages
    .map((message) => `${message.role}:${message.content ?? ""}`)
    .join("\n---\n");
}

export function estimatePromptTokens(messages: readonly RuntimeChatMessage[]): number {
  return estimateTokensCharHeuristic(serializeMessagesForHash(messages));
}

export function freezePreparedRuntimeRequest(
  input: Omit<
    PreparedRuntimeRequest,
    "source" | "preparedAt" | "promptHash" | "toolsHash" | "promptTokens" | "toolPayloadTokens"
  > & {
    promptTokens?: number;
    toolPayloadTokens?: number;
    promptHash?: string;
    toolsHash?: string;
  }
): PreparedRuntimeRequest {
  const messages = Object.freeze(input.messages.map((message) => Object.freeze({ ...message })));
  const tools = Object.freeze(input.tools.map((tool) => Object.freeze({ ...tool })));
  const promptHash = input.promptHash ?? hashPromptText(serializeMessagesForHash(messages));
  const toolsHash =
    input.toolsHash ?? hashPromptText(tools.map((tool) => tool.name).sort().join(","));
  const promptTokens = input.promptTokens ?? estimatePromptTokens(messages);
  const toolPayloadTokens = Math.max(0, input.toolPayloadTokens ?? 0);
  return Object.freeze({
    runId: input.runId,
    turnIndex: input.turnIndex,
    bindingDecisionId: input.bindingDecisionId,
    workflowKind: input.workflowKind,
    phase: input.phase,
    targetAgent: input.targetAgent,
    modelRole: input.modelRole,
    toolProfile: input.toolProfile,
    modelId: input.modelId,
    modelName: input.modelName,
    slotId: input.slotId,
    providerId: input.providerId,
    protocolMode: input.protocolMode,
    messages,
    tools,
    contextVersion: input.contextVersion,
    contextStage: input.contextStage,
    promptTokens,
    toolPayloadTokens,
    outputReserveTokens: input.outputReserveTokens,
    safetyMarginTokens: input.safetyMarginTokens,
    promptHash,
    toolsHash,
    source: "post_fallback" as const,
    preparedAt: new Date().toISOString()
  });
}

export function assertPreparedRequestReady(
  prepared: PreparedRuntimeRequest,
  runtimeContextLimit: number
): { ok: true } | { ok: false; reason: string } {
  if (prepared.source !== "post_fallback") {
    return { ok: false, reason: "prepared_source_not_post_fallback" };
  }
  const totalInput = prepared.promptTokens + prepared.toolPayloadTokens;
  const maxAllowed = Math.max(0, runtimeContextLimit - prepared.outputReserveTokens);
  if (totalInput > maxAllowed) {
    return {
      ok: false,
      reason: `prompt_plus_tools_exceed_limit input=${totalInput} max=${maxAllowed} prompt=${prepared.promptTokens} tools=${prepared.toolPayloadTokens}`
    };
  }
  return { ok: true };
}

export function assertPromptBindingMatches(
  prepared: PreparedRuntimeRequest,
  binding: PromptBindingDiagnostics
): { ok: true } | { ok: false; reason: string } {
  if (binding.sentPromptHash !== binding.postFallbackPromptHash) {
    return { ok: false, reason: "sent_hash_ne_post_fallback_hash" };
  }
  if (binding.sentPromptTokens !== binding.postFallbackPromptTokens) {
    return { ok: false, reason: "sent_tokens_ne_post_fallback_tokens" };
  }
  if (binding.messageCountSent !== binding.messageCountAfter) {
    return { ok: false, reason: "sent_message_count_ne_after" };
  }
  if (binding.sentPromptHash !== prepared.promptHash) {
    return { ok: false, reason: "sent_hash_ne_prepared_hash" };
  }
  if (binding.sentPromptTokens !== prepared.promptTokens) {
    return { ok: false, reason: "sent_tokens_ne_prepared_tokens" };
  }
  return { ok: true };
}

export function buildPromptBindingDiagnostics(input: {
  preFallbackMessages: readonly RuntimeChatMessage[];
  postFallbackMessages: readonly RuntimeChatMessage[];
  sentMessages: readonly RuntimeChatMessage[];
  /** Prompt-mode catalogs live in messages but are attributed to tool tokens. */
  attributedToolTokens?: number;
}): PromptBindingDiagnostics {
  const preHash = hashPromptText(serializeMessagesForHash(input.preFallbackMessages));
  const postHash = hashPromptText(serializeMessagesForHash(input.postFallbackMessages));
  const sentHash = hashPromptText(serializeMessagesForHash(input.sentMessages));
  const attributedToolTokens = Math.max(0, input.attributedToolTokens ?? 0);
  const promptOnly = (messages: readonly RuntimeChatMessage[]) =>
    Math.max(0, estimatePromptTokens(messages) - attributedToolTokens);
  return {
    preFallbackPromptTokens: promptOnly(input.preFallbackMessages),
    postFallbackPromptTokens: promptOnly(input.postFallbackMessages),
    sentPromptTokens: promptOnly(input.sentMessages),
    preFallbackPromptHash: preHash,
    postFallbackPromptHash: postHash,
    sentPromptHash: sentHash,
    messageCountBefore: input.preFallbackMessages.length,
    messageCountAfter: input.postFallbackMessages.length,
    messageCountSent: input.sentMessages.length
  };
}
