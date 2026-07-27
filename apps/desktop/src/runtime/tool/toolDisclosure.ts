import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import { allowedToolsForProfile } from "@/runtime/agent/agentToolProfile";
import type { ToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import type { ToolName } from "@/runtime/tool/toolContracts";
import { BRIDGE_TOOL_NAMES, isMetaToolName } from "@/runtime/tool/toolMetadata";
import { getRuntimeKernel } from "@/services/runtimeKernelService";
import { toolsetsForProfile } from "@/runtime/tool/toolsets";

export const CORE_ALWAYS_EXPOSED: ToolName[] = ["read_file", "list_files", "grep", "propose_file_changes", "ask_user"];
export const DISCLOSURE_THRESHOLD = 8;
export const PROMPT_CHAR_BUDGET = 10_000;

export type ToolExposureMode = "full" | "bridge";

export interface ToolExposureResult {
  mode: ToolExposureMode;
  exposedNames: ToolName[];
  bridgeActive: boolean;
  deferrableNames: ToolName[];
}

function estimateCatalogChars(names: ToolName[]): number {
  const registry = getRuntimeKernel().tools.registry;
  return names.reduce((total, name) => {
    const definition = registry.has(name) ? registry.get(name) : null;
    if (!definition) {
      return total;
    }
    return total + definition.name.length + definition.modelDescription.length + 120;
  }, 0);
}

export function listProfileAvailableToolNames(
  profile: AgentToolProfile,
  ctx: ToolAvailabilityContext,
  skillAllowedNames?: ToolName[]
): ToolName[] {
  const registry = getRuntimeKernel().tools.registry;
  const profileToolsets = toolsetsForProfile(profile);
  const profileNames = skillAllowedNames
    ? allowedToolsForProfile(profile).filter((name) => skillAllowedNames.includes(name))
    : allowedToolsForProfile(profile);

  return registry
    .listAvailable(ctx, { toolsets: profileToolsets, names: profileNames })
    .map((entry) => entry.name);
}

export function resolveToolExposure(
  profile: AgentToolProfile,
  ctx: ToolAvailabilityContext,
  skillAllowedNames?: ToolName[]
): ToolExposureResult {
  const availableNames = listProfileAvailableToolNames(profile, ctx, skillAllowedNames);
  const corePresent = CORE_ALWAYS_EXPOSED.filter((name) => availableNames.includes(name));
  const deferrableNames = availableNames.filter(
    (name) => !corePresent.includes(name) && !isMetaToolName(name)
  );

  const useBridge =
    availableNames.length > DISCLOSURE_THRESHOLD ||
    estimateCatalogChars(availableNames) > PROMPT_CHAR_BUDGET;

  if (!useBridge) {
    return {
      mode: "full",
      exposedNames: availableNames,
      bridgeActive: false,
      deferrableNames
    };
  }

  const bridgeNames = BRIDGE_TOOL_NAMES.filter((name) => {
    const registry = getRuntimeKernel().tools.registry;
    return registry.has(name);
  });

  const exposedNames = [...new Set<ToolName>([...corePresent, ...bridgeNames])];

  return {
    mode: "bridge",
    exposedNames,
    bridgeActive: true,
    deferrableNames
  };
}

export function isToolExposed(
  profile: AgentToolProfile,
  ctx: ToolAvailabilityContext,
  name: ToolName,
  skillAllowedNames?: ToolName[]
): { allowed: boolean; reason?: string } {
  const exposure = resolveToolExposure(profile, ctx, skillAllowedNames);

  if (exposure.exposedNames.includes(name)) {
    return { allowed: true };
  }

  if (exposure.bridgeActive && exposure.deferrableNames.includes(name)) {
    return {
      allowed: false,
      reason: `Tool ${name} is deferred. Use tool_search, tool_describe, then tool_call.`
    };
  }

  const registry = getRuntimeKernel().tools.registry;
  if (!registry.has(name)) {
    return { allowed: false, reason: `Unknown tool: ${name}` };
  }

  if (!registry.isAvailable(name, ctx)) {
    const definition = registry.get(name);
    return {
      allowed: false,
      reason: definition.unavailableReason ?? `Tool ${name} is not available in this context.`
    };
  }

  if (!allowedToolsForProfile(profile).includes(name)) {
    return { allowed: false, reason: `Tool ${name} blocked by profile ${profile}` };
  }

  if (skillAllowedNames && !skillAllowedNames.includes(name)) {
    return { allowed: false, reason: `Tool ${name} blocked by active skill policy` };
  }

  return { allowed: false, reason: `Tool ${name} is not exposed.` };
}
