export type MemoryScope = "short_term" | "session" | "project" | "vector";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  workspaceRoot: string;
  content: string;
  tags: string[];
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface MemorySearchResult {
  id: string;
  scope: MemoryScope;
  content: string;
  score: number;
  tags: string[];
}

export interface MemoryRepository {
  initialize(): Promise<void>;
  upsert(record: MemoryRecord): Promise<void>;
  delete(id: string): Promise<void>;
  listByScope(workspaceRoot: string, scope: MemoryScope): Promise<MemoryRecord[]>;
  vectorSearch(
    workspaceRoot: string,
    queryEmbedding: number[],
    limit: number
  ): Promise<MemorySearchResult[]>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
