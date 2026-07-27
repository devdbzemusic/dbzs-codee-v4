import { describe, expect, it } from "vitest";
import path from "node:path";
import { probeRuntime } from "./runtimeProbe";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

describe("probeRuntime", () => {
  it("returns actionable diagnostics when runtime paths are missing", () => {
    const result = probeRuntime(workspaceRoot, {
      runtimeExecutable: "./third_party/llama/bin/llama-server.exe",
      primaryModelPath: "./models/qwen/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf",
      fallbackModelPath: "./models/qwen/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf"
    });

    expect(result.status).toBe("failed");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
