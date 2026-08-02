/**
 * DBZS – Division By Zeros
 * Datei: runtimeSlotManager.ts
 * Bereich: Desktop Services / Runtime Slot Manager
 *
 * Zweck:
 *   Verwaltet Runtime-Slots (fast_gpu, quality_cpu, utility) mit Start/Stop/Status.
 *
 * Warum:
 *   Slots müssen einfach verwaltbar sein mit Auto-Start und Diagnostik.
 *
 * Wozu:
 *   Ermöglicht kontrollierte Slot-Verwaltung im Runtime Chat.
 */

import type {
  IndexedModel,
  RuntimeReadinessStage,
  RuntimeSlotStatus,
  RuntimeSlotId,
  RuntimeSlotHealthEvent,
  RuntimeSlotHealthEventType,
  RuntimeWarmupDiagnostics
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { useSettingsStore } from "@/stores/settingsStore";
import { looksLikeVisionModel } from "@/services/modelSelectionBroker";

interface RoutingEventRecord {
  timestamp: string;
  level: "info" | "warn";
  event: string;
  detail: Record<string, unknown>;
}

export interface WarmupResult {
  ok: boolean;
  status?: "ready" | "failed";
  error?: string;
  detail?: string;
  readinessStage?: RuntimeReadinessStage | string;
  diagnostics?: RuntimeWarmupDiagnostics;
}

const routingEventLog: RoutingEventRecord[] = [];

function emitRoutingEvent(event: string, payload: Record<string, unknown>): void {
  const record: RoutingEventRecord = {
    timestamp: new Date().toISOString(),
    level: "info",
    event,
    detail: payload
  };
  routingEventLog.push(record);
  if (routingEventLog.length > 50) {
    routingEventLog.splice(0, routingEventLog.length - 50);
  }
  console.info(`[RuntimeRouting] ${event}`, payload);
}

export function getRecentRoutingEvents(limit = 10): RoutingEventRecord[] {
  return routingEventLog.slice(-limit).reverse();
}

export type { RuntimeSlotStatus };

async function resolveBackendUrl(): Promise<string> {
  try {
    const settings = await backendClient.getSettings();
    return settings.backendUrl || "http://127.0.0.1:8876";
  } catch {
    return "http://127.0.0.1:8876";
  }
}

/**
 * Slot-Start-Request.
 */
export interface StartSlotRequest {
  slot_id: RuntimeSlotId;
  model_id: string;
}

/**
 * Slot-Management-Ergebnis.
 */
export interface SlotOperationResult {
  success: boolean;
  slotId: RuntimeSlotId;
  status?: RuntimeSlotStatus;
  error?: string;
}

/**
 * Task-basierte Slot-Empfehlung.
 */
export interface SlotRecommendation {
  slotId: RuntimeSlotId;
  reason: string;
  alternativeSlotId?: RuntimeSlotId;
}

/**
 * Alle verfügbaren Slots.
 */
export const ALL_SLOTS: RuntimeSlotId[] = ["fast_gpu", "quality_cpu", "utility", "orchestrator_cpu", "vision_gpu"];

function normalizeModelKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRunnableLocalModel(model: IndexedModel): boolean {
  return (
    model.runtime_launcher === "llama-server" &&
    !["llama_server_missing_file", "external_runtime_required", "unsupported"].includes(model.compatibility)
  );
}

function matchesModelKey(model: IndexedModel, requestedModelId: string): boolean {
  const requested = normalizeModelKey(requestedModelId);
  return (
    model.id === requestedModelId ||
    model.name === requestedModelId ||
    normalizeModelKey(model.id) === requested ||
    normalizeModelKey(model.name) === requested
  );
}

function sizeHintScore(model: IndexedModel, slotId: RuntimeSlotId): number {
  const key = normalizeModelKey(`${model.name} ${model.id} ${model.path}`);

  if (slotId === "utility") {
    if (model.recommended_use === "embedding" || key.includes("embed")) return 80;
    if (key.includes("rerank")) return 70;
    if (key.includes("1-5b") || key.includes("1-5-b") || key.includes("1b")) return 50;
  }

  if (slotId === "fast_gpu") {
    if (key.includes("3b")) return 70;
    if (key.includes("1-5b") || key.includes("1-5-b")) return 60;
    if (key.includes("2b") || key.includes("4b")) return 45;
    if (key.includes("7b")) return 20;
  }

  if (slotId === "quality_cpu") {
    if (key.includes("7b")) return 70;
    if (key.includes("8b")) return 65;
    if (key.includes("22b")) return 55;
    if (key.includes("3b") || key.includes("4b")) return 40;
  }

  if (slotId === "orchestrator_cpu") {
    if (model.recommended_use === "orchestrator" || key.includes("functiongemma")) return 90;
    if (key.includes("270m") || key.includes("function")) return 50;
  }

  if (slotId === "vision_gpu") {
    if (key.includes("vl") && (key.includes("3b") || key.includes("2b"))) return 90;
    if (key.includes("vl")) return 60;
  }

  return 0;
}

function isVisionIndexedModel(model: IndexedModel): boolean {
  return looksLikeVisionModel(`${model.id} ${model.name} ${model.path}`, {
    id: model.id,
    name: model.name,
    capabilities: model.capabilities,
    recommended_use: model.recommended_use
  });
}

/**
 * Score a catalog model for a runtime slot.
 * Vision models are heavily penalized for chat/coding defaults unless allowVision.
 */
export function scoreModelForSlot(
  model: IndexedModel,
  slotId: RuntimeSlotId,
  options?: { allowVision?: boolean },
): number {
  let score = 0;

  if (model.compatibility === "llama_server_ready") score += 120;
  if (model.recommended_use === "primary_coding") score += slotId === "utility" ? 25 : 100;
  if (model.recommended_use === "coding_candidate") score += slotId === "utility" ? 15 : 60;
  if (model.recommended_use === "chat_candidate") {
    score += slotId === "quality_cpu" ? 80 : slotId === "utility" ? 10 : 25;
  }
  if (model.capabilities?.includes("code")) score += 35;
  if (model.capabilities?.includes("chat")) score += 20;
  score += sizeHintScore(model, slotId);

  if (
    !options?.allowVision &&
    (slotId === "quality_cpu" || slotId === "fast_gpu") &&
    isVisionIndexedModel(model)
  ) {
    score -= 1000;
  }

  if (slotId === "vision_gpu" && !isVisionIndexedModel(model)) {
    score -= 1000;
  }

  return score;
}

function selectDefaultModelForSlot(models: IndexedModel[], slotId: RuntimeSlotId): IndexedModel | null {
  const runnable = models.filter(isRunnableLocalModel);
  const preferred = runnable
    .filter((model) => slotId !== "utility" || model.recommended_use !== "embedding")
    .filter((model) => {
      if (slotId !== "quality_cpu" && slotId !== "fast_gpu") return true;
      return !isVisionIndexedModel(model);
    })
    .sort((left, right) => scoreModelForSlot(right, slotId) - scoreModelForSlot(left, slotId));

  if (preferred[0]) return preferred[0];

  const fallback = runnable
    .filter((model) => slotId !== "utility" || model.recommended_use !== "embedding")
    .sort((left, right) => scoreModelForSlot(right, slotId) - scoreModelForSlot(left, slotId));

  return fallback[0] ?? runnable[0] ?? null;
}

/**
 * Representative task type used to ask the backend FleetRoutingResolver for
 * a default model when no role setting is configured for `slotId` — the
 * resolved slot in the response is ignored, only resolved_model_id is used,
 * since the caller has already committed to `slotId` externally.
 */
function taskTypeForSlotFallback(slotId: RuntimeSlotId): string {
  switch (slotId) {
    case "fast_gpu":
      return "small_code_change";
    case "utility":
      return "embedding";
    case "vision_gpu":
    case "quality_cpu":
    case "orchestrator_cpu":
    default:
      return "normal_chat";
  }
}

function configuredModelForSlot(slotId: RuntimeSlotId): string {
  const settings = useSettingsStore.getState().settings;

  switch (slotId) {
    case "fast_gpu":
      return settings.defaultCoderModelId || settings.defaultModelId || "";
    case "quality_cpu":
      return settings.defaultChatModelId || settings.defaultModelId || "";
    case "utility":
      return settings.defaultUtilityModelId || "";
    case "orchestrator_cpu":
      return settings.defaultOrchestratorModelId || "";
    case "vision_gpu":
      return settings.defaultVisionModelId || "";
    default:
      return settings.defaultModelId || "";
  }
}

/**
 * Runtime Slot Manager Service.
 */
export const runtimeSlotManager = {
  /**
   * Holt den Status eines Slots.
   */
  async getSlotStatus(slotId: RuntimeSlotId): Promise<RuntimeSlotStatus | null> {
    try {
      // Backend-API aufrufen
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/runtime/slots/${slotId}/status`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        console.warn(`[SlotManager] Slot ${slotId} Status: ${response.status}`);
        return null;
      }

      const data = await response.json();
      return data as RuntimeSlotStatus;
    } catch (error) {
      console.warn(`[SlotManager] Fehler beim Laden von ${slotId}:`, error);
      return null;
    }
  },

  /**
   * Holt den Status aller Slots.
   */
  async getAllSlotsStatus(): Promise<RuntimeSlotStatus[]> {
    const results = await Promise.all(ALL_SLOTS.map(slotId => this.getSlotStatus(slotId)));
    return results.filter((r): r is RuntimeSlotStatus => r !== null);
  },

  /**
   * Startet einen Slot.
   */
  async startSlot(
    slotId: RuntimeSlotId,
    modelId: string,
    profile?: string,
    projectorArtifactId?: string
  ): Promise<SlotOperationResult> {
    try {
      const backendUrl = await resolveBackendUrl();
      const body: Record<string, unknown> = { model_id: modelId };
      if (profile) body.profile = profile;
      // Plan 15, Phase 5 (Dual-Mode Vision): an id from the current model index's
      // MultimodalPair, never a raw filesystem path — the backend resolves it
      // itself against its own index before ever touching the launch command.
      if (projectorArtifactId) body.projector_artifact_id = projectorArtifactId;
      const response = await fetch(`${backendUrl}/runtime/slots/${slotId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          slotId,
          error: `Start fehlgeschlagen: ${response.status} - ${errorText}`
        };
      }

      const status = await response.json() as RuntimeSlotStatus;

      return {
        success: true,
        slotId,
        status
      };
    } catch (error) {
      return {
        success: false,
        slotId,
        error: error instanceof Error ? error.message : "Unbekannter Fehler"
      };
    }
  },

  /**
   * "Neu vermessen" — berechnet einen Resource Plan ohne einen Prozess zu starten.
   */
  async previewResourcePlan(
    slotId: RuntimeSlotId,
    modelId: string,
    profile?: string
  ): Promise<Record<string, unknown> | null> {
    try {
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/runtime/resource-plan/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId, slot_id: slotId, profile })
      });
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch {
      return null;
    }
  },

  /**
   * Stoppt einen Slot.
   */
  async stopSlot(slotId: RuntimeSlotId): Promise<SlotOperationResult> {
    try {
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/runtime/slots/${slotId}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          slotId,
          error: `Stop fehlgeschlagen: ${response.status} - ${errorText}`
        };
      }

      const status = await response.json() as RuntimeSlotStatus;

      return {
        success: true,
        slotId,
        status
      };
    } catch (error) {
      return {
        success: false,
        slotId,
        error: error instanceof Error ? error.message : "Unbekannter Fehler"
      };
    }
  },

  /**
   * Startet einen Slot neu.
   */
  async restartSlot(slotId: RuntimeSlotId, modelId: string): Promise<SlotOperationResult> {
    // Erst stoppen, dann starten
    await this.stopSlot(slotId);

    // Kurze Verzögerung für sauberen Stop
    await new Promise(resolve => setTimeout(resolve, 1000));

    return await this.startSlot(slotId, modelId);
  },

  /**
   * Empfiehlt einen Slot basierend auf Task-Type.
   */
  getRecommendedSlot(taskType: string): SlotRecommendation {
    const normalizedTaskType = taskType.toLowerCase();

    if (
      normalizedTaskType.includes("embed") ||
      normalizedTaskType.includes("rerank") ||
      normalizedTaskType.includes("index")
    ) {
      emitRoutingEvent("slot_recommended", { taskType: normalizedTaskType, slotId: "utility", reason: "embedding" });
      return {
        slotId: "utility",
        reason: "Utility-Slot für Embedding, Reranking und Indexing",
        alternativeSlotId: "quality_cpu"
      };
    }

    if (
      normalizedTaskType.includes("intent_routing") ||
      normalizedTaskType.includes("workflow_routing") ||
      normalizedTaskType.includes("function_calling") ||
      normalizedTaskType.includes("clarification_detection")
    ) {
      emitRoutingEvent("slot_recommended", { taskType: normalizedTaskType, slotId: "orchestrator_cpu", reason: "routing" });
      return {
        slotId: "orchestrator_cpu",
        reason: "Orchestrator-Slot für Intent-Routing und Function-Calling",
        alternativeSlotId: "quality_cpu"
      };
    }

    if (
      normalizedTaskType.includes("code") ||
      normalizedTaskType.includes("debug") ||
      normalizedTaskType.includes("review") ||
      normalizedTaskType.includes("plan") ||
      normalizedTaskType.includes("architecture")
    ) {
      return {
        slotId: "fast_gpu",
        reason: "GPU-Slot für Coding, Review, Plan und Debug",
        alternativeSlotId: "quality_cpu"
      };
    }

    if (normalizedTaskType.includes("chat")) {
      return {
        slotId: "quality_cpu",
        reason: "CPU-Slot für Chat",
        alternativeSlotId: "fast_gpu"
      };
    }

    emitRoutingEvent("slot_recommended", { taskType: normalizedTaskType, slotId: "quality_cpu", reason: "default" });
    return {
      slotId: "quality_cpu",
      reason: "Default: CPU-Slot für allgemeine Anfragen",
      alternativeSlotId: "fast_gpu"
    };
  },

  /**
   * Prüft ob ein Slot bereit ist.
   */
  isSlotReady(status: RuntimeSlotStatus | null): boolean {
    return status !== null &&
           status.state === "running" &&
           status.chat_ready === true;
  },

  /**
   * Auto-Start: Startet empfohlene Slots wenn nötig.
   */
  async autoStartSlots(
    taskType?: string,
    forceSlotId?: RuntimeSlotId
  ): Promise<SlotOperationResult[]> {
    const settings = useSettingsStore.getState().settings;
    // Lazy Runtime Loading: mount/panel auto-start must not load work models unless explicitly enabled.
    if (!forceSlotId && !settings.autoStartChatRuntime && !settings.autoStartCodingRuntime) {
      console.log("[SlotManager] Auto-Start übersprungen (Lazy Runtime Loading)");
      return [];
    }

    const results: SlotOperationResult[] = [];

    // Empfohlenen Slot bestimmen
    const recommendation = forceSlotId
      ? { slotId: forceSlotId, reason: "Manuell ausgewählt" }
      : taskType
        ? this.getRecommendedSlot(taskType)
        : { slotId: "quality_cpu" as RuntimeSlotId, reason: "Default" };

    // Status prüfen
    const status = await this.getSlotStatus(recommendation.slotId);

    // Bereits bereit?
    if (this.isSlotReady(status)) {
      console.log(`[SlotManager] Slot ${recommendation.slotId} bereits bereit`);
      return results;
    }

    // Modell-ID bestimmen (Default für Slot)
    const defaultModelId = await this.resolveDefaultModelForSlot(recommendation.slotId);

    // Starten
    console.log(`[SlotManager] Auto-Start ${recommendation.slotId}: ${defaultModelId}`);
    const result = await this.startSlot(recommendation.slotId, defaultModelId);
    results.push(result);

    return results;
  },

  /**
   * Holt Default-Modell für einen Slot.
   */
  getDefaultModelForSlot(slotId: RuntimeSlotId): string {
    return configuredModelForSlot(slotId);
  },

  /**
   * Löst einen gewünschten Modellnamen oder Slot-Default auf die echte IndexedModel.id auf.
   */
  async resolveModelId(requestedModelId: string, fallbackSlotId: RuntimeSlotId = "quality_cpu"): Promise<string> {
    const index = await backendClient.getModelIndex();
    const requestedModel = index.models.find((model) => matchesModelKey(model, requestedModelId));
    if (requestedModel && isRunnableLocalModel(requestedModel)) {
      return requestedModel.id;
    }

    if (requestedModelId.trim()) {
      throw new Error(`Modell '${requestedModelId}' ist nicht lauffähig oder nicht im Index vorhanden.`);
    }

    const fallbackModel = selectDefaultModelForSlot(index.models, fallbackSlotId);
    if (fallbackModel) {
      return fallbackModel.id;
    }

    throw new Error(`Kein lauffähiges lokales Modell für Slot ${fallbackSlotId} gefunden.`);
  },

  /**
   * Holt das beste echte IndexedModel.id-Default für einen Slot.
   *
   * Wenn kein Rollenmodell in den Settings konfiguriert ist, fragt dies zuerst
   * den Backend-FleetRoutingResolver (einzige Routing-Wahrheit, WF-01/WF-10) statt
   * direkt auf die lokale Scoring-Heuristik in resolveModelId()/selectDefaultModelForSlot()
   * zu springen. Diese lokale Heuristik bleibt nur als Notfall-Fallback bestehen, wenn das
   * Backend nicht erreichbar ist — dieser Fallback wird immer sichtbar geloggt, nie still.
   */
  async resolveDefaultModelForSlot(slotId: RuntimeSlotId): Promise<string> {
    const configuredDefault = this.getDefaultModelForSlot(slotId);
    if (configuredDefault.trim()) {
      return this.resolveModelId(configuredDefault, slotId);
    }

    if (backendClient.resolveRuntimeRoute) {
      try {
        const response = await backendClient.resolveRuntimeRoute({
          task_type: taskTypeForSlotFallback(slotId),
          requires_vision: slotId === "vision_gpu"
        });
        if (response.resolved_model_id) {
          emitRoutingEvent("slot_default_resolved_via_backend", {
            slotId,
            modelId: response.resolved_model_id,
            selectionSource: response.selection_source
          });
          return response.resolved_model_id;
        }
      } catch (error) {
        emitRoutingEvent("slot_default_backend_unavailable_local_fallback", {
          slotId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return this.resolveModelId(configuredDefault, slotId);
  },

  /**
   * Wartet bis ein Slot bereit ist.
   */
  async waitForSlotReady(
    slotId: RuntimeSlotId,
    timeoutMs: number = 30000,
    pollIntervalMs: number = 1000
  ): Promise<RuntimeSlotStatus | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getSlotStatus(slotId);

      if (this.isSlotReady(status)) {
        console.log(`[SlotManager] Slot ${slotId} ist bereit`);
        return status;
      }

      if (status && status.state === "error") {
        console.error(`[SlotManager] Slot ${slotId} Fehler:`, status.error_message);
        return null;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    console.error(`[SlotManager] Timeout für Slot ${slotId}`);
    return null;
  },

  /**
   * Mini inference warm-up via Codee backend → llama-server.
   * Never call llama-server directly from the Electron renderer.
   */
  async warmupInference(
    slotId: RuntimeSlotId,
    modelId: string,
    timeoutMs: number = 45_000,
    signal?: AbortSignal,
    decisionId?: string
  ): Promise<WarmupResult> {
    if (!modelId.trim()) {
      return {
        ok: false,
        status: "failed",
        error: "binding_mismatch",
        detail: "Warm-up benötigt eine gebundene Modell-ID."
      };
    }

    const backendUrl = await resolveBackendUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(`${backendUrl}/runtime/slots/${slotId}/warmup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model_id: modelId,
          decision_id: decisionId ?? null,
          timeout_ms: timeoutMs
        })
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          ok: false,
          status: "failed",
          error: "warmup_http_failed",
          detail: `Warm-up Backend HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`
        };
      }

      const data = (await response.json()) as {
        ok?: boolean;
        outcome?: string;
        detail?: string | null;
        model_id?: string;
        model_name?: string | null;
        slot_id?: string;
        elapsed_ms?: number;
        readiness_stage?: string | null;
        diagnostics?: {
          process_start_ms?: number;
          endpoint_ready_ms?: number;
          model_load_ms?: number;
          prompt_eval_ms?: number;
          first_token_ms?: number;
          total_warmup_ms?: number;
          token_count?: number;
          finish_reason?: string | null;
          readiness_stage?: string | null;
          stream_mode?: boolean;
          tool_call_detected?: boolean;
          endpoint?: string | null;
          api_mode?: string | null;
          request_method?: string | null;
          request_body?: string | null;
          http_status?: number | null;
          content_type?: string | null;
          response_headers?: Record<string, string> | null;
          stream_events?: string[] | null;
          parser_decision?: string | null;
          chat_template_used?: string | null;
          stop_sequences_used?: string[] | null;
          max_tokens?: number | null;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          raw_response_preview?: string | null;
          stderr_tail?: string | null;
        } | null;
      };

      const mapDiagnostics = (): RuntimeWarmupDiagnostics | undefined => {
        if (!data.diagnostics) return undefined;
        return {
          endpoint: data.diagnostics.endpoint ?? undefined,
          apiMode: data.diagnostics.api_mode ?? undefined,
          requestMethod: data.diagnostics.request_method ?? undefined,
          requestBody: data.diagnostics.request_body ?? undefined,
          httpStatus: data.diagnostics.http_status ?? undefined,
          contentType: data.diagnostics.content_type ?? undefined,
          responseHeaders: data.diagnostics.response_headers ?? undefined,
          streamEvents: data.diagnostics.stream_events ?? undefined,
          parserDecision: data.diagnostics.parser_decision ?? undefined,
          chatTemplateUsed: data.diagnostics.chat_template_used ?? undefined,
          stopSequencesUsed: data.diagnostics.stop_sequences_used ?? undefined,
          maxTokens: data.diagnostics.max_tokens ?? undefined,
          promptTokens: data.diagnostics.prompt_tokens ?? undefined,
          completionTokens: data.diagnostics.completion_tokens ?? undefined,
          processStartMs: data.diagnostics.process_start_ms ?? 0,
          endpointReadyMs: data.diagnostics.endpoint_ready_ms ?? 0,
          modelLoadMs: data.diagnostics.model_load_ms ?? 0,
          promptEvalMs: data.diagnostics.prompt_eval_ms ?? 0,
          firstTokenMs: data.diagnostics.first_token_ms ?? 0,
          totalWarmupMs: data.diagnostics.total_warmup_ms ?? data.elapsed_ms ?? 0,
          tokenCount: data.diagnostics.token_count ?? 0,
          finishReason: data.diagnostics.finish_reason ?? undefined,
          streamMode: data.diagnostics.stream_mode,
          toolCallDetected: data.diagnostics.tool_call_detected,
          rawResponsePreview: data.diagnostics.raw_response_preview ?? undefined,
          stderrTail: data.diagnostics.stderr_tail ?? undefined,
          readinessStage:
            (data.diagnostics.readiness_stage as RuntimeReadinessStage | null) ??
            (data.readiness_stage as RuntimeReadinessStage | null) ??
            undefined
        };
      };

      if (!data.ok) {
        const outcome = data.outcome ?? "warmup_http_failed";
        const detailParts = [
          data.detail?.trim() || null,
          `Outcome: ${outcome}`,
          data.model_id ? `Model: ${data.model_id}` : null,
          data.readiness_stage ? `Stage: ${data.readiness_stage}` : null
        ].filter(Boolean);
        return {
          ok: false,
          status: "failed",
          error: outcome,
          detail: detailParts.join(" | "),
          readinessStage: data.readiness_stage ?? undefined,
          diagnostics: mapDiagnostics()
        };
      }

      const tokenCount = data.diagnostics?.token_count;
      const detailOk = Boolean(data.detail?.trim());
      const tokenVerified =
        data.outcome === "inference_ready" &&
        (typeof tokenCount === "number"
          ? tokenCount >= 1
          : detailOk); // legacy backends without diagnostics still return content in detail

      if (!tokenVerified) {
        return {
          ok: false,
          status: "failed",
          error: "warmup_empty_response",
          detail:
            data.detail?.trim() ||
            "Warm-up ohne verifiziertes Token — Streaming nicht als bereit markiert.",
          readinessStage: data.readiness_stage ?? "endpoint_reachable",
          diagnostics: mapDiagnostics()
        };
      }

      emitRoutingEvent("runtime_inference_ready", {
        slotId,
        modelId,
        preview: data.detail?.slice(0, 32) ?? "OK",
        elapsedMs: data.elapsed_ms ?? null,
        readinessStage: data.readiness_stage ?? "inference_ready",
        firstTokenMs: data.diagnostics?.first_token_ms ?? null,
        streamMode: data.diagnostics?.stream_mode ?? null
      });
      return {
        ok: true,
        status: "ready",
        detail: data.detail?.slice(0, 64) ?? "OK",
        readinessStage: (data.readiness_stage as RuntimeReadinessStage | undefined) ?? "inference_ready",
        diagnostics: mapDiagnostics()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = /abort/i.test(message) || signal?.aborted;
      if (aborted) {
        return {
          ok: false,
          status: "failed",
          error: "warmup_timeout",
          detail: `Warm-up Timeout nach ${timeoutMs}ms`
        };
      }
      return {
        ok: false,
        status: "failed",
        error: "warmup_http_failed",
        detail: `Warm-up konnte Backend nicht erreichen. Backend: ${backendUrl} | ${message}`
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  },

  /**
   * Postet ein Health-/Failure-Event fuer einen Slot in die persistente Historie
   * (Plan 15, Phase 6). Fire-and-forget und fehlertolerant: ein Fehlschlag hier
   * darf die aufrufende Restart-/Recovery-Logik nie unterbrechen, deshalb wird
   * nie geworfen — nur geloggt.
   */
  async recordSlotHealthEvent(
    slotId: RuntimeSlotId,
    eventType: RuntimeSlotHealthEventType,
    options?: { modelId?: string | null; detail?: string }
  ): Promise<void> {
    try {
      const backendUrl = await resolveBackendUrl();
      await fetch(`${backendUrl}/runtime/slots/${slotId}/health-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot_id: slotId,
          model_id: options?.modelId ?? null,
          event_type: eventType,
          detail: options?.detail ?? ""
        })
      });
    } catch (error) {
      console.warn(`[RuntimeSlotManager] Health-Event fuer ${slotId} konnte nicht gespeichert werden:`, error);
    }
  },

  /**
   * Liest die persistente Health-/Failure-Historie eines Slots (Plan 15, Phase 6).
   * Liefert bei Fehlern eine leere Liste statt zu werfen — die "Verlauf"-Sektion
   * soll nie den gesamten RuntimeSlotPanel zum Absturz bringen.
   */
  async listSlotHealthEvents(slotId: RuntimeSlotId, limit = 50): Promise<RuntimeSlotHealthEvent[]> {
    try {
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/runtime/slots/${slotId}/health-events?limit=${limit}`);
      if (!response.ok) return [];
      return (await response.json()) as RuntimeSlotHealthEvent[];
    } catch {
      return [];
    }
  }
};
