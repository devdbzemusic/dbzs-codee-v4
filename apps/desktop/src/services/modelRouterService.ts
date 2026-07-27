import type {
  AppSettings,
  ModelCapability,
  ModelTargetAgent,
  RegisteredModel
} from "@dbzs/shared";
import { modelRegistryService } from "@/services/modelRegistryService";

/**
 * Legacy helper for non-broker surfaces.
 * Must NOT prefer already-running models over configured role settings.
 * Runtime Chat should use modelSelectionBroker.brokerDecision exclusively.
 * Not reachable from the live decision path: the only production caller is
 * runtimeChatStoreRoutingPhase.ts's shadowMode comparison (legacySelected),
 * which never influences the actual routing outcome.
 */
function preferredModelForAgent(settings: AppSettings, agent: ModelTargetAgent): string {
  switch (agent) {
    case "planner":
      return settings.defaultPlannerModelId;
    case "coder":
      return settings.defaultCoderModelId || settings.defaultModelId;
    case "reviewer":
      return settings.defaultReviewerModelId;
    case "debugger":
      return settings.defaultDebugModelId;
    case "runtime_chat":
    default:
      return settings.defaultChatModelId || settings.defaultModelId;
  }
}

function capabilityForAgent(agent: ModelTargetAgent): ModelCapability {
  switch (agent) {
    case "coder":
    case "debugger":
      return "code";
    case "planner":
    case "reviewer":
    case "runtime_chat":
    default:
      return "chat";
  }
}

function cloudAllowed(settings: AppSettings): boolean {
  if (settings.safeMode) {
    return false;
  }
  if (settings.localOnlyModels) {
    return false;
  }

  return settings.cloudModelsEnabled;
}

export class ModelRouterService {
  selectModelForAgent(agent: ModelTargetAgent, settings: AppSettings): RegisteredModel | null {
    const preferredModelId = preferredModelForAgent(settings, agent);
    const requiredCapability = capabilityForAgent(agent);

    if (preferredModelId.trim().length > 0) {
      const preferred = modelRegistryService.getModelById(preferredModelId.trim());
      if (preferred && preferred.capabilities.includes(requiredCapability)) {
        if (preferred.isLocal) {
          return preferred;
        }
        if (cloudAllowed(settings)) {
          return preferred;
        }
      }
      // Prefer configured id even if registry metadata is incomplete.
      return {
        id: preferredModelId.trim(),
        providerId: "llama-cpp",
        name: preferredModelId.trim(),
        capabilities: [requiredCapability],
        isLocal: true,
        enabled: true
      };
    }

    const candidates = modelRegistryService
      .listAvailableModels(requiredCapability)
      .filter((model) => model.isLocal || cloudAllowed(settings));

    if (candidates.length === 0 && requiredCapability !== "chat") {
      const fallbackChat = modelRegistryService
        .listAvailableModels("chat")
        .filter((model) => model.isLocal || cloudAllowed(settings));
      return fallbackChat[0] ?? null;
    }

    const localCandidates = candidates.filter((model) => model.isLocal);
    if (settings.preferLocalModels && localCandidates.length > 0) {
      return localCandidates[0];
    }

    return candidates[0] ?? null;
  }
}

export const modelRouterService = new ModelRouterService();
