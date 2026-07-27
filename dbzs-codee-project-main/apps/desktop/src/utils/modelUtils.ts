import type { IndexedModel } from "@dbzs/shared";

export function isRunnableModel(model: IndexedModel): boolean {
  return ["llama_server_ready", "llama_server_candidate", "ollama_ready"].includes(model.compatibility);
}
