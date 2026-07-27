import type { ContextPack, ContextRequest } from "@dbzs/shared";
import { useSettingsStore } from "@/stores/settingsStore";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8876";

export class ContextOrchestratorService {
  constructor(private readonly backendUrl?: string) {}

  async build(request: ContextRequest, signal?: AbortSignal): Promise<ContextPack> {
    const backendUrl = this.backendUrl ?? useSettingsStore.getState().settings.backendUrl ?? DEFAULT_BACKEND_URL;
    const response = await fetch(`${backendUrl}/context/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[CONTEXT_BUILD_FAILED] ${response.status}: ${body}`);
    }
    return response.json() as Promise<ContextPack>;
  }
}

export const contextOrchestrator = new ContextOrchestratorService();
