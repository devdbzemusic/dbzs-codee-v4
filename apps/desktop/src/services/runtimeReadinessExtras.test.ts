import { describe, expect, it, vi } from "vitest";
import {
  assessResourcePlanRisk,
  buildResourceRiskQuestion,
  requiresExplicitResourceRiskDecision
} from "@/services/runtimeResourceRisk";
import { gateSlotForRequest } from "@/services/runtimeSlotExecutionState";
import {
  createPhaseTimeoutController,
  outcomeForPhaseTimeout
} from "@/services/runtimePhaseTimeouts";
import type { RuntimeSlotStatus } from "@dbzs/shared";

describe("runtimeResourceRisk", () => {
  it("marks 8B-class plans on 4GB VRAM as high risk", () => {
    const result = assessResourcePlanRisk({
      slot_id: "fast_gpu",
      estimated_model_bytes: 4_500_000_000,
      estimated_total_vram_bytes: 3_200_000_000,
      available_vram_bytes: 4_000_000_000,
      safety_reserve_bytes: 600_000_000,
      gpu_layers: 33,
      context_size: 4096,
      warnings: ["estimated_vram_exceeds_safety_reserve"]
    });
    expect(["high", "unsupported"]).toContain(result.risk);
    expect(requiresExplicitResourceRiskDecision(result.risk)).toBe(true);
    const question = buildResourceRiskQuestion({
      roleLabel: "Review",
      modelName: "Llama-3.1-8B",
      slotId: "fast_gpu",
      risk: result.risk,
      reasons: result.reasons,
      residentModelName: "Seed-Coder-8B"
    });
    expect(question.questionType).toBe("single_choice");
    expect(question.prompt).toContain("Slot fast_gpu");
    expect(question.options?.map((o) => o.id)).toContain("continue_with_resident");
    expect(question.options?.map((o) => o.id)).toContain("smaller_profile");
    expect(question.options?.map((o) => o.id)).toContain("cpu_safe_profile");
  });

  it("exposes cpuOffloadLayers for hybrid-style partial GPU offload", () => {
    const result = assessResourcePlanRisk({
      estimated_model_bytes: 2_000_000_000,
      estimated_total_vram_bytes: 1_500_000_000,
      available_vram_bytes: 8_000_000_000,
      safety_reserve_bytes: 1_000_000_000,
      gpu_layers: 12,
      warnings: [],
      hardware_mode: "hybrid"
    });
    expect(result.view?.cpuOffloadLayers).toBe(20);
  });

  it("keeps low risk when headroom is healthy", () => {
    const result = assessResourcePlanRisk({
      estimated_model_bytes: 2_000_000_000,
      estimated_total_vram_bytes: 2_200_000_000,
      available_vram_bytes: 8_000_000_000,
      safety_reserve_bytes: 1_000_000_000,
      gpu_layers: 24,
      warnings: []
    });
    expect(result.risk).toBe("low");
    expect(requiresExplicitResourceRiskDecision(result.risk)).toBe(false);
  });
});

describe("runtimeSlotExecutionState", () => {
  const baseStatus = (overrides: Partial<RuntimeSlotStatus> = {}): RuntimeSlotStatus =>
    ({
      slot_id: "fast_gpu",
      state: "running",
      provider: "llama.cpp",
      model_id: "reviewer-model",
      model_name: "Reviewer",
      port: 8081,
      pid: 1,
      endpoint: "http://127.0.0.1:8081",
      message: "",
      device_policy: "gpu",
      gpu_layers: 24,
      context_size: 4096,
      chat_ready: true,
      active_requests: 0,
      ...overrides
    });

  it("rejects binding mismatches and busy slots", () => {
    const mismatch = gateSlotForRequest({
      slotId: "fast_gpu",
      status: baseStatus({ model_id: "other" }),
      expectedModelId: "reviewer-model",
      activeRunId: "run-1"
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.code).toBe("binding_mismatch");

    const busy = gateSlotForRequest({
      slotId: "fast_gpu",
      status: baseStatus({ active_requests: 2 }),
      expectedModelId: "reviewer-model",
      activeRunId: "run-1"
    });
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.code).toBe("slot_busy");
  });

  it("allows a ready exclusive slot", () => {
    const ok = gateSlotForRequest({
      slotId: "fast_gpu",
      status: baseStatus(),
      expectedModelId: "reviewer-model",
      activeRunId: "run-1"
    });
    expect(ok.ok).toBe(true);
  });
});

describe("runtimePhaseTimeouts", () => {
  it("fires first-token then switches to stream-idle", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const controller = createPhaseTimeoutController({
      isAborted: () => false,
      hasFirstToken: () => events.includes("first"),
      onTimeout: (kind) => events.push(kind)
    });

    controller.startPreTokenWatchdogs({
      promptEvalTimeoutMs: 1_000,
      firstTokenTimeoutMs: 2_000
    });
    vi.advanceTimersByTime(1_500);
    expect(events).toContain("prompt_eval_timeout");

    controller.clearAll();
    events.length = 0;
    controller.startPreTokenWatchdogs({
      promptEvalTimeoutMs: 5_000,
      firstTokenTimeoutMs: 5_000
    });
    controller.onFirstToken({ streamIdleTimeoutMs: 1_000, generationTimeoutMs: 10_000 });
    events.push("first");
    vi.advanceTimersByTime(1_100);
    expect(events).toContain("stream_idle_timeout");
    expect(outcomeForPhaseTimeout("stream_idle_timeout")).toBe("stream_idle_timeout");
    controller.clearAll();
    vi.useRealTimers();
  });
});
