import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeDoctorSection } from "./RuntimeDoctorSection";

declare global {
   
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const loadDoctorReport = vi.fn();
const loadLogs = vi.fn();
const dryRunModel = vi.fn();
const probeModel = vi.fn();
const startModel = vi.fn();
const stopModel = vi.fn();

const sampleReport = {
  checks: [
    {
      id: "models_dir",
      status: "ok" as const,
      message: "Models directory exists",
      recommendation: ""
    }
  ],
  models: [
    {
      model_id: "coder",
      name: "Coder Q4",
      format: "gguf",
      artifact_type: "model",
      runtime_launcher: "llama-server",
      provider: "llama.cpp",
      compatibility: "llama_server_ready",
      runnable: false,
      estimated_role: "coder",
      safe_preset: { gpu_layers: 0 },
      command_preview: "llama-server.exe --model coder.gguf",
      blockers: ["missing dll"],
      warnings: ["cpu only"]
    },
    {
      model_id: "ollama-demo",
      name: "Ollama Demo",
      format: "ollama",
      artifact_type: "model",
      runtime_launcher: "ollama",
      provider: "ollama",
      compatibility: "ollama_ready",
      runnable: true,
      estimated_role: "general",
      safe_preset: { gpu_layers: 0 },
      command_preview: "ollama serve",
      blockers: [],
      warnings: []
    }
  ],
  suggested_profiles: [
    {
      name: "safe_cpu_coder",
      description: "CPU profile",
      hardware_class: "cpu",
      preset: { gpu_layers: 0 }
    }
  ],
  summary: "1 checks, 0 warnings, 0 errors, 2 models"
};

vi.mock("@/stores/runtimeStore", () => ({
  useRuntimeStore: () => ({
    doctorReport: sampleReport,
    doctorLoading: false,
    actionResult: {
      action: "start" as const,
      success: false,
      message: "Runtime endpoint not ready",
      stderr_tail: "error: model load failed"
    },
    logs: null,
    status: { state: "stopped" },
    isLoading: false,
    loadDoctorReport,
    loadLogs,
    dryRunModel,
    probeModel,
    startModel,
    stopModel
  })
}));

describe("RuntimeDoctorSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders doctor checks and disables start for blocked models", () => {
    act(() => {
      root.render(<RuntimeDoctorSection backendOnline />);
    });

    expect(container.textContent).toContain("Runtime Doctor");
    expect(container.textContent).toContain("models_dir");
    expect(container.textContent).toContain("missing dll");
    expect(container.textContent).toContain("error: model load failed");

    const startButtons = Array.from(container.querySelectorAll("button")).filter((button) =>
      button.textContent?.includes("Start Runtime")
    );
    expect(startButtons.some((button) => button.hasAttribute("disabled"))).toBe(true);
  });
});
