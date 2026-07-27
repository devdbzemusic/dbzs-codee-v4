import type { RuntimeEventBus } from "@/runtime/core/runtimeEventBus";
import { PermissionManager, type ApprovalCallback } from "@/runtime/tool/permissionManager";
import { BaseToolRequestSchema, type ToolName, type ToolRequest, type ToolResult } from "@/runtime/tool/toolContracts";
import { ToolExecutor } from "@/runtime/tool/toolExecutor";
import type { ToolAdapterBridge } from "@/runtime/tool/toolAdapterBridge";
import {
  BRIDGE_TOOL_METADATA,
  BUILTIN_TOOL_METADATA,
  metadataToToolDefinition
} from "@/runtime/tool/toolMetadata";
import { ToolRegistry } from "@/runtime/tool/toolRegistry";

export class ToolRuntime {
  readonly registry: ToolRegistry;

  readonly permissions: PermissionManager;

  readonly executor: ToolExecutor;

  constructor(
    eventBus: RuntimeEventBus,
    adapter: ToolAdapterBridge,
    approvalCallback?: ApprovalCallback
  ) {
    this.registry = new ToolRegistry();
    this.permissions = new PermissionManager(approvalCallback);
    this.executor = new ToolExecutor({
      registry: this.registry,
      permissions: this.permissions,
      adapter,
      eventBus
    });

    this.bootstrapDefaultTools();
  }

  cancel(requestId: string): boolean {
    return this.executor.cancel(requestId);
  }

  listTools(): ToolName[] {
    return this.registry.list().map((entry) => entry.name);
  }

  registerProvider(provider: import("@/runtime/tool/toolRegistry").ToolRegistryProvider): () => void {
    return this.registry.registerProvider(provider);
  }

  async run(request: ToolRequest): Promise<ToolResult> {
    BaseToolRequestSchema.parse(request);
    return this.executor.execute(request);
  }

  private bootstrapDefaultTools(): void {
    for (const entry of [...BUILTIN_TOOL_METADATA, ...BRIDGE_TOOL_METADATA]) {
      this.registry.register(metadataToToolDefinition(entry));
    }
  }
}
