import type { FallbackRejectionInfo, RuntimeChatEventType, RuntimeChatRun, RuntimeStatus } from "@dbzs/shared";
import type { RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { isResidentModelCompatible, residentModelFromStatus } from "./residentModelHelpers";
import { runtimeSlotManager, type WarmupResult } from "./runtimeSlotManager";

export type { FallbackRejectionInfo };

export interface FallbackHandlerResult {
  warmupResult: WarmupResult;
  finalRoute: RuntimeChatRoutingInfo;
  modelToStart: string;
  fallbackRejection?: FallbackRejectionInfo;
  fallbackInitiated: boolean;
}

interface FallbackHandlerInput {
  initialWarmupResult: WarmupResult;
  initialModelToStart: string;
  initialRoute: RuntimeChatRoutingInfo;
  currentStatus: RuntimeStatus | null;
  requiresVision: boolean;
  requiresTools: boolean;
  signal: AbortSignal;
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
  appendRunEvent: (
    run: RuntimeChatRun,
    type: RuntimeChatEventType,
    summary: string,
    payload?: Record<string, unknown>
  ) => RuntimeChatRun;
}

/**
 * Kapselt die Logik für den Fallback auf ein residentes Modell, wenn das
 * primäre Modell nicht gestartet werden kann.
 */
export async function handleResidentFallback(
  input: FallbackHandlerInput
): Promise<FallbackHandlerResult> {
  const {
    initialWarmupResult,
    initialModelToStart,
    initialRoute,
    currentStatus,
    requiresVision,
    requiresTools,
    signal,
    updateActiveRun,
    appendRunEvent
  } = input;

  if (initialWarmupResult.ok || initialWarmupResult.error === "warmup_timeout") {
    return {
      warmupResult: initialWarmupResult,
      finalRoute: initialRoute,
      modelToStart: initialModelToStart,
      fallbackInitiated: false
    };
  }

  const residentFallback = residentModelFromStatus(currentStatus, useModelIndexStore.getState().index?.models);
  const isCompatible = isResidentModelCompatible(residentFallback, { requiresVision, requiresTools });

  if (residentFallback?.isReady && !isCompatible) {
    const rejectionReason = requiresVision && !residentFallback.capabilities?.includes("vision")
      ? "Residente Modell hat keine Vision-Fähigkeit."
      : (requiresTools && !residentFallback.capabilities?.some(c => c === "tools" || c === "code"))
        ? "Residente Modell hat keine Tool-Fähigkeit."
        : "Residente Modell ist nicht kompatibel.";

    return {
      warmupResult: initialWarmupResult,
      finalRoute: initialRoute,
      modelToStart: initialModelToStart,
      fallbackRejection: { modelId: residentFallback.modelId, modelName: residentFallback.modelName, reason: rejectionReason },
      fallbackInitiated: false
    };
  }

  if (residentFallback?.isReady && isCompatible && residentFallback.modelId !== initialModelToStart) {
    console.log(`[RuntimeChat] Rollenmodell ${initialModelToStart} fehlgeschlagen. Versuche Fallback auf residentes Modell ${residentFallback.modelId}.`);
    updateActiveRun((r) => appendRunEvent(
      r,
      "runtime.fallback.initiated",
      `Rollenmodell ${initialRoute.modelName} nicht bereit. Fallback auf ${residentFallback.modelName}.`,
      { originalModelId: initialModelToStart, fallbackModelId: residentFallback.modelId, reason: initialWarmupResult.detail }
    ));

    const finalRoute = { ...initialRoute, modelId: residentFallback.modelId, modelName: residentFallback.modelName, slotId: residentFallback.slotId, selectionSource: "explicit_fallback" as const };
    const modelToStart = residentFallback.modelId;

    const warmupResult = await runtimeSlotManager.warmupInference(finalRoute.slotId, finalRoute.modelId, 15_000, signal);

    return { warmupResult, finalRoute, modelToStart, fallbackInitiated: true };
  }

  return { warmupResult: initialWarmupResult, finalRoute: initialRoute, modelToStart: initialModelToStart, fallbackInitiated: false };
}
