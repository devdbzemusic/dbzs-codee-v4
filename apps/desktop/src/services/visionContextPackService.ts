/**
 * Vision Context Pack pre-step (Model Control Center Plan, Section 11 "Coding mit
 * Screenshot"/"Review mit Screenshot"): when a coding/review turn has an image
 * attachment, a verified vision model analyzes the screenshot first and produces a
 * structured text description ("context pack"). The actual coding/review model then
 * consumes that text, never the raw image - it doesn't need vision capability itself.
 *
 * This intentionally does NOT reuse agentTurnEngine.ts's tool-call loop: it is a
 * one-shot analysis call, structurally the same pattern as
 * repositoryReview/llmBatchAnalyzer.ts's injected `chat()` call, just targeting a
 * different (vision) model instead of the outer turn's model.
 */
import type { MultimodalPair, RuntimeChatMessage, RuntimeChatRequest, RuntimeSlotId } from "@dbzs/shared";
import { agentRunService } from "@/services/agentRunService";
import {
  BindingModelError,
  brokerDecision,
  type BrokerModelCatalogEntry,
  type RunningModelSnapshot
} from "@/services/modelSelectionBroker";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";

export const VISION_CONTEXT_PACK_SYSTEM_PROMPT =
  "Du bist ein Vision-Analyse-Assistent, der einem Coding-/Review-Modell zuarbeitet. " +
  "Beschreibe das angehaengte Bild praezise und strukturiert: sichtbare UI-Elemente, " +
  "Text- und Fehlermeldungen im Bild, Code-Ausschnitte (moeglichst woertlich), " +
  "Layout-/Darstellungsprobleme sowie Datei-/Pfadnamen, falls erkennbar. " +
  "Gib KEINE Code-Aenderungen, Empfehlungen oder Bewertungen ab - nur eine " +
  "faktische Beschreibung, die ein anderes Modell als Kontext fuer die eigentliche " +
  "Aufgabe nutzt. Antworte auf Deutsch, in Fliesstext oder kurzen Stichpunkten.";

export function buildVisionContextPackUserPrompt(goal: string): string {
  return `Nutzeranfrage: ${goal}\n\nAnalysiere das angehaengte Bild im Kontext dieser Anfrage.`;
}

export function formatVisionContextPackBlock(input: {
  contextPack: string;
  visionModelName: string | null;
  visionModelId: string;
}): string {
  const modelLabel = input.visionModelName?.trim() || input.visionModelId;
  return `[VISION CONTEXT PACK - Bildanalyse von ${modelLabel}]\n${input.contextPack}`;
}

export interface VisionContextPackSuccess {
  ok: true;
  contextPack: string;
  visionModelId: string;
  visionModelName: string | null;
  slotId: RuntimeSlotId;
}

export interface VisionContextPackFailure {
  ok: false;
  reason: string;
}

export type VisionContextPackOutcome = VisionContextPackSuccess | VisionContextPackFailure;

export interface VisionContextPackBrokerSettings {
  defaultModelId: string;
  defaultChatModelId?: string;
  defaultModelName: string;
  defaultPlannerModelId?: string;
  defaultCoderModelId?: string;
  defaultReviewerModelId?: string;
  defaultDebugModelId?: string;
  defaultVisionModelId?: string;
  localOnlyModels?: boolean;
}

/**
 * Resolves a verified vision model (never the coding/review model), makes sure its
 * slot is actually serving it, and runs one image-analysis call. Never throws -
 * every failure mode (no vision model configured, MM-pair not verified, slot start/
 * warmup failed, empty response) resolves to `{ ok: false, reason }` so the caller can
 * gracefully fall back to the normal single-model flow instead of hard-failing the turn.
 */
export async function runVisionContextPackPreStep(input: {
  goal: string;
  images: string[];
  settings: VisionContextPackBrokerSettings;
  catalog: BrokerModelCatalogEntry[] | undefined;
  multimodalPairs: MultimodalPair[] | undefined;
  runningModels: RunningModelSnapshot[] | undefined;
  signal?: AbortSignal;
}): Promise<VisionContextPackOutcome> {
  if (input.images.length === 0) {
    return { ok: false, reason: "no_images" };
  }

  let decision;
  try {
    decision = brokerDecision("image_analysis", input.settings, {
      hasImageInput: true,
      requiresVision: true,
      catalog: input.catalog,
      multimodalPairs: input.multimodalPairs,
      runningModels: input.runningModels
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof BindingModelError ? `vision_routing_failed: ${error.message}` : "vision_routing_failed"
    };
  }

  const slotId = decision.slotId;
  const modelId = decision.resolvedModelId;

  try {
    const currentStatus = await runtimeSlotManager.getSlotStatus(slotId);
    const alreadyServing =
      runtimeSlotManager.isSlotReady(currentStatus) && currentStatus?.model_id === modelId;

    if (!alreadyServing) {
      const startResult = await runtimeSlotManager.startSlot(slotId, modelId);
      if (!startResult.success) {
        return { ok: false, reason: `vision_slot_start_failed: ${startResult.error ?? "unknown"}` };
      }
      const readyStatus = await runtimeSlotManager.waitForSlotReady(slotId, 60_000);
      if (!readyStatus) {
        return { ok: false, reason: "vision_slot_not_ready" };
      }
    }

    const messages: RuntimeChatMessage[] = [
      {
        id: `vision-pack-sys-${Date.now().toString(36)}`,
        role: "system",
        content: VISION_CONTEXT_PACK_SYSTEM_PROMPT
      },
      {
        id: `vision-pack-user-${Date.now().toString(36)}`,
        role: "user",
        content: buildVisionContextPackUserPrompt(input.goal),
        images: input.images
      }
    ];
    const request: RuntimeChatRequest = {
      messages,
      model_id: modelId,
      slot_id: slotId,
      provider: decision.providerId,
      temperature: 0.2,
      max_tokens: 700,
      decision_id: decision.decisionId,
      routing_reason: "vision_context_pack"
    };

    const response = await agentRunService.sendChat(request, input.signal);
    const contextPack = response.message.content.trim();
    if (!contextPack) {
      return { ok: false, reason: "vision_empty_response" };
    }

    return {
      ok: true,
      contextPack,
      visionModelId: response.model_id ?? modelId,
      visionModelName: response.model_name ?? decision.resolvedModelName ?? null,
      slotId
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? `vision_context_pack_failed: ${error.message}` : "vision_context_pack_failed"
    };
  }
}
