/*
 * DBZS – Division By Zeros
 * Datei: runtimeBootstrap.ts
 * Bereich: Desktop Services / Runtime Bootstrap
 *
 * Zweck:
 *   Initialisiert Tool-Kernel/MCP ohne Arbeitsmodelle zu starten.
 *   Explizites Vorladen nur über preloadSelectedRuntime().
 *
 * Warum:
 *   Lazy Runtime Loading: Chat/Coding/Vision erst nach Routing+Budget.
 *
 * Wozu:
 *   Verhindert Autostart von Arbeitsmodellen beim App-/Chat-Öffnen.
 */

import type { RuntimeSlotId } from "@dbzs/shared";
import { approvalHub } from "@/services/approvalHub";
import { bootstrapMockMcpTools, createDefaultMcpClient } from "@/services/mcp/mcpClient";
import { runtimeSlotManager } from "./runtimeSlotManager";
import {
  ensureRuntimeKernelInitialized,
  registerRuntimeToolProvider,
  setRuntimeToolApprovalCallback
} from "@/services/runtimeKernelService";

let runtimeLayerBootstrapped = false;

/** Tool kernel + MCP only — never starts chat/coding/vision slots. */
export async function bootstrapRuntimeLayer(): Promise<void> {
  if (runtimeLayerBootstrapped) {
    return;
  }

  setRuntimeToolApprovalCallback((actorId, toolName, reason, inputSnapshot, workspaceRoot) =>
    approvalHub.requestToolApproval(actorId, toolName, reason, inputSnapshot, workspaceRoot)
  );

  await ensureRuntimeKernelInitialized();

  const mcpClient = createDefaultMcpClient();
  await bootstrapMockMcpTools(mcpClient, registerRuntimeToolProvider);

  runtimeLayerBootstrapped = true;
}

export function resetRuntimeLayerBootstrapForTests(): void {
  runtimeLayerBootstrapped = false;
}

export interface RuntimeBootstrapConfig {
  /** Default false: never auto-start work models on boot. */
  autoStartOnBoot: boolean;
  chatModelId: string;
  codingModelId: string;
  chatSlotId: RuntimeSlotId;
  codingSlotId: RuntimeSlotId;
  chatPort: number;
  codingPort: number;
  startupTimeoutMs: number;
}

export const DEFAULT_BOOTSTRAP_CONFIG: RuntimeBootstrapConfig = {
  autoStartOnBoot: false,
  chatModelId: "Meta-Llama-3.1-8B-Instruct-Q4_K_M",
  codingModelId: "Llama-3.2-3B-CodeReactor-Q8_0",
  chatSlotId: "quality_cpu",
  codingSlotId: "fast_gpu",
  chatPort: 8081,
  codingPort: 8082,
  startupTimeoutMs: 60000
};

export interface BootstrapSlotState {
  slotId: RuntimeSlotId;
  modelId: string;
  port: number;
  started: boolean;
  ready: boolean;
  error?: string;
}

export interface BootstrapStatus {
  state: "idle" | "starting" | "ready" | "error" | "partial";
  chatSlot?: BootstrapSlotState;
  codingSlot?: BootstrapSlotState;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export class RuntimeBootstrapService {
  private config: RuntimeBootstrapConfig;
  private status: BootstrapStatus = { state: "idle" };

  constructor(config: Partial<RuntimeBootstrapConfig> = {}) {
    this.config = { ...DEFAULT_BOOTSTRAP_CONFIG, ...config };
  }

  getStatus(): BootstrapStatus {
    return { ...this.status };
  }

  /**
   * Legacy dual-slot boot. Disabled by default (autoStartOnBoot=false).
   * Do not call from App/Workspace/Chat init — use preloadSelectedRuntime for manual preload.
   */
  async startAll(): Promise<BootstrapStatus> {
    if (!this.config.autoStartOnBoot) {
      this.status = {
        state: "idle",
        error: "Auto-Start ist deaktiviert (Lazy Runtime Loading)"
      };
      return this.status;
    }

    this.status = {
      state: "starting",
      startedAt: new Date().toISOString()
    };

    const [chatResult, codingResult] = await Promise.allSettled([
      this.startPrimarySlot(this.config.chatSlotId, this.config.chatModelId, this.config.chatPort),
      this.startPrimarySlot(this.config.codingSlotId, this.config.codingModelId, this.config.codingPort)
    ]);

    const errors: string[] = [];
    const chatSlot = this.unwrapSlotResult("Chat", chatResult, errors);
    const codingSlot = this.unwrapSlotResult("Coding", codingResult, errors);
    const anyReady = Boolean(chatSlot?.ready || codingSlot?.ready);
    const bothReady = Boolean(chatSlot?.ready && codingSlot?.ready);

    this.status = {
      ...this.status,
      chatSlot,
      codingSlot,
      completedAt: new Date().toISOString(),
      state: bothReady ? "ready" : anyReady ? "partial" : "error",
      error: errors.length > 0 ? errors.join("; ") : undefined
    };

    return this.status;
  }

  /** Explicit manual preload of a single slot — never called implicitly. */
  async preloadSelectedRuntime(
    slotId: RuntimeSlotId,
    modelId: string
  ): Promise<BootstrapSlotState> {
    return this.startPrimarySlot(slotId, modelId, 0);
  }

  private unwrapSlotResult(
    label: string,
    result: PromiseSettledResult<BootstrapSlotState>,
    errors: string[]
  ): BootstrapSlotState | undefined {
    if (result.status === "fulfilled") {
      return result.value;
    }

    errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    return undefined;
  }

  private async startPrimarySlot(
    slotId: RuntimeSlotId,
    requestedModelId: string,
    port: number
  ): Promise<BootstrapSlotState> {
    const modelId = await runtimeSlotManager.resolveModelId(requestedModelId, slotId);
    const currentStatus = await runtimeSlotManager.getSlotStatus(slotId);

    if (runtimeSlotManager.isSlotReady(currentStatus) && currentStatus?.model_id === modelId) {
      return {
        slotId,
        modelId,
        port: currentStatus.port ?? port,
        started: true,
        ready: true
      };
    }

    if (currentStatus?.state === "running" && currentStatus.model_id && currentStatus.model_id !== modelId) {
      await runtimeSlotManager.stopSlot(slotId);
    }

    const result = await runtimeSlotManager.startSlot(slotId, modelId);
    if (!result.success) {
      throw new Error(result.error ?? `Start fehlgeschlagen für ${slotId}`);
    }

    const ready = await runtimeSlotManager.waitForSlotReady(slotId, this.config.startupTimeoutMs);
    if (!ready) {
      throw new Error(`Timeout: ${slotId} wurde nicht bereit`);
    }

    return {
      slotId,
      modelId,
      port: ready.port ?? port,
      started: true,
      ready: true
    };
  }

  async stopAll(): Promise<void> {
    console.log("[Bootstrap] Stoppe Chat- und Coding-Runtimes");

    for (const slotId of [this.config.chatSlotId, this.config.codingSlotId]) {
      try {
        await runtimeSlotManager.stopSlot(slotId);
      } catch (error) {
        console.warn(`[Bootstrap] Fehler beim Stoppen von ${slotId}:`, error);
      }
    }

    this.status = { state: "idle" };
  }

  reset(): void {
    this.status = { state: "idle" };
  }
}

export const runtimeBootstrap = new RuntimeBootstrapService();
