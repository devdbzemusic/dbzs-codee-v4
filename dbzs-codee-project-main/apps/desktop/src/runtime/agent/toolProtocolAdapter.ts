import type { RuntimeChatMessage } from "@dbzs/shared";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import type { ToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import { resolveToolExposure } from "@/runtime/tool/toolDisclosure";
import { getRuntimeKernel } from "@/services/runtimeKernelService";
import { buildToolCatalogSystemPrompt, toOllamaToolDefinitions } from "@/runtime/tool/toolModelCatalog";
import type { ToolName, ToolResult } from "@/runtime/tool/toolContracts";
import { isToolExposed } from "@/runtime/tool/toolDisclosure";
import {
  parseRuntimeToolCallsFromAssistant,
  type ParsedRuntimeToolCall
} from "@/services/runtimeChatToolParser";

export type ToolProtocolMode = "prompt" | "native";

export function resolveToolProtocolMode(providerId: string | null | undefined): ToolProtocolMode {
  if (providerId === "ollama") {
    return "native";
  }
  return "prompt";
}

export function listExposedToolNames(
  profile: AgentToolProfile,
  ctx: ToolAvailabilityContext,
  skillAllowedNames?: ToolName[]
): ToolName[] {
  return resolveToolExposure(profile, ctx, skillAllowedNames).exposedNames;
}

export function buildToolSystemMessages(
  profile: AgentToolProfile,
  protocolMode: ToolProtocolMode,
  ctx: ToolAvailabilityContext,
  skillAllowedNames?: ToolName[]
): RuntimeChatMessage[] {
  const exposure = resolveToolExposure(profile, ctx, skillAllowedNames);
  if (protocolMode === "prompt") {
    const prompt = buildToolCatalogSystemPrompt(exposure.exposedNames);
    const bridgeNote = exposure.bridgeActive
      ? "\n\nSome tools are deferred. Use tool_search, tool_describe, and tool_call to access them."
      : "";
    return [{ id: `msg-${Date.now().toString(36)}-sys`, role: "system", content: prompt + bridgeNote }];
  }

  return [
    {
      id: `msg-${Date.now().toString(36)}-sys`,
      role: "system",
      content: [
        "[Native Tools]",
        "Tools are registered for this provider. Use function tool_calls when available.",
        exposure.bridgeActive
          ? "Deferred tools require tool_search, tool_describe, tool_call."
          : "",
        "Allowed tools:",
        exposure.exposedNames.join(", ")
      ]
        .filter(Boolean)
        .join("\n")
    }
  ];
}

export function getNativeToolDefinitions(
  profile: AgentToolProfile,
  ctx: ToolAvailabilityContext,
  skillAllowedNames?: ToolName[]
) {
  const exposure = resolveToolExposure(profile, ctx, skillAllowedNames);
  const fromCatalog = toOllamaToolDefinitions(exposure.exposedNames);
  const registry = getRuntimeKernel().tools.registry;

  const mcpDefs = exposure.exposedNames
    .filter((name) => String(name).startsWith("mcp_") && registry.has(name))
    .map((name) => {
      const definition = registry.get(name);
      return {
        type: "function" as const,
        function: {
          name: definition.name,
          description: definition.modelDescription,
          parameters: { type: "object" }
        }
      };
    });

  const catalogNames = new Set(fromCatalog.map((entry) => entry.function.name));
  return [...fromCatalog, ...mcpDefs.filter((entry) => !catalogNames.has(entry.function.name))];
}

export function parseAssistantToolCalls(content: string, maxCalls = 8): ParsedRuntimeToolCall[] {
  return parseRuntimeToolCallsFromAssistant(content).slice(0, maxCalls);
}

export function stripToolCallBlocks(content: string): string {
  return content
    .replace(/<CODEE_TOOL_CALL>\s*[\s\S]*?\s*<\/CODEE_TOOL_CALL>/g, "")
    .trim();
}

export function formatToolResultForTurn(toolName: ToolName, result: ToolResult): string {
  const output =
    result.output !== undefined ? JSON.stringify(result.output, null, 2).slice(0, 6000) : "";
  const error = result.error ? `${result.error.code}: ${result.error.message}` : "";
  return [
    `[Tool Result: ${toolName}]`,
    `Status: ${result.status}`,
    error ? `Error: ${error}` : "",
    output ? `Output:\n${output}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseNativeToolCallsFromMessage(message: {
  tool_calls?: Array<{
    function?: { name?: string; arguments?: string };
  }>;
  toolCalls?: Array<{
    function?: { name?: string; arguments?: string };
  }>;
}): ParsedRuntimeToolCall[] {
  const calls: ParsedRuntimeToolCall[] = [];
  const raw = message.tool_calls ?? message.toolCalls;
  if (!raw) return calls;

  for (const call of raw) {
    const name = call.function?.name;
    if (!name) {
      continue;
    }
    try {
      const input = JSON.parse(call.function?.arguments ?? "{}") as Record<string, unknown>;
      calls.push({ name: name as ToolName, input });
    } catch {
      calls.push({ name: name as ToolName, input: {} });
    }
  }

  return calls;
}

export { isToolExposed };






