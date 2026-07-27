import type { IndexedModel } from "@dbzs/shared";
import { useSettingsStore } from "@/stores/settingsStore";

export interface PathValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Implementiert die Validierung von Modell- und Runtime-Pfaden vor dem Start (P1-Task).
 */
class PathValidatorService {
  private async fileExists(path: string | null | undefined): Promise<boolean> {
    if (!path || !window.dbzs?.fs?.stat) {
      return false;
    }
    try {
      await window.dbzs.fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prüft, ob die für ein Modell benötigten Dateien (Modelldatei und Runtime-Executable) existieren.
   * @param model Das zu prüfende `IndexedModel`.
   * @returns Ein `PathValidationResult`-Objekt.
   */
  async validateModelPaths(model: IndexedModel): Promise<PathValidationResult> {
    const errors: string[] = [];

    // 1. Prüfe die Modelldatei selbst
    if (!(await this.fileExists(model.filePath))) {
      errors.push(`Modelldatei nicht gefunden: ${model.filePath}`);
    }

    // 2. Prüfe die zugehörige Runtime-Executable
    if (model.provider === "llama.cpp") {
      const llamaCppPath = useSettingsStore.getState().settings.llamaCppPath;
      if (!(await this.fileExists(llamaCppPath))) {
        errors.push(`Llama.cpp Executable nicht gefunden: ${llamaCppPath}`);
      }
    } else if (model.provider === "ollama") {
      // Für Ollama könnte man prüfen, ob der Ollama-Server läuft,
      // was aber über eine reine Pfad-Validierung hinausgeht.
    }

    return {
      ok: errors.length === 0,
      errors
    };
  }
}

export const pathValidatorService = new PathValidatorService();
