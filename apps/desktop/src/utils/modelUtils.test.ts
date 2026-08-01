import { describe, expect, it } from "vitest";
import type { IndexedModel } from "@dbzs/shared";
import { describeExclusionReason, isRunnableModel, isUnprofiled } from "./modelUtils";

const runnableBaseModel: IndexedModel = {
  id: "coder",
  name: "Coder",
  path: "D:/Models/coder.gguf",
  format: "gguf",
  artifact_type: "model",
  size_bytes: 1024,
  size_gb: 0.001,
  quantization: "Q4_K_M",
  backend: "llama.cpp",
  runtime_launcher: "llama-server",
  capabilities: ["chat", "code"],
  modality: ["text"],
  role: "CODE_MODEL",
  recommended_use: "primary_coding",
  compatibility: "llama_server_ready",
  runtime: {
    ctx: 8192,
    gpu_layers: 16,
    server_enabled: true,
    preferred_port: 8081,
    health_status: "ok",
    provider: "llama.cpp"
  }
};

describe("isRunnableModel", () => {
  it("returns true for a normal runnable model", () => {
    expect(isRunnableModel(runnableBaseModel)).toBe(true);
  });

  it("hard-blocks mmproj artifacts even if compatibility is accidentally runnable-looking", () => {
    expect(
      isRunnableModel({
        ...runnableBaseModel,
        id: "mmproj",
        name: "mmproj-gemma-vision-f16",
        artifact_type: "mmproj",
        compatibility: "llama_server_ready",
        capabilities: ["vision"],
        modality: ["image"]
      })
    ).toBe(false);
  });
});

describe("describeExclusionReason", () => {
  it("returns null for a runnable model", () => {
    expect(describeExclusionReason(runnableBaseModel)).toBeNull();
  });

  it("explains a missing-file compatibility state", () => {
    expect(
      describeExclusionReason({ ...runnableBaseModel, compatibility: "llama_server_missing_file" })
    ).toBe("Datei nicht mehr am erwarteten Pfad gefunden");
  });

  it("explains an unready ollama candidate", () => {
    expect(describeExclusionReason({ ...runnableBaseModel, compatibility: "ollama_candidate" })).toBe(
      "Ollama-Modell noch nicht als bereit erkannt (Health-Status unbekannt)"
    );
  });

  it("explains a non-model support artifact", () => {
    expect(
      describeExclusionReason({ ...runnableBaseModel, artifact_type: "mmproj", compatibility: "support_artifact" })
    ).toBe("Hilfsartefakt (kein eigenständiges Modell) - kein direkter Start möglich");
  });

  it("falls back to a generic message with the raw compatibility value", () => {
    expect(describeExclusionReason({ ...runnableBaseModel, compatibility: "something_new" })).toBe(
      "Nicht startbar (Kompatibilitätsstatus: something_new)"
    );
  });
});

describe("isUnprofiled", () => {
  it("is false when gpu_layers is already set", () => {
    expect(isUnprofiled(runnableBaseModel)).toBe(false);
  });

  it("is true for a runnable model with no gpu_layers recorded yet", () => {
    expect(
      isUnprofiled({ ...runnableBaseModel, runtime: { ...runnableBaseModel.runtime, gpu_layers: null } })
    ).toBe(true);
  });

  it("is false for a non-runnable model even without gpu_layers", () => {
    expect(
      isUnprofiled({
        ...runnableBaseModel,
        compatibility: "external_runtime_required",
        runtime: { ...runnableBaseModel.runtime, gpu_layers: null }
      })
    ).toBe(false);
  });
});
