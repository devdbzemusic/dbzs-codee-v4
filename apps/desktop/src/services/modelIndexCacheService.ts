import type { ModelIndex } from "@dbzs/shared";

const CACHE_FILE_NAME = "model-index-cache.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Stunden

interface CachedModelIndex {
  version: number;
  timestamp: number;
  index: ModelIndex;
}

/**
 * Implementiert einen persistenten Cache für den Modell-Index, um den
 * Anwendungsstart zu beschleunigen (P1-Task).
 */
class ModelIndexCacheService {
  private async getCacheFilePath(): Promise<string | null> {
    if (!window.dbzs?.getAppPath) {
      return null;
    }
    const userDataPath = await window.dbzs.getAppPath("userData");
    return `${userDataPath}/${CACHE_FILE_NAME}`;
  }

  /**
   * Lädt den Modell-Index aus dem Cache, wenn er gültig ist.
   * @returns Den `ModelIndex` oder `null`, wenn der Cache leer oder veraltet ist.
   */
  async loadFromCache(): Promise<ModelIndex | null> {
    const filePath = await this.getCacheFilePath();
    if (!filePath || !window.dbzs?.fs) {
      return null;
    }

    try {
      const content = await window.dbzs.fs.readFile(filePath, "utf-8");
      const cachedData = JSON.parse(content) as CachedModelIndex;

      if (cachedData.version !== 1) {
        return null;
      }

      if (Date.now() - cachedData.timestamp > CACHE_TTL_MS) {
        return null;
      }

      return cachedData.index;
    } catch (error) {
      // Cache-Datei nicht vorhanden oder fehlerhaft, wird ignoriert.
      return null;
    }
  }

  /**
   * Speichert den gegebenen Modell-Index im Cache.
   * @param index Der zu speichernde `ModelIndex`.
   */
  async saveToCache(index: ModelIndex): Promise<void> {
    const filePath = await this.getCacheFilePath();
    if (!filePath || !window.dbzs?.fs) {
      return;
    }

    const cachedData: CachedModelIndex = {
      version: 1,
      timestamp: Date.now(),
      index
    };

    try {
      await window.dbzs.fs.writeFile(filePath, JSON.stringify(cachedData));
    } catch (error) {
      console.error("Fehler beim Schreiben des Modell-Index-Caches:", error);
    }
  }
}

export const modelIndexCacheService = new ModelIndexCacheService();
