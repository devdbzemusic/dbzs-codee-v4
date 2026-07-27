import { create } from "zustand";
import type { IndexedModel, ModelIndex } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

const EMPTY_MODEL_INDEX: ModelIndex = {
  generated_from: "none",
  summary: {
    models_dir: "",
    runtime_dir: null,
    ollama_dir: null,
    ollama_models_dir: null,
    total: 0,
    gguf_total: 0,
    ollama_total: 0,
    llama_server_ready: 0,
    ollama_ready: 0,
    coding_candidates: 0,
    vision_candidates: 0,
    adapters: 0,
    unsupported: 0,
  },
  models: [],
};

interface ModelIndexState {
  index: ModelIndex | null;
  isLoading: boolean;
  error: string | null;
  primaryCodingModel: IndexedModel | null;
  loadModelIndex: () => Promise<void>;
}

function selectPrimaryCodingModel(index: ModelIndex | null): IndexedModel | null {
  if (!index) {
    return null;
  }

  return (
    index.models.find((model) => model.recommended_use === "primary_coding") ??
    index.models.find((model) => model.recommended_use === "coding_candidate") ??
    null
  );
}

export const useModelIndexStore = create<ModelIndexState>((set) => ({
  index: null,
  isLoading: false,
  error: null,
  primaryCodingModel: null,
  loadModelIndex: async () => {
    set({ isLoading: true, error: null });
    try {
      const index = await backendClient.getModelIndex();
      set({
        index,
        primaryCodingModel: selectPrimaryCodingModel(index),
        isLoading: false
      });
    } catch (error) {
      set({
        index: EMPTY_MODEL_INDEX,
        primaryCodingModel: null,
        error: error instanceof Error ? error.message : "Modellindex konnte nicht geladen werden",
        isLoading: false
      });
    }
  }
}));
