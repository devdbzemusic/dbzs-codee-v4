import type { ToolDefinition, ToolName, ToolRequest } from "@/runtime/tool/toolContracts";
import { createMcpToolMetadata, metadataToToolDefinition } from "@/runtime/tool/toolMetadata";
import type { ToolRegistryProvider } from "@/runtime/tool/toolRegistry";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  url?: string;
  enabled: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpToolProvider implements ToolRegistryProvider {
  constructor(private readonly tools: McpToolDescriptor[], private readonly serverId: string) {}

  list(): ToolDefinition[] {
    return this.tools.map((tool) => {
      const toolName = `mcp_${this.serverId}_${tool.name}`.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
      const metadata = createMcpToolMetadata(toolName as ToolName, tool.description, tool.inputSchema);
      return metadataToToolDefinition(metadata);
    });
  }
}

export class McpClient {
  private readonly providers = new Map<string, () => void>();

  constructor(private readonly configs: McpServerConfig[]) {}

  listConfigs(): McpServerConfig[] {
    return this.configs.filter((entry) => entry.enabled);
  }

  registerTools(
    serverId: string,
    tools: McpToolDescriptor[],
    registerProvider: (provider: ToolRegistryProvider) => () => void
  ): void {
    this.providers.get(serverId)?.();
    const unregister = registerProvider(new McpToolProvider(tools, serverId));
    this.providers.set(serverId, unregister);
  }

  disconnect(serverId: string): void {
    this.providers.get(serverId)?.();
    this.providers.delete(serverId);
  }

  disconnectAll(): void {
    for (const serverId of [...this.providers.keys()]) {
      this.disconnect(serverId);
    }
  }
}

export const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  {
    id: "filesystem",
    name: "Filesystem (mock)",
    transport: "stdio",
    command: "mock-filesystem-mcp",
    enabled: true
  }
];

export function createDefaultMcpClient(): McpClient {
  return new McpClient(DEFAULT_MCP_SERVERS);
}

export async function bootstrapMockMcpTools(
  client: McpClient,
  registerProvider: (provider: ToolRegistryProvider) => () => void
): Promise<void> {
  client.registerTools(
    "filesystem",
    [
      {
        name: "list",
        description: "List workspace entries via MCP mock provider.",
        inputSchema: { type: "object", properties: { path: { type: "string" } } }
      }
    ],
    registerProvider
  );
}

export function buildMcpToolRequest(
  toolName: ToolName,
  workspaceRoot: string,
  input: Record<string, unknown>,
  actorId = "runtime-chat"
): ToolRequest {
  return {
    name: toolName,
    actorId,
    requestId: `mcp-${Date.now()}`,
    workspaceRoot,
    input
  };
}
