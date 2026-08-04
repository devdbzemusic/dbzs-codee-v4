// UNUSED — ModelSelectionDecision.providerId is hardcoded to "llama-cpp" in modelSelectionBroker.ts,
// the sole router Runtime Chat uses. The ollama/openAi/anthropic providers below are not reachable
// from that path (only referenced transitively via modelRegistryService.ts -> modelRouterService.ts,
// itself a shadow-mode-only legacy comparison helper). Do not consume ALL_MODEL_PROVIDERS for live routing.
import type {
  AppSettings,
  ModelCapability,
  ModelProviderId,
  RegisteredModel,
  RuntimeChatRequest,
  RuntimeChatResponse
} from "@dbzs/shared";
import { backendClient } from "./backendClient";

export interface ModelProvider {
  id: ModelProviderId;
  isLocal: boolean;
  isEnabled: (settings: AppSettings) => boolean;
  healthCheck: (settings: AppSettings) => Promise<boolean>;
  listModels: (settings: AppSettings) => Promise<RegisteredModel[]>;
  sendChat: (settings: AppSettings, modelId: string, request: RuntimeChatRequest) => Promise<RuntimeChatResponse>;
}

interface OllamaTagResponse {
  models?: Array<{
    name?: string;
    model?: string;
    details?: {
      families?: string[];
    };
  }>;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function inferCapabilities(modelName: string): ModelCapability[] {
  const lowered = modelName.toLowerCase();
  const capabilities: ModelCapability[] = ["chat"];

  if (lowered.includes("coder") || lowered.includes("code") || lowered.includes("deepseek-coder")) {
    capabilities.push("code");
  }
  if (lowered.includes("vision") || lowered.includes("vl") || lowered.includes("llava")) {
    capabilities.push("vision");
  }
  if (lowered.includes("r1") || lowered.includes("reason")) {
    capabilities.push("reasoning");
  }

  return [...new Set(capabilities)];
}

function inferOpenAiCapabilities(modelId: string): ModelCapability[] {
  const lower = modelId.toLowerCase();
  const caps: ModelCapability[] = ["chat", "code"];
  if (lower.includes("gpt-4o") || lower.includes("vision")) {
    caps.push("vision");
  }
  if (lower.startsWith("o1") || lower.startsWith("o3") || lower.includes("reason")) {
    caps.push("reasoning");
  }
  return [...new Set(caps)];
}

// ---------------------------------------------------------------------------
// llama.cpp — routes through the backend proxy (llama-server port is dynamic)
// ---------------------------------------------------------------------------

export const llamaCppProvider: ModelProvider = {
  id: "llama-cpp",
  isLocal: true,
  isEnabled: (_settings) => true,
  healthCheck: async (_settings) => {
    try {
      const index = await backendClient.getModelIndex();
      return index.models.some((m) => m.runtime_launcher === "llama-server");
    } catch {
      return false;
    }
  },
  listModels: async (_settings) => {
    try {
      const index = await backendClient.getModelIndex();
      return index.models
        .filter((m) => m.runtime_launcher === "llama-server")
        .map((m) => ({
          id: `llama-cpp:${m.id}`,
          providerId: "llama-cpp" as const,
          name: m.name,
          capabilities: ((m.capabilities as ModelCapability[] | undefined) ?? ["chat"]),
          isLocal: true,
          enabled: true
        } satisfies RegisteredModel));
    } catch {
      return [];
    }
  },
  sendChat: async (_settings, modelId, request) => {
    const cleanModelId = modelId.startsWith("llama-cpp:") ? modelId.slice("llama-cpp:".length) : modelId;
    return backendClient.sendRuntimeChat({
      ...request,
      model_id: cleanModelId
    });
  }
};

// ---------------------------------------------------------------------------
// Ollama — direct HTTP to local Ollama instance
// ---------------------------------------------------------------------------

export const ollamaProvider: ModelProvider = {
  id: "ollama",
  isLocal: true,
  isEnabled: (settings) => settings.ollamaBaseUrl.trim().length > 0,
  healthCheck: async (settings) => {
    const baseUrl = normalizeBaseUrl(settings.ollamaBaseUrl);
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  },
  listModels: async (settings) => {
    const baseUrl = normalizeBaseUrl(settings.ollamaBaseUrl);
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return [];

      const payload = (await response.json()) as OllamaTagResponse;
      const models = payload.models ?? [];

      return models.flatMap((model) => {
        const rawName = model.name ?? model.model ?? "";
        const name = rawName.trim();
        if (!name) return [];
        return [
          {
            id: `ollama:${name}`,
            providerId: "ollama" as const,
            name,
            capabilities: inferCapabilities(name),
            isLocal: true,
            enabled: true
          } satisfies RegisteredModel
        ];
      });
    } catch {
      return [];
    }
  },
  sendChat: async (settings, modelId, request) => {
    const baseUrl = normalizeBaseUrl(settings.ollamaBaseUrl);
    const normalizedModelName = modelId.startsWith("ollama:") ? modelId.slice("ollama:".length) : modelId;

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: normalizedModelName,
        messages: request.messages,
        stream: false,
        options: { temperature: request.temperature ?? 0.2 }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama-Anfrage fehlgeschlagen (${response.status})`);
    }

    const payload = (await response.json()) as {
      message?: { role?: "assistant" | "user" | "system"; content?: string };
      model?: string;
    };

    return {
      message: {
        id: `msg-${Date.now().toString(36)}-ollama`,
        role: payload.message?.role ?? "assistant",
        content: payload.message?.content ?? ""
      },
      model_id: modelId,
      model_name: payload.model ?? normalizedModelName
    };
  }
};

// ---------------------------------------------------------------------------
// OpenAI — direct HTTPS to api.openai.com (Electron allows cross-origin)
// ---------------------------------------------------------------------------

interface OpenAiModelListResponse {
  data?: Array<{ id?: string }>;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { role?: string; content?: string } }>;
  model?: string;
}

export const openAiProvider: ModelProvider = {
  id: "openai",
  isLocal: false,
  isEnabled: (settings) => settings.cloudModelsEnabled && settings.openaiApiKey.trim().length > 0,
  healthCheck: async (settings) => {
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${settings.openaiApiKey.trim()}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  },
  listModels: async (settings) => {
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${settings.openaiApiKey.trim()}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return [];

      const payload = (await response.json()) as OpenAiModelListResponse;
      const models = payload.data ?? [];

      return models.flatMap((m) => {
        const id = (m.id ?? "").trim();
        if (!id) return [];
        const lower = id.toLowerCase();
        if (!lower.startsWith("gpt-") && !lower.startsWith("o1") && !lower.startsWith("o3")) {
          return [];
        }
        return [
          {
            id: `openai:${id}`,
            providerId: "openai" as const,
            name: id,
            capabilities: inferOpenAiCapabilities(id),
            isLocal: false,
            enabled: true
          } satisfies RegisteredModel
        ];
      });
    } catch {
      return [];
    }
  },
  sendChat: async (settings, modelId, request) => {
    const normalizedModel = modelId.startsWith("openai:") ? modelId.slice("openai:".length) : modelId;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.openaiApiKey.trim()}`
      },
      body: JSON.stringify({
        model: normalizedModel,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.max_tokens ?? 1024
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`OpenAI-Anfrage fehlgeschlagen (${response.status}): ${errText}`);
    }

