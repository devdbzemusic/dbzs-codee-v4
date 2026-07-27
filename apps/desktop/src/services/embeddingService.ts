/**
 * DBZS – Division By Zeros
 * Datei: embeddingService.ts
 * Bereich: Desktop Services / Embedding & Reranking Service
 *
 * Zweck:
 *   Text Embedding und Reranking für RAG (Retrieval Augmented Generation).
 *
 * Warum:
 *   Für semantische Suche und Kontext-Retrieval im Workspace.
 *
 * Wozu:
 *   Ermöglicht intelligente Dokumentensuche für den Runtime Chat.
 */

import { backendClient } from "@/services/backendClient";

async function resolveBackendUrl(): Promise<string> {
  try {
    const settings = await backendClient.getSettings();
    return settings.backendUrl || "http://127.0.0.1:8876";
  } catch {
    return "http://127.0.0.1:8876";
  }
}

/**
 * Embedding-Modell-Konfiguration.
 */
export interface EmbeddingModelConfig {
  modelId: string;
  name: string;
  dimension: number;
  maxSequenceLength: number;
  path: string;
}

/**
 * Reranking-Modell-Konfiguration.
 */
export interface RerankingModelConfig {
  modelId: string;
  name: string;
  path: string;
}

/**
 * Embedding-Anfrage.
 */
export interface EmbeddingRequest {
  texts: string[];
  modelId?: string;
}

/**
 * Embedding-Antwort.
 */
export interface EmbeddingResponse {
  embeddings: number[][];
  modelId: string;
  dimension: number;
  usage: {
    totalTokens: number;
    promptTokens: number;
  };
}

/**
 * Reranking-Anfrage.
 */
export interface RerankingRequest {
  query: string;
  documents: string[];
  topK?: number;
  modelId?: string;
}

/**
 * Reranking-Ergebnis.
 */
export interface RerankingResult {
  index: number;
  text: string;
  score: number;
  rank: number;
}

/**
 * Embedding & Reranking Service.
 */
export const embeddingService = {
  /**
   * Standard Embedding-Modell (Qwen3-Embedding-0.6B).
   */
  defaultEmbeddingModel: "Qwen3-Embedding-0.6B-Q8_0",

  /**
   * Standard Reranking-Modell (Qwen3-Reranker-0.6B).
   */
  defaultRerankingModel: "qwen3-reranker-0.6b-q8_0",

  /**
   * Holt die verfügbaren Embedding-Modelle.
   */
  async getAvailableEmbeddingModels(): Promise<EmbeddingModelConfig[]> {
    try {
      const index = await backendClient.getModelIndex();
      return index.models
        .filter(model =>
          model.name.toLowerCase().includes("embed") ||
          model.capabilities?.includes("embedding")
        )
        .map(model => ({
          modelId: model.id,
          name: model.name,
          dimension: 1024, // Qwen3-Embedding-0.6B hat 1024 Dimensionen
          maxSequenceLength: 8192,
          path: model.path
        }));
    } catch (error) {
      console.error("[EmbeddingService] Fehler beim Laden der Modelle:", error);
      return [];
    }
  },

  /**
   * Holt die verfügbaren Reranking-Modelle.
   */
  async getAvailableRerankingModels(): Promise<RerankingModelConfig[]> {
    try {
      const index = await backendClient.getModelIndex();
      return index.models
        .filter(model =>
          model.name.toLowerCase().includes("rerank")
        )
        .map(model => ({
          modelId: model.id,
          name: model.name,
          path: model.path
        }));
    } catch (error) {
      console.error("[EmbeddingService] Fehler beim Laden der Reranking-Modelle:", error);
      return [];
    }
  },

  /**
   * Erzeugt Embeddings für Texte.
   *
   * @param request - Embedding-Anfrage mit Texten
   * @returns Embedding-Vektoren
   */
  async createEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const modelId = request.modelId ?? this.defaultEmbeddingModel;

    try {
      // Backend-API aufrufen
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          input: request.texts
        })
      });

      if (!response.ok) {
        throw new Error(`Embedding API: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        embeddings: data.data.map((d: any) => d.embedding),
        modelId: data.model,
        dimension: data.data[0]?.embedding?.length ?? 0,
        usage: {
          totalTokens: data.usage?.total_tokens ?? 0,
          promptTokens: data.usage?.prompt_tokens ?? 0
        }
      };
    } catch (error) {
      console.error("[EmbeddingService] Fehler beim Erstellen der Embeddings:", error);
      throw error;
    }
  },

  /**
   * Führt Reranking von Dokumenten durch.
   *
   * @param request - Reranking-Anfrage
   * @returns Sortierte Dokumente mit Scores
   */
  async rerank(request: RerankingRequest): Promise<RerankingResult[]> {
    const modelId = request.modelId ?? this.defaultRerankingModel;
    const topK = request.topK ?? request.documents.length;

    try {
      // Backend-API aufrufen
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/rerank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          query: request.query,
          documents: request.documents,
          top_n: topK
        })
      });

      if (!response.ok) {
        throw new Error(`Reranking API: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.results.map((r: any, index: number) => ({
        index: r.index,
        text: request.documents[r.index],
        score: r.score,
        rank: index + 1
      }));
    } catch (error) {
      console.error("[EmbeddingService] Fehler beim Reranking:", error);
      throw error;
    }
  },

  /**
   * Semantische Suche im Workspace.
   *
   * @param query - Suchanfrage
   * @param documents - Zu durchsuchende Dokumente
   * @param topK - Anzahl der Ergebnisse
   * @returns Sortierte Treffer
   */
  async semanticSearch(
    query: string,
    documents: Array<{ id: string; text: string }>,
    topK: number = 5
  ): Promise<Array<{ id: string; text: string; score: number }>> {
    if (documents.length === 0) {
      return [];
    }

    // Reranking durchführen
    const texts = documents.map(d => d.text);
    const results = await this.rerank({
      query,
      documents: texts,
      topK
    });

    // Ergebnisse mit IDs anreichern
    return results.map(r => ({
      id: documents[r.index].id,
      text: r.text,
      score: r.score
    }));
  },

  /**
   * Berechnet Kosinus-Ähnlichkeit zwischen zwei Vektoren.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vektoren müssen gleiche Länge haben");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  },

  /**
   * Prüft ob Embedding-Modell verfügbar ist.
   */
  async isEmbeddingModelAvailable(): Promise<boolean> {
    try {
      const models = await this.getAvailableEmbeddingModels();
      return models.length > 0;
    } catch {
      return false;
    }
  },

  /**
   * Prüft ob Reranking-Modell verfügbar ist.
   */
  async isRerankingModelAvailable(): Promise<boolean> {
    try {
      const models = await this.getAvailableRerankingModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }
};
