/**
 * DBZS – Division By Zeros
 * Datei: modelContextCacheClient.ts
 * Bereich: Desktop Services / Model Context Cache Client
 *
 * Zweck:
 *   Dünner Fetch-Wrapper für /context-pack/cache/* — lookup/store/invalidate/clear
 *   des Model Context Cache (Phase 3).
 *
 * Warum:
 *   Cachebare Prompt-Bestandteile (Systemprompt, Tool-Contracts, AGENTS.md,
 *   Project Memory) sollen nicht bei jedem Request neu aufgebaut werden.
 */

import { backendClient } from "@/services/backendClient";

export type ContextCacheRole = "chat" | "coding" | "review" | "plan" | "debug";

export interface ContextSection {
  type: string;
  source: string;
  token_count: number;
  priority: number;
  cached?: boolean;
  truncated?: boolean;
}

export interface ModelContextCacheEntry {
  key: string;
  model_id: string;
  role: ContextCacheRole;
  workspace_id: string;
  system_prompt_hash: string;
  tool_contract_hash: string;
  project_memory_hash: string;
  architecture_hash?: string | null;
  agents_file_hash?: string | null;
  token_count: number;
  sections: ContextSection[];
  created_at: string;
  last_used_at: string;
  expires_at?: string | null;
}

export interface ContextCacheLookupParams {
  model_id: string;
  role: ContextCacheRole;
  workspace_id: string;
  system_prompt_hash: string;
  tool_contract_hash: string;
  project_memory_hash: string;
  architecture_hash?: string | null;
  agents_file_hash?: string | null;
}

async function resolveBackendUrl(): Promise<string> {
  try {
    const settings = await backendClient.getSettings();
    return settings.backendUrl || "http://127.0.0.1:8876";
  } catch {
    return "http://127.0.0.1:8876";
  }
}

export const modelContextCacheClient = {
  /**
   * Returns the cached entry, or null on a cache miss (404) or any request
   * failure — a cache-lookup failure must never block sending the chat
   * request, only skip the cache-reuse optimization for this turn.
   */
  async lookup(params: ContextCacheLookupParams): Promise<ModelContextCacheEntry | null> {
    try {
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/context-pack/cache/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params)
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as ModelContextCacheEntry;
    } catch {
      return null;
    }
  },

  async store(entry: ModelContextCacheEntry): Promise<boolean> {
    try {
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/context-pack/cache/store`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry)
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  async invalidate(workspaceId: string, changedHashField: string, newHash: string): Promise<string[]> {
    try {
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/context-pack/cache/invalidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          changed_hash_field: changedHashField,
          new_hash: newHash
        })
      });
      if (!response.ok) {
        return [];
      }
      const data = (await response.json()) as { invalidated: string[] };
      return data.invalidated;
    } catch {
      return [];
    }
  },

  async clear(): Promise<boolean> {
    try {
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/context-pack/cache/clear`, { method: "POST" });
      return response.ok;
    } catch {
      return false;
    }
  }
};

/**
 * SHA-256 hex digest via the Web Crypto API — matches
 * app.context_pack.context_cache.compute_section_hash on the backend
 * (also plain SHA-256 hex) so hashes computed on either side are comparable.
 */
export async function computeSectionHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
