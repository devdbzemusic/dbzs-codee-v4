import type {
  EmbeddingProvider,
  MemoryRecord,
  MemoryRepository,
  MemoryScope,
  MemorySearchResult
} from "@/runtime/memory/memoryContracts";
import { MemoryExtractionPipeline } from "@/runtime/memory/memoryExtractionPipeline";

export class MemoryRuntime {
  private readonly extraction: MemoryExtractionPipeline;

  constructor(
    private readonly repository: MemoryRepository,
    embeddings: EmbeddingProvider
  ) {
    this.extraction = new MemoryExtractionPipeline(embeddings);
  }

  async initialize(): Promise<void> {
    await this.repository.initialize();
  }

  async remember(
    workspaceRoot: string,
    scope: MemoryScope,
    content: string,
    tags: string[] = []
  ): Promise<MemoryRecord> {
    const record = await this.extraction.extract({
      workspaceRoot,
      scope,
      content,
      tags
    });
    await this.repository.upsert(record);
    return record;
  }

  async forget(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async list(workspaceRoot: string, scope: MemoryScope): Promise<MemoryRecord[]> {
    return this.repository.listByScope(workspaceRoot, scope);
  }

  async retrieve(
    workspaceRoot: string,
    query: string,
    embeddings: EmbeddingProvider,
    limit = 8
  ): Promise<MemorySearchResult[]> {
    const queryEmbedding = await embeddings.embed(query);
    return this.repository.vectorSearch(workspaceRoot, queryEmbedding, limit);
  }
}
