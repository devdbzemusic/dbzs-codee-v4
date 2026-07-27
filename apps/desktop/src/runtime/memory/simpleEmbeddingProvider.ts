import type { EmbeddingProvider } from "@/runtime/memory/memoryContracts";

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class SimpleEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions = 64) {}

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().split(/[^a-z0-9_]+/i).filter(Boolean);

    for (const token of tokens) {
      const hashed = hashToken(token);
      const slot = hashed % this.dimensions;
      vector[slot] = (vector[slot] ?? 0) + 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) {
      return vector;
    }

    return vector.map((value) => value / norm);
  }
}
