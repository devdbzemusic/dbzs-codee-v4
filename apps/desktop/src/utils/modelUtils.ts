import type { IndexedModel } from "@dbzs/shared";

export function isRunnableModel(model: IndexedModel): boolean {
  if (model.artifact_type !== "model") {
    return false;
  }
  return ["llama_server_ready", "llama_server_candidate", "ollama_ready"].includes(model.compatibility);
}

/**
 * Human-readable reason a model isn't startable right now, or null if it is.
 * Mirrors backend/app/models/index_service.py's `_compatibility()` value set
 * (Plan 14, Phase 0.3) - a static "nicht startbar" tooltip previously gave no
 * indication of *why* a model was excluded.
 */
export function describeExclusionReason(model: IndexedModel): string | null {
  if (isRunnableModel(model)) {
    return null;
  }
  if (model.artifact_type !== "model") {
    return "Hilfsartefakt (kein eigenständiges Modell) - kein direkter Start möglich";
  }
  switch (model.compatibility) {
    case "llama_server_missing_file":
      return "Datei nicht mehr am erwarteten Pfad gefunden";
    case "ollama_candidate":
      return "Ollama-Modell noch nicht als bereit erkannt (Health-Status unbekannt)";
    case "support_artifact":
      return "Hilfsartefakt (kein eigenständiges Modell) - kein direkter Start möglich";
    case "requires_media_runtime":
      return "Erfordert eine noch nicht unterstützte Media-Runtime";
    case "external_runtime_required":
      return "Erfordert eine externe, nicht angebundene Runtime";
    default:
      return `Nicht startbar (Kompatibilitätsstatus: ${model.compatibility})`;
  }
}

/**
 * True when a runnable model has never been resource-profiled: the runtime
 * silently falls back to CPU-only (`gpu_layers = 0`, backend/app/runtime/
 * launch.py:329) when this is null, without telling the user (Plan 14,
 * Phase 0.3). Surfacing it lets the UI offer a "tune now" action instead of a
 * silent CPU-only load.
 */
export function isUnprofiled(model: IndexedModel): boolean {
  return isRunnableModel(model) && model.runtime.gpu_layers === null;
}
