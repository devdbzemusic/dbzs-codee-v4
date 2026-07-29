import { describe, expect, it } from "vitest";
import type { IndexedModel } from "@dbzs/shared";
import { isRunnableModel } from "./modelUtils";

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
