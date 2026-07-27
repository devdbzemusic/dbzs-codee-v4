import type { ToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import type { ToolDefinition, ToolName } from "@/runtime/tool/toolContracts";
import type { ToolsetId } from "@/runtime/tool/toolsets";

export interface ToolRegistryProvider {
  list(): ToolDefinition[];
}

export interface ListAvailableOptions {
  toolsets?: ToolsetId[];
  names?: ToolName[];
}

export class ToolRegistry {
  private readonly definitions = new Map<ToolName, ToolDefinition>();

  private readonly providers: ToolRegistryProvider[] = [];

  private generation = 0;

  register<TInput, TOutput>(definition: ToolDefinition<TInput, TOutput>): void {
    this.definitions.set(definition.name, definition as ToolDefinition);
    this.generation += 1;
  }

  registerProvider(provider: ToolRegistryProvider): () => void {
    this.providers.push(provider);
    for (const definition of provider.list()) {
      this.register(definition);
    }
    return () => {
      const index = this.providers.indexOf(provider);
      if (index >= 0) {
        this.providers.splice(index, 1);
      }
      for (const definition of provider.list()) {
        this.definitions.delete(definition.name);
      }
      this.generation += 1;
    };
  }

  getGeneration(): number {
    return this.generation;
  }

  get(name: ToolName): ToolDefinition {
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return definition;
  }

  has(name: ToolName): boolean {
    return this.definitions.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.definitions.values()].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  isAvailable(name: ToolName, ctx: ToolAvailabilityContext): boolean {
    const definition = this.definitions.get(name);
    if (!definition) {
      return false;
    }
    if (!definition.checkAvailability) {
      return true;
    }
    return definition.checkAvailability(ctx);
  }

  listAvailable(ctx: ToolAvailabilityContext, options?: ListAvailableOptions): ToolDefinition[] {
    const allowedToolsets = options?.toolsets ? new Set(options.toolsets) : null;
    const allowedNames = options?.names ? new Set(options.names) : null;

    return this.list().filter((definition) => {
      if (allowedToolsets && !allowedToolsets.has(definition.toolset)) {
        return false;
      }
      if (allowedNames && !allowedNames.has(definition.name)) {
        return false;
      }
      if (definition.checkAvailability && !definition.checkAvailability(ctx)) {
        return false;
      }
      return true;
    });
  }
}
