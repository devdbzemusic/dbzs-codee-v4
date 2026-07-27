/**
 * DBZS – Division By Zeros
 * Datei: modelContextCacheClient.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import { computeSectionHash, modelContextCacheClient, type ModelContextCacheEntry } from "./modelContextCacheClient";
import { useSettingsStore } from "@/stores/settingsStore";

global.fetch = vi.fn();

describe("modelContextCacheClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      backendHealth: null,
      backendStartupStatus: null,
      isLoading: false,
      error: null
    });
  });

  const mockEntry: ModelContextCacheEntry = {
    key: "abc123",
    model_id: "coder",
    role: "coding",
    workspace_id: "ws-1",
    system_prompt_hash: "sph",
    tool_contract_hash: "tch",
    project_memory_hash: "pmh",
    token_count: 500,
    sections: [],
    created_at: "2026-01-01T00:00:00Z",
    last_used_at: "2026-01-01T00:00:00Z"
  };

  describe("lookup", () => {
    it("returns the entry on a cache hit", async () => {
      (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => mockEntry });

      const result = await modelContextCacheClient.lookup({
        model_id: "coder",
        role: "coding",
        workspace_id: "ws-1",
        system_prompt_hash: "sph",
        tool_contract_hash: "tch",
        project_memory_hash: "pmh"
      });

      expect(result).toEqual(mockEntry);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/context-pack/cache/lookup"),
        expect.objectContaining({ method: "POST" })
      );
    });

    it("returns null on a cache miss (404)", async () => {
      (fetch as any).mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await modelContextCacheClient.lookup({
        model_id: "coder",
        role: "coding",
        workspace_id: "ws-1",
        system_prompt_hash: "sph",
        tool_contract_hash: "tch",
        project_memory_hash: "pmh"
      });

      expect(result).toBeNull();
    });

    it("returns null (never throws) on a network failure", async () => {
      (fetch as any).mockRejectedValueOnce(new Error("network down"));

      const result = await modelContextCacheClient.lookup({
        model_id: "coder",
        role: "coding",
        workspace_id: "ws-1",
        system_prompt_hash: "sph",
        tool_contract_hash: "tch",
        project_memory_hash: "pmh"
      });

      expect(result).toBeNull();
    });
  });

  describe("store", () => {
    it("returns true on success", async () => {
      (fetch as any).mockResolvedValueOnce({ ok: true });

      const result = await modelContextCacheClient.store(mockEntry);

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/context-pack/cache/store"),
        expect.objectContaining({ method: "POST", body: JSON.stringify(mockEntry) })
      );
    });

    it("returns false (never throws) on failure", async () => {
      (fetch as any).mockRejectedValueOnce(new Error("network down"));

      const result = await modelContextCacheClient.store(mockEntry);

      expect(result).toBe(false);
    });
  });

  describe("invalidate", () => {
    it("returns the invalidated keys", async () => {
      (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ invalidated: ["abc123"] }) });

      const result = await modelContextCacheClient.invalidate("ws-1", "agents_file_hash", "new-hash");

      expect(result).toEqual(["abc123"]);
    });

    it("returns an empty array on failure", async () => {
      (fetch as any).mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await modelContextCacheClient.invalidate("ws-1", "agents_file_hash", "new-hash");

      expect(result).toEqual([]);
    });
  });

  describe("clear", () => {
    it("returns true on success", async () => {
      (fetch as any).mockResolvedValueOnce({ ok: true });

      const result = await modelContextCacheClient.clear();

      expect(result).toBe(true);
    });
  });

  describe("computeSectionHash", () => {
    it("is deterministic for identical content", async () => {
      const hashA = await computeSectionHash("hello world");
      const hashB = await computeSectionHash("hello world");

      expect(hashA).toBe(hashB);
      expect(hashA).toHaveLength(64); // sha256 hex digest
    });

    it("differs for different content", async () => {
      const hashA = await computeSectionHash("hello world");
      const hashB = await computeSectionHash("hello WORLD");

      expect(hashA).not.toBe(hashB);
    });
  });
});
