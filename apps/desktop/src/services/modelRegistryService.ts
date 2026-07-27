import type {
  AppSettings,
  ModelCapability,
  ModelProviderId,
  RegisteredModel
} from "@dbzs/shared";
import { ALL_MODEL_PROVIDERS, type ModelProvider } from "@/services/modelProviders";

export class ModelRegistryService {
  private readonly providersById: Map<ModelProviderId, ModelProvider>;

  private models: RegisteredModel[] = [];

  constructor(providers: ModelProvider[] = ALL_MODEL_PROVIDERS) {
    this.providersById = new Map(providers.map((provider) => [provider.id, provider]));
  }

  getProvider(providerId: ModelProviderId): ModelProvider | null {
    return this.providersById.get(providerId) ?? null;
  }

  async refreshModels(settings: AppSettings): Promise<RegisteredModel[]> {
    const activeProviders = Array.from(this.providersById.values()).filter((provider) =>
      provider.isEnabled(settings)
    );

    const results = await Promise.all(
      activeProviders.map(async (provider) => {
        try {
          const healthy = await provider.healthCheck(settings);
          if (!healthy) {
            return [];
          }
          const models = await provider.listModels(settings);
          return models.filter((model) => model.enabled);
        } catch {
          return [];
        }
      })
    );

    this.models = results.flat();
    return this.models;
  }

  listAvailableModels(capability?: ModelCapability): RegisteredModel[] {
    if (!capability) {
      return [...this.models];
    }

    return this.models.filter((model) => model.capabilities.includes(capability));
  }

  getModelById(modelId: string): RegisteredModel | null {
    return this.models.find((model) => model.id === modelId) ?? null;
  }
}

export const modelRegistryService = new ModelRegistryService();
