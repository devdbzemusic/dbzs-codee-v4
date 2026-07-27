import { estimateTokensCharHeuristic } from "@/runtime/context/contextSpooler";

export interface AgentTurnTokenBudget {
  runId: string;
  turnIndex: number;
  runtimeContextLimit: number;
  goalTokens: number;
  systemTokens: number;
  toolSchemaTokens: number;
  chatHistoryTokens: number;
  toolResultTokens: number;
  fileContextTokens: number;
  ragTokens: number;
  outputReserveTokens: number;
  safetyMarginTokens: number;
  totalRequiredTokens: number;
  overflowTokens: number;
}

export function computeAgentTurnTokenBudget(input: {
  runId: string;
  turnIndex: number;
  runtimeContextLimit: number;
  goalText: string;
  systemText: string;
  toolsText: string;
  chatHistoryText: string;
  toolResultText?: string;
  fileContextText?: string;
  ragText?: string;
  outputReserveTokens?: number;
  safetyMarginTokens?: number;
}): AgentTurnTokenBudget {
  const goalTokens = estimateTokensCharHeuristic(input.goalText || " ");
  const systemTokens = estimateTokensCharHeuristic(input.systemText || " ");
  // Empty toolsText must not report 1 token as if tools were present.
  const toolSchemaTokens = (input.toolsText ?? "").trim()
    ? estimateTokensCharHeuristic(input.toolsText)
    : 0;
  const chatHistoryTokens = estimateTokensCharHeuristic(input.chatHistoryText || " ");
  const toolResultTokens = (input.toolResultText ?? "").trim()
    ? estimateTokensCharHeuristic(input.toolResultText!)
    : 0;
  const fileContextTokens = (input.fileContextText ?? "").trim()
    ? estimateTokensCharHeuristic(input.fileContextText!)
    : 0;
  const ragTokens = (input.ragText ?? "").trim()
    ? estimateTokensCharHeuristic(input.ragText!)
    : 0;
  const outputReserveTokens = input.outputReserveTokens ?? Math.max(256, Math.floor(input.runtimeContextLimit * 0.15));
  const safetyMarginTokens = input.safetyMarginTokens ?? Math.max(128, Math.floor(input.runtimeContextLimit * 0.05));

  const totalRequiredTokens =
    goalTokens +
    systemTokens +
    toolSchemaTokens +
    chatHistoryTokens +
    toolResultTokens +
    fileContextTokens +
    ragTokens +
    outputReserveTokens +
    safetyMarginTokens;

  const overflowTokens = Math.max(0, totalRequiredTokens - input.runtimeContextLimit);

  return {
    runId: input.runId,
    turnIndex: input.turnIndex,
    runtimeContextLimit: input.runtimeContextLimit,
    goalTokens,
    systemTokens,
    toolSchemaTokens,
    chatHistoryTokens,
    toolResultTokens,
    fileContextTokens,
    ragTokens,
    outputReserveTokens,
    safetyMarginTokens,
    totalRequiredTokens,
    overflowTokens
  };
}

export type EffectiveRuntimeDevice = "cpu" | "gpu" | "hybrid";

export interface EffectiveRuntimeDeviceInfo {
  configuredSlot: string;
  effectiveDevice: EffectiveRuntimeDevice;
  gpuLayers: number;
  cpuOffloadLayers: number;
}

export function resolveEffectiveRuntimeDevice(input: {
  configuredSlot: string;
  gpuLayers?: number | null;
  cpuOffloadLayers?: number | null;
}): EffectiveRuntimeDeviceInfo {
  const gpuLayers = Math.max(0, input.gpuLayers ?? 0);
  const cpuOffloadLayers = Math.max(0, input.cpuOffloadLayers ?? 0);
  let effectiveDevice: EffectiveRuntimeDevice = "cpu";
  if (gpuLayers > 0 && cpuOffloadLayers > 0) {
    effectiveDevice = "hybrid";
  } else if (gpuLayers > 0) {
    effectiveDevice = "gpu";
  }
  return {
    configuredSlot: input.configuredSlot,
    effectiveDevice,
    gpuLayers,
    cpuOffloadLayers
  };
}
