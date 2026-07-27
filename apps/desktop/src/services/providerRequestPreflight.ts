import type { RuntimeTaskType } from "@dbzs/shared";
import type { ProviderToolBudgetEstimate } from "@/services/providerToolBudget";
import type { PreparedRuntimeRequest } from "@/services/preparedRuntimeRequest";

export type ProviderPreflightRejectReason =
  | "tool_protocol_incompatible"
  | "request_body_too_large"
  | "context_budget_exceeded"
  | "model_capability_missing";

export interface ProviderRequestPreflight {
  compatible: boolean;
  promptTokens: number;
  toolTokens: number;
  outputReserveTokens: number;
  totalRequiredTokens: number;
  requestBodyBytes: number;
  toolBodyBytes: number;
  modelSupportsProtocol: boolean;
  templateSupportsProtocol: boolean;
  rejectionReasons: ProviderPreflightRejectReason[];
}

export function evaluateProviderRequestPreflight(input: {
  preparedRequest: PreparedRuntimeRequest;
  toolEstimate: ProviderToolBudgetEstimate;
  runtimeContextLimit: number;
  requestBodyBytes: number;
  taskType: RuntimeTaskType;
  currentPhase?: string | null;
  providerId?: string | null;
}): ProviderRequestPreflight {
  const promptTokens = input.preparedRequest.promptTokens;
  const toolTokens = input.preparedRequest.toolPayloadTokens;
  const outputReserveTokens = input.preparedRequest.outputReserveTokens;
  const totalRequiredTokens = promptTokens + toolTokens + outputReserveTokens;
  const requestBodyBytes = input.requestBodyBytes;
  const toolBodyBytes = input.toolEstimate.toolBodyBytes;
  const rejectionReasons: ProviderPreflightRejectReason[] = [];
  const smallContextRuntime = input.runtimeContextLimit <= 4096;
  const planningPhase =
    ["planning", "awaiting_plan_approval", "clarification"].includes(
      (input.currentPhase ?? "").toLowerCase()
    ) || ["planning", "architecture", "review"].includes(input.taskType);

  const modelSupportsProtocol = input.toolEstimate.protocolMode === "native"
    ? input.providerId === "ollama"
    : true;
  const templateSupportsProtocol = !(
    input.toolEstimate.protocolMode === "prompt" &&
    smallContextRuntime &&
    planningPhase &&
    toolTokens > 900
  );

  if (!modelSupportsProtocol || !templateSupportsProtocol) {
    rejectionReasons.push("tool_protocol_incompatible");
  }
  if (totalRequiredTokens > input.runtimeContextLimit) {
    rejectionReasons.push("context_budget_exceeded");
  }
  if (
    requestBodyBytes > (smallContextRuntime ? 14_000 : 24_000) ||
    (planningPhase && toolBodyBytes > 3_000)
  ) {
    rejectionReasons.push("request_body_too_large");
  }
  if (!input.preparedRequest.messages.length) {
    rejectionReasons.push("model_capability_missing");
  }

  return {
    compatible: rejectionReasons.length === 0,
    promptTokens,
    toolTokens,
    outputReserveTokens,
    totalRequiredTokens,
    requestBodyBytes,
    toolBodyBytes,
    modelSupportsProtocol,
    templateSupportsProtocol,
    rejectionReasons
  };
}
