import type { IndexedModel } from "@dbzs/shared";

export function isRunnableModel(model: IndexedModel): boolean {
  if (model.artifact_type !== "model") {
    return false;
  }
  return ["llama_server_ready", "llama_server_candidate", "ollama_ready"].includes(model.compatibility);
}
