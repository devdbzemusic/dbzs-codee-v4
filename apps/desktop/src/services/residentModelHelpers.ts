import type { IndexedModel, RuntimeSlotId, RuntimeSlotStatus, RuntimeStatus } from "@dbzs/shared";
import { isWorkModelLoaded, looksLikeOrchestratorModel } from "./lazyRuntimePolicy";

/**
 * Strukturierte Informationen über ein verfügbares residentes Modell.
 */
export interface ResidentModelInfo {
  isReady: boolean;
  modelId: string;
  modelName: string;
  slotId: RuntimeSlotId;
  providerId: "llama.cpp" | "ollama";
  capabilities: readonly string[] | undefined;
}

const WORK_SLOTS: RuntimeSlotId[] = ["fast_gpu", "quality_cpu", "utility"];

/**
 * Analysiert den globalen `RuntimeStatus`, um festzustellen, ob ein
 * kompatibles, residentes Arbeitsmodell bereits läuft und bereit ist.
 *
 * Diese Funktion ist die Grundlage für die in Priorität 5 geforderte
 * Fallback-Logik.
 *
 * @param status Der zu prüfende `RuntimeStatus` oder `RuntimeSlotStatus`.
 * @returns Ein `ResidentModelInfo`-Objekt, wenn ein Modell bereit ist, sonst `null`.
 */
export function residentModelFromStatus(status: RuntimeStatus | RuntimeSlotStatus | null, modelIndex?: IndexedModel[] | null): ResidentModelInfo | null {
  if (!status || status.state !== "running" || !status.model_id || !status.provider) {
    return null;
  }

  // Orchestrator-Modelle sind keine validen Fallbacks für Arbeits-Tasks.
  if (looksLikeOrchestratorModel(status)) {
    return null;
  }

  const slotId = status.slot_id;
  if (!slotId || !WORK_SLOTS.includes(slotId)) {
    return null;
  }

  const isReady = isWorkModelLoaded(status);
  const indexedModel = modelIndex?.find(m => m.id === status?.model_id);

  return {
    isReady,
    modelId: status.model_id,
    modelName: status.model_name || status.model_id,
    slotId,
    providerId: status.provider,
    capabilities: indexedModel?.capabilities
  };
}

/**
 * Prüft, ob ein residentes Modell mit den Anforderungen eines Tasks kompatibel ist.
 *
 * @param residentInfo Die Informationen über das residente Modell.
 * @param requirements Die Anforderungen des Tasks (z.B. Vision).
 * @returns true, wenn das Modell kompatibel ist, sonst false.
 */
export function isResidentModelCompatible(
  residentInfo: ResidentModelInfo | null,
  requirements: { requiresVision?: boolean; requiresTools?: boolean }
): boolean {
  if (!residentInfo || !residentInfo.isReady) {
    return false;
  }

  // Vision-Anforderung prüfen
  if (requirements.requiresVision) {
    if (!residentInfo.capabilities?.includes("vision")) {
      return false;
    }
  }

  // Tool-Anforderung prüfen
  if (requirements.requiresTools) {
    if (!residentInfo.capabilities?.some((capability) => capability === "tools" || capability === "code")) {
      return false;
    }
  }

  return true;
}
