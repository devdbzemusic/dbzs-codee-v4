import type { IndexedModel } from "@dbzs/shared";
import { useModelIndexStore } from "@/stores/modelIndexStore";
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
      return true;
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
    const runtimeDir = useModelIndexStore.getState().index?.summary.runtime_dir;
    const modelPath = model.path;
    const provider = model.runtime?.provider || model.backend;

    // 1. Prüfe die Modelldatei selbst
    if (!(await this.fileExists(modelPath))) {
      errors.push(`Modelldatei nicht gefunden: ${modelPath}`);
    }

    // 2. Prüfe das zugehörige Runtime-Verzeichnis, sofern der Modellindex eines kennt.
    if (provider === "llama.cpp") {
      if (!(await this.fileExists(runtimeDir))) {
        errors.push(`Llama.cpp Runtime-Verzeichnis nicht gefunden: ${runtimeDir ?? "unbekannt"}`);
      }
    } else if (provider === "ollama") {
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
