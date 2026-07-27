import type {
  EmbeddingProvider,
  MemoryRecord,
  MemoryScope
} from "@/runtime/memory/memoryContracts";

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface MemoryExtractionInput {
  workspaceRoot: string;
  scope: MemoryScope;
  content: string;
  tags?: string[];
}

export class MemoryExtractionPipeline {
  constructor(private readonly embeddings: EmbeddingProvider) {}

  async extract(input: MemoryExtractionInput): Promise<MemoryRecord> {
    const now = new Date().toISOString();
    const embedding = await this.embeddings.embed(input.content);

    return {
      id: createId("mem"),
      scope: input.scope,
      workspaceRoot: input.workspaceRoot,
      content: input.content,
      tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
      embedding,
      createdAt: now,
      updatedAt: now
    };
  }
}
