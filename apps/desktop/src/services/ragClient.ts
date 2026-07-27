import type {
  RagIndexStatus,
  RagRetrievalResponse,
  RetrievalQuery,
  ReasoningTraceEvent,
  SafeReasoningSummary
} from "@dbzs/shared";
import { useSettingsStore } from "@/stores/settingsStore";

function baseUrl(): string {
  return useSettingsStore.getState().settings.backendUrl || "http://127.0.0.1:8876";
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  if (!response.ok) throw new Error(`RAG API ${response.status}: ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const workspaceIds = new Map<string, string>();

function toStatus(raw: any): RagIndexStatus {
  return { workspaceId: raw.workspace_id, workspaceRoot: raw.workspace_root, state: raw.state,
    fileCount: raw.file_count, chunkCount: raw.chunk_count, embeddingCount: raw.embedding_count,
    lastIndexedAt: raw.last_indexed_at ?? undefined, durationMs: raw.duration_ms ?? undefined, error: raw.error ?? undefined };
}

function toRetrieval(raw: any): RagRetrievalResponse {
  const item = (value: any) => ({ id: value.id, sourceType: value.source_type, sourcePath: value.source_path,
    title: value.title, symbol: value.symbol, startLine: value.start_line, endLine: value.end_line,
    content: value.content, contentHash: value.content_hash, tokenCount: value.token_count,
    retrievalMethod: value.retrieval_method, rawScore: value.raw_score, rerankScore: value.rerank_score,
    finalScore: value.final_score, retrievedAt: value.retrieved_at });
  const manifest = raw.manifest;
  return {
    candidates: raw.candidates.map(item), items: raw.items.map(item),
    manifest: { requestId: manifest.request_id, queryId: manifest.query_id, workspaceId: manifest.workspace_id,
      candidateCount: manifest.candidate_count, rerankedCount: manifest.reranked_count,
      selectedCount: manifest.selected_count,
      selectedItems: manifest.selected_items.map((entry: any) => ({ itemId: entry.item_id, sourcePath: entry.source_path,
        symbol: entry.symbol, startLine: entry.start_line, endLine: entry.end_line,
        retrievalMethod: entry.retrieval_method, score: entry.score, tokenCount: entry.token_count })),
      droppedItems: manifest.dropped_items.map((entry: any) => ({ itemId: entry.item_id, reason: entry.reason })),
      cacheHits: manifest.cache_hits, cacheMisses: manifest.cache_misses, totalTokens: manifest.total_tokens,
      createdAt: manifest.created_at, fallbackReason: manifest.fallback_reason ?? undefined },
    sourceReferences: raw.source_references.map((source: any) => ({ id: source.id, sourceType: source.source_type,
      title: source.title, filePath: source.file_path, startLine: source.start_line, endLine: source.end_line,
      url: source.url, symbol: source.symbol }))
  };
}

function toTraceEvent(raw: any): ReasoningTraceEvent {
  return { id: raw.id, runId: raw.run_id, messageId: raw.message_id, kind: raw.kind, title: raw.title,
    summary: raw.summary, status: raw.status, sourceRefs: raw.source_refs, metadata: raw.metadata,
    startedAt: raw.started_at, completedAt: raw.completed_at, durationMs: raw.duration_ms, sequence: raw.sequence };
}

function toSummary(raw: any): SafeReasoningSummary {
  return { id: raw.id, runId: raw.run_id, title: raw.title, summary: raw.summary,
    completedSteps: raw.completed_steps, currentStep: raw.current_step, assumptions: raw.assumptions,
    risks: raw.risks, nextAction: raw.next_action, sourceRefs: raw.source_refs, createdAt: raw.created_at };
}

export const ragClient = {
  async syncIndex(workspaceRoot: string, options?: { changedPaths?: string[]; force?: boolean; reason?: string }) {
    const result = await jsonRequest<{ workspace_id: string; state: string; job_id?: string }>("/rag/index/sync", {
      method: "POST",
      body: JSON.stringify({
        workspace_root: workspaceRoot,
        changed_paths: options?.changedPaths ?? [],
        force: options?.force ?? false,
        reason: options?.reason ?? "desktop"
      })
    });
    workspaceIds.set(workspaceRoot, result.workspace_id);
    return result;
  },
  workspaceId(workspaceRoot: string) { return workspaceIds.get(workspaceRoot) ?? null; },
  status(workspaceId: string) {
    return jsonRequest<any>(`/rag/index/status?workspace_id=${encodeURIComponent(workspaceId)}`).then(toStatus);
  },
  retrieve(query: RetrievalQuery) {
    return jsonRequest<any>("/rag/retrieve", {
      method: "POST",
      body: JSON.stringify({
        id: query.id, workspace_id: query.workspaceId, workspace_root: query.workspaceRoot,
        query: query.query, intent: query.intent, active_file_path: query.activeFilePath,
        mentioned_paths: query.mentionedPaths ?? [], mentioned_symbols: query.mentionedSymbols ?? [],
        max_candidates: query.maxCandidates, max_final_items: query.maxFinalItems,
        token_budget: query.tokenBudget, created_at: query.createdAt,
        query_embedding: query.queryEmbedding, embedding_model_id: query.embeddingModelId
      })
    }).then(toRetrieval);
  },
  clearIndex(workspaceId: string) {
    return jsonRequest<void>(`/rag/index?workspace_id=${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
  },
  clearEmbeddings(workspaceId: string) {
    return jsonRequest<void>(`/rag/embeddings?workspace_id=${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
  },
  missingEmbeddings(modelId: string, entries: Array<{ id: string; contentHash: string }>) {
    return jsonRequest<{ missing_source_ids: string[] }>("/rag/embeddings/missing", { method: "POST", body: JSON.stringify({
      embedding_model_id: modelId,
      entries: entries.map((entry) => ({ source_id: entry.id, content_hash: entry.contentHash }))
    }) }).then((result) => result.missing_source_ids);
  },
  upsertEmbeddings(entries: Array<{ id: string; contentHash: string; modelId: string; vector: number[]; tokenCount: number }>) {
    return jsonRequest<{ stored: number }>("/rag/embeddings", { method: "POST", body: JSON.stringify({ entries: entries.map((entry) => ({
      source_id: entry.id, content_hash: entry.contentHash, embedding_model_id: entry.modelId,
      vector: entry.vector, token_count: entry.tokenCount
    })) }) });
  }
};

export const traceClient = {
  append(runId: string, events: ReasoningTraceEvent[]) {
    return jsonRequest<any>(`/traces/${encodeURIComponent(runId)}/events`, {
      method: "POST",
      body: JSON.stringify({ events: events.map((event) => ({
        id: event.id, message_id: event.messageId, kind: event.kind, title: event.title,
        summary: event.summary, status: event.status, source_refs: event.sourceRefs ?? [],
        metadata: event.metadata ?? {}, started_at: event.startedAt, completed_at: event.completedAt,
        duration_ms: event.durationMs
      })) })
    }).then((raw) => ({ events: raw.events.map(toTraceEvent), summary: toSummary(raw.summary) }));
  }
};

export function createTraceEvent(
  runId: string,
  kind: ReasoningTraceEvent["kind"],
  title: string,
  summary: string,
  status: ReasoningTraceEvent["status"] = "completed"
): ReasoningTraceEvent {
  const at = new Date().toISOString();
  return { id: `trace-${crypto.randomUUID()}`, runId, kind, title, summary, status,
    startedAt: at, completedAt: status === "completed" ? at : undefined };
}
