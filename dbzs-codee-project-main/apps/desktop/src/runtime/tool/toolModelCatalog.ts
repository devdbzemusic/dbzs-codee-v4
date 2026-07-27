import type { ToolName } from "@/runtime/tool/toolContracts";
import { BUILTIN_TOOL_METADATA, getBuiltinMetadata } from "@/runtime/tool/toolMetadata";

export interface ToolModelDefinition {
  name: ToolName;
  modelDescription: string;
  inputSchema: Record<string, unknown>;
}

function compactSchemaSignature(schema: Record<string, unknown>): string {
  const rawProperties =
    schema && typeof schema === "object" && "properties" in schema
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required =
    schema && typeof schema === "object" && Array.isArray((schema as { required?: unknown }).required)
      ? new Set(((schema as { required: unknown[] }).required).filter((value): value is string => typeof value === "string"))
      : new Set<string>();

  const entries = Object.entries(rawProperties).slice(0, 6).map(([name, value]) => {
    const type =
      value && typeof value === "object" && "type" in value && typeof (value as { type?: unknown }).type === "string"
        ? (value as { type: string }).type
        : "any";
    return `${name}:${type}${required.has(name) ? "" : "?"}`;
  });
  if (Object.keys(rawProperties).length > entries.length) {
    entries.push(`+${Object.keys(rawProperties).length - entries.length} more`);
  }
  return entries.join(", ") || "no arguments";
}

export function listToolModelCatalog(): ToolModelDefinition[] {
  return BUILTIN_TOOL_METADATA.map((entry) => ({
    name: entry.name,
    modelDescription: entry.modelDescription,
    inputSchema: entry.inputSchema
  }));
}

export function getToolModelDefinition(name: ToolName): ToolModelDefinition | undefined {
  const entry = getBuiltinMetadata(name);
  if (!entry) {
    return undefined;
  }
  return {
    name: entry.name,
    modelDescription: entry.modelDescription,
    inputSchema: entry.inputSchema
  };
}

export function buildToolCatalogSystemPrompt(allowedNames?: ToolName[]): string {
  const entries = allowedNames
    ? listToolModelCatalog().filter((entry) => allowedNames.includes(entry.name))
    : listToolModelCatalog();

  const registryEntries = allowedNames ?? [];
  const fromRegistry = registryEntries
    .filter((name) => !entries.some((entry) => entry.name === name))
    .map((name) => getToolModelDefinition(name))
    .filter((entry): entry is ToolModelDefinition => Boolean(entry));

  const allEntries = [...entries, ...fromRegistry];

  const lines = [
    "[Tool Catalog]",
    "Wenn ein Tool nötig ist, gib nur genau einen Envelope ohne Markdown aus:",
    "<CODEE_TOOL_CALL>",
    '{"name":"read_file","arguments":{"path":"package.json"}}',
    "</CODEE_TOOL_CALL>",
    "Nach Tool-Ergebnissen weiterarbeiten; ohne Tool plain text antworten.",
    "Available tools:"
  ];

  for (const entry of allEntries) {
    lines.push(`- ${entry.name}: ${entry.modelDescription}`);
    lines.push(`  args: ${compactSchemaSignature(entry.inputSchema)}`);
  }

  return lines.join("\n");
}

export function toOllamaToolDefinitions(allowedNames?: ToolName[]): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  const names = allowedNames ?? listToolModelCatalog().map((entry) => entry.name);

  return names
    .map((name) => {
      const fromBuiltin = getBuiltinMetadata(name);
      if (fromBuiltin) {
        return {
          type: "function" as const,
          function: {
            name: fromBuiltin.name,
            description: fromBuiltin.modelDescription,
            parameters: fromBuiltin.inputSchema
          }
        };
      }
      return null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}
