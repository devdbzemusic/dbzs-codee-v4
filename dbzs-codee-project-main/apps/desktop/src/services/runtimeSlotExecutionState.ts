/**
 * Slot execution gate before model.request.started.
 */

import type { RuntimeSlotId, RuntimeSlotStatus } from "@dbzs/shared";

export interface RuntimeSlotExecutionState {
  slotId: RuntimeSlotId;
  processRunning: boolean;
  endpointReachable: boolean;
  modelLoaded: boolean;
  slotBusy: boolean;
  activeRunId?: string;
  modelId?: string;
  gpuLayers?: number;
  cpuOffloadLayers?: number;
  loadDurationMs?: number;
}

export type SlotExecutionGateResult =
  | { ok: true; state: RuntimeSlotExecutionState }
  | {
      ok: false;
      state: RuntimeSlotExecutionState;
      code: "binding_mismatch" | "slot_busy" | "slot_not_ready" | "orphaned_run";
      message: string;
    };

export function buildSlotExecutionState(input: {
  slotId: RuntimeSlotId;
  status: RuntimeSlotStatus | null | undefined;
  expectedModelId: string;
  activeRunId?: string | null;
  otherActiveRunIdOnSlot?: string | null;
}): RuntimeSlotExecutionState {
  const status = input.status;
  const processRunning = status?.state === "running";
  const endpointReachable = Boolean(status?.endpoint) && status?.chat_ready !== false;
  const modelLoaded = Boolean(status?.model_id) && processRunning;
  const activeRequests = Number(status?.active_requests ?? 0);
  const residencyBusy = status?.residency_state === "busy" || status?.residency_state === "warming";
  const slotBusy =
    activeRequests > 0 ||
    residencyBusy ||
    Boolean(input.otherActiveRunIdOnSlot && input.otherActiveRunIdOnSlot !== input.activeRunId);

  return {
    slotId: input.slotId,
    processRunning,
    endpointReachable: processRunning && endpointReachable,
    modelLoaded,
    slotBusy,
    activeRunId: input.activeRunId ?? undefined,
    modelId: status?.model_id ?? undefined,
    gpuLayers: status?.gpu_layers ?? undefined,
    cpuOffloadLayers:
      status?.gpu_layers != null && status.gpu_layers > 0
        ? Math.max(0, 32 - status.gpu_layers)
        : status?.gpu_layers === 0
          ? 0
          : undefined,
    loadDurationMs: undefined
  };
}

export function gateSlotForRequest(input: {
  slotId: RuntimeSlotId;
  status: RuntimeSlotStatus | null | undefined;
  expectedModelId: string;
  activeRunId?: string | null;
  otherActiveRunIdOnSlot?: string | null;
}): SlotExecutionGateResult {
  const state = buildSlotExecutionState(input);

  if (!state.processRunning || !state.endpointReachable) {
    return {
      ok: false,
      state,
      code: "slot_not_ready",
      message: `Slot ${input.slotId} ist nicht bereit (process/endpoint).`
    };
  }

  if ((state.modelId || "") !== input.expectedModelId) {
    return {
      ok: false,
      state,
      code: "binding_mismatch",
      message: `Slot-Modell '${state.modelId ?? "none"}' ≠ gebundenes Modell '${input.expectedModelId}'.`
    };
  }

  if (state.slotBusy) {
    return {
      ok: false,
      state,
      code: "slot_busy",
      message: `Slot ${input.slotId} ist beschäftigt — kein paralleler Request auf demselben exklusiven Slot.`
    };
  }

  if (input.otherActiveRunIdOnSlot && input.otherActiveRunIdOnSlot !== input.activeRunId) {
    return {
      ok: false,
      state,
      code: "orphaned_run",
      message: `Verwaister/paralleler Run ${input.otherActiveRunIdOnSlot} blockiert Slot ${input.slotId}.`
    };
  }

  return { ok: true, state };
}
