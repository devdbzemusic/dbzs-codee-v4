import type {
  FinalRequestTokenBudget,
  RuntimeChatRun,
  RuntimeRunOutcome,
  RuntimeTaskType,
  RuntimeSlotId
} from "@dbzs/shared";
import type { RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";
import type { RuntimeBindingDecision } from "@/services/runtimeBinding";
import type { ModelSelectionDecision } from "@/services/modelSelectionBroker";
import { BindingModelError } from "@/services/modelSelectionBroker";
import { appendRunEvent, updateRunStatus } from "@/services/runtimeChatRunHelpers";
import { handleResidentFallback } from "@/services/fallbackHandler";
import { verifySlotForRequest } from "@/services/runtimeSlotValidator";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";

export interface ExecuteOnDemandRuntimeActionResult {
  ok: boolean;
  routing: RuntimeChatRoutingInfo;
  contextSlotId: "quality_cpu" | "fast_gpu" | "utility";
  slotId: RuntimeSlotId;
  modelToStart: string;
  finalBudget: FinalRequestTokenBudget;
  resolvedContextWindowTokens: number | null;
}

export async function executeOnDemandRuntimeAction(input: {
  taskType: RuntimeTaskType;
  requestCapabilities: {
    requiresVision: boolean;
    hasImageInput: boolean;
  };
  activitySummary: {
    appendStepDetail: (id: string, line: string) => void;
    failStep: (id: string, label: string, detail: string) => void;
    finishStep: (id: string, label: string, detail: string) => void;
  };
  runtime: {
    routing: RuntimeChatRoutingInfo;
    bindingDecision: RuntimeBindingDecision;
    brokerDecisionFull: ModelSelectionDecision;
    contextSlotId: "quality_cpu" | "fast_gpu" | "utility";
    slotId: RuntimeSlotId;
    currentSlotStatus: Awaited<ReturnType<typeof runtimeSlotManager.getSlotStatus>>;
    modelToStart: string;
    launchProfile: "cpu_safe" | "hybrid" | "balanced" | "large_context" | "fast";
    slotNeedsStart: boolean;
    backendUrl: string;
    finalBudget: FinalRequestTokenBudget;
    resolvedContextWindowTokens: number | null;
  };
  controls: {
    assertStartStillValid: () => void;
    touchWorkModelActivity: () => void;
    runAbortSignal: AbortSignal;
    timeoutManager: {
      getEndpointReady: () => number;
      getModelLoad: () => number;
      getWarmup: () => number;
      getRouting: () => number;
    };
  };
  callbacks: {
    updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
    syncActiveRunBindingPatch: (patch: Partial<RuntimeChatRun>) => void;
    setLastRouting: (routing: RuntimeChatRoutingInfo) => void;
    handleFailure: (error: unknown, startedThisRun: boolean, contextSlotId: RuntimeSlotId) => Promise<boolean>;
  };
}): Promise<ExecuteOnDemandRuntimeActionResult> {
  const { taskType, requestCapabilities, activitySummary, controls, callbacks } = input;
  let {
    routing,
    bindingDecision,
    brokerDecisionFull,
    contextSlotId,
    slotId,
    currentSlotStatus,
    modelToStart,
    launchProfile,
    slotNeedsStart,
    backendUrl,
    finalBudget,
    resolvedContextWindowTokens
  } = input.runtime;

  let startedThisRun = false;

  try {
    if (slotNeedsStart) {
      const roleHint =
        taskType === "planning" || taskType === "architecture"
          ? "Planner wird bei Bedarf geladen …"
          : taskType === "review"
            ? "Review-Modell wird bei Bedarf geladen …"
            : requestCapabilities.requiresVision || requestCapabilities.hasImageInput
              ? "Visionmodell wird bei Bedarf geladen …"
              : "Arbeitsmodell wird bei Bedarf geladen …";
      activitySummary.appendStepDetail("runtime-ondemand", roleHint);
      callbacks.updateActiveRun((run) =>
        appendRunEvent(run, "runtime.check.started", roleHint, {
          startTrigger: "post_budget_ondemand",
          slotId,
          modelId: modelToStart,
          profile: launchProfile,
          reasons: brokerDecisionFull?.reason ?? (routing.routingPath ? [String(routing.routingPath)] : [])
        })
      );
      const startResult = await runtimeSlotManager.startSlot(slotId, modelToStart, launchProfile);
      if (!startResult.success) {
        throw new Error(`target_slot_ondemand_failed: ${startResult.error ?? "unknown"}`);
      }
      startedThisRun = true;
      controls.touchWorkModelActivity();

      const readyStatus = await runtimeSlotManager.waitForSlotReady(
        slotId,
        controls.timeoutManager.getEndpointReady() + controls.timeoutManager.getModelLoad()
      );
      controls.assertStartStillValid();
      if (!readyStatus) {
        throw new Error(`endpoint_ready_timeout: slot=${slotId}`);
      }
      callbacks.updateActiveRun((run) =>
        appendRunEvent(
          {
            ...run,
            readinessStage: "endpoint_reachable"
          },
          "runtime.check.completed",
          "runtime_endpoint_ready",
          {
            slotId,
            modelId: readyStatus.model_id ?? modelToStart,
            readinessStage: "endpoint_reachable"
          }
        )
      );

      routing = {
        ...routing,
        modelId: readyStatus.model_id ?? modelToStart,
        modelName: readyStatus.model_name ?? routing.modelName,
        providerId: readyStatus.provider === "llama.cpp" ? "llama-cpp" : routing.providerId
      };
      if (readyStatus.context_size) {
        resolvedContextWindowTokens = readyStatus.context_size;
        finalBudget = {
          ...finalBudget,
          runtimeContextLimit: readyStatus.context_size,
          overflowTokens: Math.max(0, finalBudget.totalRequiredTokens - readyStatus.context_size)
        };
        callbacks.updateActiveRun((run) => ({
          ...run,
          tokenBudget: finalBudget
        }));
      }
      callbacks.setLastRouting(routing);
      callbacks.syncActiveRunBindingPatch({
        provider: routing.providerId ?? undefined,
        modelId: routing.modelId ?? undefined,
        modelName: routing.modelName ?? undefined,
        slotId: routing.slotId ?? undefined,
        tokenBudget: finalBudget
      });
    } else {
      controls.assertStartStillValid();
      controls.touchWorkModelActivity();
    }

    activitySummary.appendStepDetail("runtime-ondemand", "Inference Warm-up …");
    controls.assertStartStillValid();
    const initialWarmupResult = await runtimeSlotManager.warmupInference(
      slotId,
      routing.modelId ?? modelToStart,
      controls.timeoutManager.getWarmup(),
      controls.runAbortSignal,
      bindingDecision.decisionId
    );
    controls.assertStartStillValid();

    const fallbackOutcome = await handleResidentFallback({
      initialWarmupResult,
      initialModelToStart: modelToStart,
      initialRoute: routing,
      currentStatus: currentSlotStatus,
      requiresVision: requestCapabilities.requiresVision,
      requiresTools: bindingDecision.protocolMode !== "none",
      signal: controls.runAbortSignal,
      updateActiveRun: callbacks.updateActiveRun,
      appendRunEvent
    });
    const warmupResult = fallbackOutcome.warmupResult;
    if (fallbackOutcome.fallbackInitiated) {
      modelToStart = fallbackOutcome.modelToStart;
      routing = {
        ...routing,
        ...fallbackOutcome.finalRoute,
        fallbackReason: fallbackOutcome.degradedReason ?? routing.fallbackReason ?? null
      };
      if (
        fallbackOutcome.finalRoute.slotId &&
        fallbackOutcome.finalRoute.slotId !== "orchestrator_cpu"
      ) {
        contextSlotId = fallbackOutcome.finalRoute.slotId;
        slotId = fallbackOutcome.finalRoute.slotId;
      }
      callbacks.setLastRouting(routing);
      callbacks.syncActiveRunBindingPatch({
        modelId: routing.modelId ?? undefined,
        modelName: routing.modelName ?? undefined,
        slotId: routing.slotId ?? undefined,
        selectionSource: routing.selectionSource ?? undefined,
        fallbackReason: routing.fallbackReason ?? undefined
      });
      callbacks.updateActiveRun((run) => ({
        ...run,
        selectionSource: routing.selectionSource ?? run.selectionSource,
        fallbackReason: routing.fallbackReason ?? run.fallbackReason,
        degraded: true,
        degradedReason: fallbackOutcome.degradedReason ?? run.degradedReason
      }));
    } else if (fallbackOutcome.fallbackRejection) {
      const fallbackRejection = fallbackOutcome.fallbackRejection;
      callbacks.updateActiveRun((run) =>
        appendRunEvent(
          { ...run, fallbackRejection },
          "runtime.fallback.initiated",
          `Fallback abgelehnt: ${fallbackRejection.reason}`,
          { modelId: fallbackRejection.modelId }
        )
      );
    }

    if (!warmupResult.ok) {
      routing = { ...routing, warmupStatus: "failed" };
      callbacks.setLastRouting(routing);
      callbacks.syncActiveRunBindingPatch({
        warmupStatus: "failed",
        warmupDiagnostics: warmupResult.diagnostics,
        error: {
          code: warmupResult.error === "runtime_oom" ? "runtime_oom" : "warmup_failed",
          message: warmupResult.detail ?? "Warm-up fehlgeschlagen",
          phase: "warmup"
        }
      });
      const roleLabel =
        taskType === "planning" || taskType === "architecture"
          ? "Plan"
          : taskType === "review"
            ? "Review"
            : taskType === "debugging"
              ? "Debug"
              : "Rollen";
      throw new BindingModelError(
        `Das konfigurierte ${roleLabel}-Modell konnte nicht inferenzbereit gestartet werden.${warmupResult.detail ? ` (${warmupResult.detail})` : ""}`,
        warmupResult.error === "runtime_oom" ? "runtime_oom" : "warmup_failed",
        [
          "A – dasselbe Modell mit kleinerem Runtime-Profil erneut versuchen",
          "B – ein anderes Rollenmodell auswählen",
          "C – abbrechen"
        ]
      );
    }

    routing = { ...routing, warmupStatus: "ready" };
    callbacks.setLastRouting(routing);
    callbacks.syncActiveRunBindingPatch({
      warmupStatus: "ready",
      provider: routing.providerId ?? undefined,
      modelId: routing.modelId ?? undefined,
      modelName: routing.modelName ?? undefined,
      slotId: routing.slotId ?? undefined
    });
    callbacks.updateActiveRun((run) => ({
      ...appendRunEvent(run, "runtime.check.completed", "runtime_inference_ready", {
        slotId,
        preview: warmupResult.detail,
        readinessStage: "inference_ready",
        tokenVerified: true
      }),
      warmupStatus: "ready",
      readinessStage: "inference_ready",
      warmupDiagnostics: warmupResult.diagnostics
    }));

    const validation = await verifySlotForRequest(
      backendUrl,
      slotId,
      routing.modelId ?? modelToStart,
      controls.timeoutManager.getRouting(),
      controls.runAbortSignal
    );
    controls.assertStartStillValid();
    if (!validation.ok) {
      throw new Error(validation.error || "Slot validation failed");
    }

    activitySummary.finishStep(
      "runtime-ondemand",
      "Arbeitsmodell laden",
      `Run-Modell: ${routing.modelName ?? routing.modelId} · Slot ${contextSlotId} · Warm-up: ready · Trigger: post_budget_ondemand`
    );
    callbacks.updateActiveRun((run) =>
      appendRunEvent(
        run,
        "runtime.check.completed",
        `On-Demand bereit: ${routing.modelName ?? routing.modelId}`,
        {
          startTrigger: "post_budget_ondemand",
          slotId: contextSlotId,
          modelId: routing.modelId,
          reasons: brokerDecisionFull?.reason ?? []
        }
      )
    );

    return {
      ok: true,
      routing,
      contextSlotId,
      slotId,
      modelToStart,
      finalBudget,
      resolvedContextWindowTokens
    };
  } catch (error) {
    activitySummary.failStep(
      "runtime-ondemand",
      "Arbeitsmodell laden",
      error instanceof BindingModelError
        ? `${error.message}${error.options.length ? ` Optionen: ${error.options.join(" · ")}` : ""}`
        : error instanceof Error
          ? error.message
          : "On-Demand-Start fehlgeschlagen"
    );
    await callbacks.handleFailure(error, startedThisRun, contextSlotId);
    return {
      ok: false,
      routing,
      contextSlotId,
      slotId,
      modelToStart,
      finalBudget,
      resolvedContextWindowTokens
    };
  }
}
