/**
 * Estimate the tool payload that the agent loop will actually attach to the provider request.
 * Must stay in sync with runtimeChatAgentRunner + toolProtocolAdapter.
 */

import type { RuntimeChatMessage } from "@dbzs/shared";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import {
  buildToolSystemMessages,
  getNativeToolDefinitions,
  resolveToolProtocolMode,
  type ToolProtocolMode
} from "@/runtime/agent/toolProtocolAdapter";
import { listExposedToolNames } from "@/runtime/agent/toolProtocolAdapter";
import { estimateTokensCharHeuristic } from "@/runtime/context/contextSpooler";
import { hashPromptText } from "@/services/preparedRuntimeRequest";
import { RUNTIME_TOOLS_SYSTEM_HINT } from "@/services/runtimeChatToolParser";
import { buildToolAvailabilityContext } from "@/services/toolAvailabilityService";
import type { ToolName } from "@/runtime/tool/toolContracts";

export interface ProviderToolBudgetEstimate {
  protocolMode: ToolProtocolMode;
  toolSystemMessages: RuntimeChatMessage[];
  nativeDefinitions: ReturnType<typeof getNativeToolDefinitions>;
  toolsText: string;
  toolTokens: number;
  toolBodyBytes: number;
  toolCount: number;
  toolsHash: string;
  exposedNames: ToolName[];
}

function serializeNativeTools(
  definitions: ReturnType<typeof getNativeToolDefinitions>
): string {
  if (definitions.length === 0) return "";
  return JSON.stringify(definitions);
}

/**
 * Build the exact tool system messages / native definitions the turn loop will send,
 * and estimate their token cost for the final request budget gate.
 */
export function estimateProviderToolBudget(input: {
  toolsEnabled: boolean;
  providerId?: string | null;
  profile: AgentToolProfile;
  workspaceRoot?: string | null;
  skillAllowedNames?: ToolName[];
}): ProviderToolBudgetEstimate {
  if (!input.toolsEnabled || !input.workspaceRoot) {
    return {
      protocolMode: resolveToolProtocolMode(input.providerId),
      toolSystemMessages: [],
      nativeDefinitions: [],
      toolsText: "",
      toolTokens: 0,
      toolBodyBytes: 0,
      toolCount: 0,
      toolsHash: hashPromptText(""),
      exposedNames: []
    };
  }

  const protocolMode = resolveToolProtocolMode(input.providerId);
  const availability = buildToolAvailabilityContext(input.workspaceRoot);
  const toolSystemMessages = buildToolSystemMessages(
    input.profile,
    protocolMode,
    availability,
    input.skillAllowedNames
  );
  const exposedNames = listExposedToolNames(
    input.profile,
    availability,
    input.skillAllowedNames
  );
  const nativeDefinitions =
    protocolMode === "native"
      ? getNativeToolDefinitions(input.profile, availability, input.skillAllowedNames)
      : [];

  const systemToolsText = toolSystemMessages.map((m) => m.content).join("\n\n");
  const nativeJson = serializeNativeTools(nativeDefinitions);
  // Include the short runtime hint only when the catalog does not already cover execution policy.
  const hintPart = systemToolsText.includes("[Execution Policy")
    ? ""
    : RUNTIME_TOOLS_SYSTEM_HINT;
  const toolsText = [hintPart, systemToolsText, nativeJson].filter((part) => part.trim()).join("\n\n");
  const toolTokens = toolsText.trim() ? estimateTokensCharHeuristic(toolsText) : 0;
  const toolBodyBytes = new TextEncoder().encode(toolsText).length;
  const toolCount =
    nativeDefinitions.length > 0
      ? nativeDefinitions.length
      : toolSystemMessages.length > 0
        ? Math.max(1, (systemToolsText.match(/^- [a-z0-9_]+:/gim) ?? []).length)
        : 0;

  return {
    protocolMode,
    toolSystemMessages,
    nativeDefinitions,
    toolsText,
    toolTokens,
    toolBodyBytes,
    toolCount,
    toolsHash: hashPromptText(toolsText || nativeJson || ""),
    exposedNames
  };
}

export function messagesAlreadyIncludeToolCatalog(
  messages: readonly RuntimeChatMessage[]
): boolean {
  return messages.some((message) => {
    const content = message.content ?? "";
    return content.includes("[Tool Catalog]") || content.includes("[Native Tools]");
  });
}
