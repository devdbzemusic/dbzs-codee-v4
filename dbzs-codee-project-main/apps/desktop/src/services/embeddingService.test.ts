/**
 * DBZS – Division By Zeros
 * Datei: embeddingService.test.ts
 * Bereich: Desktop Services / Embedding Service Tests
 */

import { describe, it, expect, vi } from "vitest";
import { embeddingService } from "./embeddingService";

// Mock fetch
global.fetch = vi.fn();

describe("embeddingService", () => {
  describe("cosineSimilarity", () => {
    it("sollte identische Vektoren erkennen", () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      expect(embeddingService.cosineSimilarity(a, b)).toBeCloseTo(1);
    });

    it("sollte orthogonale Vektoren erkennen", () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(embeddingService.cosineSimilarity(a, b)).toBeCloseTo(0);
    });

    it("sollte entgegengesetzte Vektoren erkennen", () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(embeddingService.cosineSimilarity(a, b)).toBeCloseTo(-1);
    });

    it("sollte Fehler bei unterschiedlicher Länge werfen", () => {
      const a = [1, 0, 0];
      const b = [1, 0];
      expect(() => embeddingService.cosineSimilarity(a, b)).toThrow();
    });
  });

  describe("semanticSearch", () => {
    it("sollte leere Dokumente behandeln", async () => {
      const results = await embeddingService.semanticSearch("query", [], 5);
      expect(results).toHaveLength(0);
    });
  });

  describe("default models", () => {
    it("sollte Qwen3-Embedding als Default haben", () => {
      expect(embeddingService.defaultEmbeddingModel).toBe("Qwen3-Embedding-0.6B-Q8_0");
    });

    it("sollte Qwen3-Reranker als Default haben", () => {
      expect(embeddingService.defaultRerankingModel).toBe("qwen3-reranker-0.6b-q8_0");
    });
  });
});
