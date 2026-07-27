import type {
  MemoryRecord,
  MemoryRepository,
  MemoryScope,
  MemorySearchResult
} from "@/runtime/memory/memoryContracts";

export interface SqliteLikeStatement {
  run(...params: unknown[]): unknown;
  get<T = unknown>(...params: unknown[]): T;
  all<T = unknown>(...params: unknown[]): T[];
}

export interface SqliteLikeDatabase {
  prepare(sql: string): SqliteLikeStatement;
  exec(sql: string): void;
}

interface MemoryRow {
  id: string;
  scope: MemoryScope;
  workspace_root: string;
  content: string;
  tags_json: string;
  embedding_json: string | null;
  created_at: string;
  updated_at: string;
}

function parseTags(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

function parseEmbedding(raw: string | null): number[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) {
      return undefined;
    }
    return value.map((entry) => Number(entry));
  } catch {
    return undefined;
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    normLeft += l * l;
    normRight += r * r;
  }

  if (normLeft === 0 || normRight === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly db: SqliteLikeDatabase) {}

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        embedding_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_scope_workspace
      ON memory_records(scope, workspace_root);
    `);
  }

  async upsert(record: MemoryRecord): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO memory_records
          (id, scope, workspace_root, content, tags_json, embedding_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          scope=excluded.scope,
          workspace_root=excluded.workspace_root,
          content=excluded.content,
          tags_json=excluded.tags_json,
          embedding_json=excluded.embedding_json,
          updated_at=excluded.updated_at
      `)
      .run(
        record.id,
        record.scope,
        record.workspaceRoot,
        record.content,
        JSON.stringify(record.tags),
        record.embedding ? JSON.stringify(record.embedding) : null,
        record.createdAt,
        record.updatedAt
      );
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM memory_records WHERE id = ?").run(id);
  }

  async listByScope(workspaceRoot: string, scope: MemoryScope): Promise<MemoryRecord[]> {
    const rows = this.db
      .prepare(
        `
        SELECT id, scope, workspace_root, content, tags_json, embedding_json, created_at, updated_at
        FROM memory_records
        WHERE workspace_root = ? AND scope = ?
        ORDER BY updated_at DESC
      `
      )
      .all<MemoryRow>(workspaceRoot, scope);

    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      workspaceRoot: row.workspace_root,
      content: row.content,
      tags: parseTags(row.tags_json),
      embedding: parseEmbedding(row.embedding_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async vectorSearch(
    workspaceRoot: string,
    queryEmbedding: number[],
    limit: number
  ): Promise<MemorySearchResult[]> {
    const rows = this.db
      .prepare(
        `
        SELECT id, scope, workspace_root, content, tags_json, embedding_json, created_at, updated_at
        FROM memory_records
        WHERE workspace_root = ? AND embedding_json IS NOT NULL
      `
      )
      .all<MemoryRow>(workspaceRoot);

    return rows
      .map((row) => {
        const embedding = parseEmbedding(row.embedding_json) ?? [];
        const score = cosineSimilarity(queryEmbedding, embedding);
        return {
          id: row.id,
          scope: row.scope,
          content: row.content,
          score,
          tags: parseTags(row.tags_json)
        } satisfies MemorySearchResult;
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}
