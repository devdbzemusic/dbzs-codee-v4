import type {
  RuntimeChatRun,
  RuntimeRunOutcome,
  RuntimeSlotId,
  RuntimeTaskType
} from "@dbzs/shared";
import type {
  PreparedRuntimeRequest,
  ProviderRequestDiagnostics
} from "@/services/preparedRuntimeRequest";
import type {
  ProviderRequestPreflight
} from "@/services/providerRequestPreflight";
import type { RuntimeBindingDecision } from "@/services/runtimeBinding";
import { assertRuntimeBindingConsistency } from "@/services/runtimeBinding";
import { BindingModelError } from "@/services/modelSelectionBroker";
import { evaluateProviderRequestPreflight } from "@/services/providerRequestPreflight";
import type { ProviderToolBudgetEstimate } from "@/services/providerToolBudget";
import { appendRunEvent, updateRunStatus } from "@/services/runtimeChatRunHelpers";
import { gateSlotForRequest } from "@/services/runtimeSlotExecutionState";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";
import {
  applyCpuSafeTimeoutOverrides,
  shouldApplySlowInferenceTimeouts,
  type TimeoutConfig
} from "@/services/timeoutConfig";
import { formatChatErrorForUser } from "@/services/runtimeChatErrorClassifier";

type SlotBindingState = {
  slotId?: string;
  modelId?: string;
} | null;

export function buildProviderRequestPrelude(input: {
  preparedRequest: PreparedRuntimeRequest;
  toolEstimate: ProviderToolBudgetEstimate;
  finalBudgetRuntimeContextLimit: number;
  taskType: RuntimeTaskType;
  hasImageInput?: boolean;
  currentPhase?: string | null;
  providerId?: string | null;
  endpoint: string;
  providerFallback: string;
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
}): {
  providerRequestDiagnostics: ProviderRequestDiagnostics;
  providerPreflight: ProviderRequestPreflight;
} {
  const messageBytes = new TextEncoder().encode(
    input.preparedRequest.messages
      .map((message) => `${message.role}:${message.content ?? ""}`)
      .join("\n---\n")
  ).length;

  const providerRequestDiagnostics: ProviderRequestDiagnostics = {
    endpoint: input.endpoint,
    provider: input.providerId ?? input.providerFallback,
    modelId: input.preparedRequest.modelId,
    slotId: input.preparedRequest.slotId,
    sentMessageCount: input.preparedRequest.messages.length,
    sentToolCount: Math.max(input.preparedRequest.tools.length, input.toolEstimate.toolCount),
    sentPromptTokens: input.preparedRequest.promptTokens,
    sentToolTokens: input.preparedRequest.toolPayloadTokens,
    totalEstimatedInputTokens:
      input.preparedRequest.promptTokens + input.preparedRequest.toolPayloadTokens,
    totalRequiredTokens:
      input.preparedRequest.promptTokens +
      input.preparedRequest.toolPayloadTokens +
      input.preparedRequest.outputReserveTokens,
    outputReserveTokens: input.preparedRequest.outputReserveTokens,
    promptHash: input.preparedRequest.promptHash,
    toolsHash: input.preparedRequest.toolsHash,
    requestBodyBytes:
      input.preparedRequest.protocolMode === "native"
        ? messageBytes + input.toolEstimate.toolBodyBytes
        : messageBytes,
    toolBodyBytes: input.toolEstimate.toolBodyBytes,
    protocolMode:
      input.preparedRequest.protocolMode === "none" ? undefined : input.preparedRequest.protocolMode,
    stream: true
  };

  const providerPreflight = evaluateProviderRequestPreflight({
    preparedRequest: input.preparedRequest,
    toolEstimate: input.toolEstimate,
    runtimeContextLimit: input.finalBudgetRuntimeContextLimit,
    requestBodyBytes: providerRequestDiagnostics.requestBodyBytes,
    taskType: input.taskType,
    hasImageInput: input.hasImageInput,
    currentPhase: input.currentPhase,
    providerId: input.providerId
  });

  input.updateActiveRun((run) => ({
    ...run,
    providerRequestDiagnostics: {
      ...providerRequestDiagnostics,
      preflight: providerPreflight
    } as unknown as Record<string, unknown>
  }));

  return { providerRequestDiagnostics, providerPreflight };
}

