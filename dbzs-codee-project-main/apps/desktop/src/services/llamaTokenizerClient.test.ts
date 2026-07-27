/**
 * DBZS – Division By Zeros
 * Datei: llamaTokenizerClient.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import { llamaTokenizerClient } from "./llamaTokenizerClient";
import { estimateTokensCharHeuristic } from "@/runtime/context/contextSpooler";
import { useSettingsStore } from "@/stores/settingsStore";

global.fetch = vi.fn();

describe("llamaTokenizerClient", () => {
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

  it("returns the real token count from the backend on success", async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ token_count: 42 }) });

    const count = await llamaTokenizerClient.countTokens("fast_gpu", "hello world");

    expect(count).toBe(42);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/runtime/slots/fast_gpu/tokenize"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("acceptance: falls back to the chars/4 heuristic when the slot is unavailable (never throws)", async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 409 });

    const count = await llamaTokenizerClient.countTokens("fast_gpu", "hello world");

    expect(count).toBe(estimateTokensCharHeuristic("hello world"));
  });

  it("falls back to the heuristic on a network failure", async () => {
    (fetch as any).mockRejectedValueOnce(new Error("network down"));

    const count = await llamaTokenizerClient.countTokens("fast_gpu", "some longer text here");

    expect(count).toBe(estimateTokensCharHeuristic("some longer text here"));
  });
});
