import { describe, expect, it } from "vitest";
import type { IndexedModel, RuntimeStatus } from "@dbzs/shared";
import { describeModelRowStatus, modelRowActionState } from "./RuntimeModelsTab.helpers";

const baseModel: IndexedModel = {
  id: "m1",
  name: "test.gguf",
  path: "/models/test.gguf",
  format: "gguf",
  artifact_type: "model",
  size_bytes: 1024,
  size_gb: 0.001,
  quantization: "Q4_K_M",
  backend: "llama_server",
  runtime_launcher: "llama_server",
  capabilities: ["chat"],
  modality: ["text"],
  role: null,
  recommended_use: "coding_candidate",
  compatibility: "llama_server_ready",
  runtime: {
    ctx: 4096,
    gpu_layers: 0,
    server_enabled: true,
    preferred_port: 8080,
    health_status: "unknown",
    provider: "llama_server"
  }
};

describe("modelRowActionState", () => {
  it("allows start only for runnable idle runtime", () => {
    const state = modelRowActionState(baseModel, { state: "stopped" } as RuntimeStatus, false);
    expect(state.canStart).toBe(true);
    expect(state.canStop).toBe(false);
  });

  it("enables stop only on the active running row", () => {
    const running: RuntimeStatus = {
      state: "running",
      model_id: "m1",
      model_name: "test.gguf",
      provider: "llama.cpp",
      port: 8080,
      pid: 1234,
      endpoint: "http://127.0.0.1:8080",
      message: "running"
    };
    const active = modelRowActionState(baseModel, running, false);
    const other = modelRowActionState({ ...baseModel, id: "m2", name: "other.gguf" }, running, false);

    expect(active.isActive).toBe(true);
    expect(active.canStop).toBe(true);
    expect(active.canStart).toBe(false);
    expect(other.canStart).toBe(false);
    expect(other.canStop).toBe(false);
  });

  it("matches active row by model name when ids differ", () => {
    const running: RuntimeStatus = {
      state: "running",
      model_id: "hash-abc",
      model_name: "test.gguf",
      provider: "llama.cpp",
      port: 8080,
      pid: 1234,
      endpoint: "http://127.0.0.1:8080",
      message: "running"
    };
    const state = modelRowActionState(baseModel, running, false);
    expect(state.isActive).toBe(true);
    expect(state.canStop).toBe(true);
  });

  it("blocks actions while runtime is busy", () => {
    const running: RuntimeStatus = {
      state: "running",
      model_id: "m1",
      model_name: "test.gguf",
      provider: "llama.cpp",
      port: 8080,
      pid: 1234,
      endpoint: "http://127.0.0.1:8080",
      message: "running"
    };
    const state = modelRowActionState(baseModel, running, true);
    expect(state.canStart).toBe(false);
    expect(state.canStop).toBe(false);
  });
});

describe("describeModelRowStatus", () => {
  it("describes running, loadable and blocked model rows from action state", () => {
    const running: RuntimeStatus = {
      state: "running",
      model_id: "m1",
      model_name: "test.gguf",
      provider: "llama.cpp",
      port: 8080,
      pid: 1234,
      endpoint: "http://127.0.0.1:8080",
      message: "running"
    };

    expect(describeModelRowStatus(baseModel, running, false)).toEqual({
      label: "laeuft",
      tone: "ok"
    });
    expect(describeModelRowStatus(baseModel, { state: "stopped" } as RuntimeStatus, false)).toEqual({
      label: "ladbar",
      tone: "info"
    });
    expect(describeModelRowStatus({ ...baseModel, id: "m2", name: "other.gguf" }, running, true)).toEqual({
      label: "blockiert",
      tone: "error"
    });
  });
});
