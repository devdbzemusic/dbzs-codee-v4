/**
 * Runtime slot validation and health checking.
 * 
 * Before sending a request to a specific slot, we MUST verify:
 * 1. Slot exists and is running
 * 2. Requested model is actually running in that slot
 * 3. Slot is ready for chat (not bootstrapping, not errored)
 * 
 * If any check fails: ERROR, not silent fallback.
 */

import type { RuntimeSlotStatus } from "@dbzs/shared";
import type { RuntimeSlotId } from "./modelSelectionBroker";
import { combineAbortSignals } from "@/services/abortSignals";

export type { RuntimeSlotStatus };

export interface SlotCheckResult {
  ok: boolean;
  slotId: RuntimeSlotId;
  error?: string;
  details?: {
    state: string;
    model_id: string | null;
    expected_model: string;
    endpoint: string | null;
  };
}

type SlotStatusFetchError = "slot_status_unavailable" | "slot_status_timeout" | "slot_status_aborted";

interface SlotStatusFetchResult {
  status: RuntimeSlotStatus | null;
  error?: SlotStatusFetchError;
}

function createTimeoutReason(timeoutMs: number): Error {
  const error = new Error(`Slot status timeout after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  return error;
}

function classifySlotStatusFetchError(
  error: unknown,
  signal: AbortSignal,
  timeoutReason: Error,
): SlotStatusFetchError {
  const reason = signal.aborted ? signal.reason : undefined;
  const candidate = reason ?? error;
  const name = candidate instanceof Error ? candidate.name : "";
  const message = candidate instanceof Error ? candidate.message : String(candidate ?? "");

  if (candidate === timeoutReason || name === "TimeoutError" || /timeout/i.test(message)) {
    return "slot_status_timeout";
  }

  if (signal.aborted || name === "AbortError" || /aborted/i.test(message)) {
    return "slot_status_aborted";
  }

  return "slot_status_unavailable";
}

async function fetchRuntimeSlotStatus(
  backendUrl: string,
  slotId: RuntimeSlotId,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<SlotStatusFetchResult> {
  const timeoutController = new AbortController();
  const timeoutReason = createTimeoutReason(timeoutMs);
  const timeoutId = setTimeout(() => timeoutController.abort(timeoutReason), timeoutMs);
  const combined = combineAbortSignals([timeoutController.signal, externalSignal]);

  try {
    const response = await fetch(
      `${backendUrl}/runtime/slots/${slotId}/status`,
      {
        method: "GET",
        signal: combined.signal,
      }
    );

    if (!response.ok) {
      console.warn(`[slot-check] Slot ${slotId} status returned ${response.status}`);
      return { status: null, error: "slot_status_unavailable" };
    }

    return { status: await response.json() };
  } catch (err) {
    const error = classifySlotStatusFetchError(err, combined.signal, timeoutReason);
    console.warn(`[slot-check] Failed to fetch ${slotId} status (${error}):`, err);
    return { status: null, error };
  } finally {
    clearTimeout(timeoutId);
    combined.cleanup();
  }
}

/**
 * Fetch current status of a specific runtime slot.
 * Hits: GET /runtime/slots/{slot_id}/status
 */
export async function getRuntimeSlotStatus(
  backendUrl: string,
  slotId: RuntimeSlotId,
  timeoutMs: number = 5000,
  externalSignal?: AbortSignal,
): Promise<RuntimeSlotStatus | null> {
  const result = await fetchRuntimeSlotStatus(backendUrl, slotId, timeoutMs, externalSignal);
  return result.status;
}

/**
 * VERIFY that the target slot is ready for the requested model.
 * 
 * This is the GATE. If it fails, request must NOT be sent.
 * Backend will also validate, but this prevents unnecessary network round-trips.
 */
export async function verifySlotForRequest(
  backendUrl: string,
  slotId: RuntimeSlotId,
  expectedModelId: string,
  timeoutMs: number = 5000,
  externalSignal?: AbortSignal,
): Promise<SlotCheckResult> {
  const statusResult = await fetchRuntimeSlotStatus(
    backendUrl,
    slotId,
    timeoutMs,
    externalSignal,
  );
  const status = statusResult.status;

  if (!status) {
    return {
      ok: false,
      slotId,
      error: statusResult.error ?? "slot_status_unavailable",
      details: {
        state: "unknown",
        model_id: null,
        expected_model: expectedModelId,
        endpoint: null,
      },
    };
  }

  // Check 1: Slot is running
  if (status.state !== "running") {
    return {
      ok: false,
      slotId,
      error: `target_slot_not_running: state=${status.state}`,
      details: {
        state: status.state,
        model_id: status.model_id,
        expected_model: expectedModelId,
        endpoint: status.endpoint,
      },
    };
  }

  // Check 2: Model matches what we requested
  if (status.model_id !== expectedModelId) {
    return {
      ok: false,
      slotId,
      error: `selected_model_not_running_in_slot: expected=${expectedModelId}, running=${status.model_id}`,
      details: {
        state: status.state,
        model_id: status.model_id,
        expected_model: expectedModelId,
        endpoint: status.endpoint,
      },
    };
  }

  // Check 3: Endpoint is available
  if (!status.endpoint) {
    return {
      ok: false,
      slotId,
      error: "slot_endpoint_not_available",
      details: {
        state: status.state,
        model_id: status.model_id,
        expected_model: expectedModelId,
        endpoint: null,
      },
    };
  }

  // Check 4: Chat is ready
  if (!status.chat_ready) {
    return {
      ok: false,
      slotId,
      error: "slot_chat_not_ready: bootstrapping or warming up",
      details: {
        state: status.state,
        model_id: status.model_id,
        expected_model: expectedModelId,
        endpoint: status.endpoint,
      },
    };
  }

  // All checks passed
  return {
    ok: true,
    slotId,
    details: {
      state: status.state,
      model_id: status.model_id,
      expected_model: expectedModelId,
      endpoint: status.endpoint,
    },
  };
}

/**
 * Check if ANY slot is ready for chat.
 * Used as diagnostic/fallback information only.
 */
export async function listAvailableSlots(
  backendUrl: string,
  timeoutMs: number = 5000,
): Promise<RuntimeSlotStatus[]> {
  const slots: RuntimeSlotId[] = ["fast_gpu", "quality_cpu", "utility"];
  const available: RuntimeSlotStatus[] = [];

  for (const slotId of slots) {
    const status = await getRuntimeSlotStatus(backendUrl, slotId, timeoutMs);
    if (status && status.state === "running" && status.chat_ready) {
      available.push(status);
    }
  }

  return available;
}
