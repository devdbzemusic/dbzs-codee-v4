import { backendClient } from "@/services/backendClient";
import type {
  ContextPrepareRequest,
  ContextPrepareResponse,
  ToolCatalogResponse,
  ToolExecutionRequest,
  ToolExecutionResponse
} from "@/types/orchestration";

export const orchestrationClient = {
  listTools: (): Promise<ToolCatalogResponse> =>
    backendClient.listOrchestrationTools(),
  prepareContext: (request: ContextPrepareRequest): Promise<ContextPrepareResponse> =>
    backendClient.prepareOrchestrationContext(request),
  executeTool: (request: ToolExecutionRequest): Promise<ToolExecutionResponse> =>
    backendClient.executeOrchestrationTool(request)
};

export function shouldRunWorkspaceListTool(content: string): boolean {
  return /struktur|dateien|ordner|verzeichnis|workspace|projekt|tree|übersicht|uebersicht/i.test(content);
}

export function formatToolResultForContext(response: ToolExecutionResponse): string {
  const outputPreview = JSON.stringify(response.output, null, 2).slice(0, 4000);
  return [
    `[Tool ${response.tool_id}]`,
    `Status: ${response.status}`,
    response.message,
    "Output:",
    outputPreview
  ].join("\n");
}