export function handleProviderPreflightFailure(input: {
  providerRequestDiagnostics: ProviderRequestDiagnostics;
  providerPreflight: ProviderRequestPreflight;
  failStep: (id: string, label: string, detail: string) => void;
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
  finishFailureState: (message: string, userError: string) => boolean;
}): boolean {
  if (input.providerPreflight.compatible) {
    return true;
  }

  const preflightReason =
    input.providerPreflight.rejectionReasons[0] ?? "provider_request_rejected";
  const preflightMsg =
    `provider_preflight_blocked:${preflightReason}` +
    ` prompt=${input.providerPreflight.promptTokens}` +
    ` tools=${input.providerPreflight.toolTokens}` +
    ` reserve=${input.providerPreflight.outputReserveTokens}` +
    ` total=${input.providerPreflight.totalRequiredTokens}` +
    ` bytes=${input.providerPreflight.requestBodyBytes}`;

  input.failStep("llm-request", "Modell-Anfrage senden", preflightMsg);
  input.updateActiveRun((run) =>
    appendRunEvent(
      {
        ...updateRunStatus(run, "failed"),
        outcome: "generation_failed" satisfies RuntimeRunOutcome,
        providerRequestDiagnostics: {
          ...input.providerRequestDiagnostics,
          preflight: input.providerPreflight
        } as unknown as Record<string, unknown>,
        error: { code: preflightReason, message: preflightMsg, phase: "provider_preflight" }
      },
      "chat.failed",
      preflightMsg
    )
  );

  return input.finishFailureState(
    preflightMsg,
    formatChatErrorForUser(new Error(preflightReason))
  );
}

export async function validateRequestExecutionBinding(input: {
  stepLabel: string;
  slotValidationEnabled: boolean;
  contextSlotId: RuntimeSlotId | null | undefined;
  routingModelId: string | null | undefined;
  initialRunId: string;
  preparedRequest: PreparedRuntimeRequest;
  bindingDecision: RuntimeBindingDecision;
  providerRequestDiagnostics: ProviderRequestDiagnostics;
  providerPreflight: ProviderRequestPreflight;
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
  failStep: (id: string, label: string, detail: string) => void;
  finishFailureState: (message: string, userError?: string) => boolean;
  timeoutManagerConfig: TimeoutConfig;
  settings: Parameters<typeof applyCpuSafeTimeoutOverrides>[1];
}): Promise<{
  ok: boolean;
  slotBindingState: SlotBindingState;
  bindingDiagnostics?: unknown;
}> {
  let slotBindingState: SlotBindingState = null;

  if (input.slotValidationEnabled && input.contextSlotId && input.routingModelId) {
    const preRequestStatus = await runtimeSlotManager.getSlotStatus(input.contextSlotId);
    const slotGate = gateSlotForRequest({
      slotId: input.contextSlotId,
      status: preRequestStatus,
      expectedModelId: input.routingModelId || "",
      activeRunId: input.initialRunId,
      otherActiveRunIdOnSlot: null
    });
    input.updateActiveRun((run) => ({
      ...appendRunEvent(
        run,
        slotGate.ok ? "runtime.check.completed" : "runtime.check.started",
        slotGate.ok ? "slot_execution_ready" : slotGate.message,
        { ...slotGate.state }
      ),
      slotExecutionState: slotGate.state
    }));
    slotBindingState = {
      slotId: slotGate.state.slotId,
      modelId: slotGate.state.modelId
    };
    if (!slotGate.ok) {
      throw new BindingModelError(
        slotGate.message,
        slotGate.code === "binding_mismatch" ? "binding_mismatch" : "slot_busy",
        slotGate.code === "slot_busy"
          ? ["A – warten und erneut senden", "B – anderen Slot wählen", "C – abbrechen"]
          : ["A – Slot neu starten", "B – Rollenmodell prüfen", "C – abbrechen"]
      );
    }
    if (shouldApplySlowInferenceTimeouts(slotGate.state.gpuLayers)) {
      Object.assign(
        input.timeoutManagerConfig,
        applyCpuSafeTimeoutOverrides(input.timeoutManagerConfig, input.settings)
      );
    }
  }

  const bindingCheck = assertRuntimeBindingConsistency({
    bindingDecision: input.bindingDecision,
    preparedRequest: input.preparedRequest,
    slotExecutionState: slotBindingState,
    providerRequest: input.providerRequestDiagnostics
  });

  input.updateActiveRun((run) => ({
    ...run,
    providerRequestDiagnostics: {
      ...input.providerRequestDiagnostics,
      preflight: input.providerPreflight,
      bindingDiagnostics: bindingCheck.diagnostics
    } as unknown as Record<string, unknown>
  }));

  if (!bindingCheck.ok) {
    const mismatchMsg = `request_binding_mismatch: ${bindingCheck.diagnostics.mismatches.join(",")}`;
    input.failStep("llm-request", input.stepLabel, mismatchMsg);
    input.updateActiveRun((run) =>
      appendRunEvent(
        {
          ...updateRunStatus(run, "failed"),
          outcome: "request_binding_mismatch" satisfies RuntimeRunOutcome,
          providerRequestDiagnostics: {
            ...input.providerRequestDiagnostics,
            preflight: input.providerPreflight,
            bindingDiagnostics: bindingCheck.diagnostics
          } as unknown as Record<string, unknown>,
          error: { code: "request_binding_mismatch", message: mismatchMsg, phase: "binding" }
        },
        "chat.failed",
        mismatchMsg
      )
    );
    return {
      ok: false,
      slotBindingState,
      bindingDiagnostics: bindingCheck.diagnostics as unknown,
    };
  }

  return {
    ok: true,
    slotBindingState,
    bindingDiagnostics: bindingCheck.diagnostics as unknown
  };
}