    const payload = (await response.json()) as OpenAiChatResponse;
    const msg = payload.choices?.[0]?.message;

    return {
      message: {
        id: `msg-${Date.now().toString(36)}-anthropic`,
        role: (msg?.role as "assistant") ?? "assistant",
        content: msg?.content ?? ""
      },
      model_id: modelId,
      model_name: payload.model ?? normalizedModel
    };
  }
};

// ---------------------------------------------------------------------------
// Anthropic — direct HTTPS to api.anthropic.com (Electron allows cross-origin)
// ---------------------------------------------------------------------------

interface AnthropicMessageResponse {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
}

const ANTHROPIC_CURATED_MODELS: Array<{ id: string; name: string; capabilities: ModelCapability[] }> = [
  { id: "claude-sonnet-4-6",          name: "Claude Sonnet 4.6",      capabilities: ["chat", "code", "reasoning"] },
  { id: "claude-haiku-4-5-20251001",  name: "Claude Haiku 4.5",       capabilities: ["chat", "code"] },
  { id: "claude-opus-4-8",            name: "Claude Opus 4.8",        capabilities: ["chat", "code", "reasoning"] },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet",      capabilities: ["chat", "code", "vision"] },
  { id: "claude-3-5-haiku-20241022",  name: "Claude 3.5 Haiku",       capabilities: ["chat", "code"] }
];

export const anthropicProvider: ModelProvider = {
  id: "anthropic",
  isLocal: false,
  isEnabled: (settings) => settings.cloudModelsEnabled && settings.anthropicApiKey.trim().length > 0,
  healthCheck: async (settings) => {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.anthropicApiKey.trim(),
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "Hi" }]
        }),
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  },
  listModels: async (_settings) => {
    return ANTHROPIC_CURATED_MODELS.map((m) => ({
      id: `anthropic:${m.id}`,
      providerId: "anthropic" as const,
      name: m.name,
      capabilities: m.capabilities,
      isLocal: false,
      enabled: true
    } satisfies RegisteredModel));
  },
  sendChat: async (settings, modelId, request) => {
    const normalizedModel = modelId.startsWith("anthropic:") ? modelId.slice("anthropic:".length) : modelId;

    const systemParts = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const conversationMessages = request.messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: normalizedModel,
      max_tokens: request.max_tokens ?? 1024,
      messages: conversationMessages,
      temperature: request.temperature ?? 0.2
    };
    if (systemParts) {
      body.system = systemParts;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.anthropicApiKey.trim(),
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Anthropic-Anfrage fehlgeschlagen (${response.status}): ${errText}`);
    }

    const payload = (await response.json()) as AnthropicMessageResponse;
    const textBlock = payload.content?.find((c) => c.type === "text");

    return {
      message: {
        id: `msg-${Date.now().toString(36)}-anthropic`,
        role: "assistant",
        content: textBlock?.text ?? ""
      },
      model_id: modelId,
      model_name: payload.model ?? normalizedModel
    };
  }
};

// ---------------------------------------------------------------------------
// Registry — lokal-first Reihenfolge
// ---------------------------------------------------------------------------

export const ALL_MODEL_PROVIDERS: ModelProvider[] = [
  llamaCppProvider,
  ollamaProvider,
  openAiProvider,
  anthropicProvider
];




