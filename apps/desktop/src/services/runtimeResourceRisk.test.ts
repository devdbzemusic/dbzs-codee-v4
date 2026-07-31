import { describe, expect, it } from "vitest";
import { buildResourceRiskQuestion } from "./runtimeResourceRisk";

describe("buildResourceRiskQuestion", () => {
  it("names the affected slot and offers a concrete alternative model when available", () => {
    const question = buildResourceRiskQuestion({
      roleLabel: "Rollen",
      modelName: "Qwen2.5-Coder-7B-Instruct-Q4-K-M-GGUF",
      slotId: "fast_gpu",
      risk: "high",
      reasons: ["vram_ratio_0.91"],
      residentModelName: "Phi-3.5-mini-instruct"
    });

    expect(question.prompt).toContain("Slot fast_gpu");
    expect(question.prompt).toContain("Qwen2.5-Coder-7B-Instruct-Q4-K-M-GGUF");
    expect(question.context).toContain("Betroffener Slot: fast_gpu");
    expect(question.context).toContain("Konfiguriertes Modell: Qwen2.5-Coder-7B-Instruct-Q4-K-M-GGUF");
    expect(question.context).toContain("Phi-3.5-mini-instruct");
    expect(question.defaultOptionId).toBe("continue_with_resident");
    expect(question.options?.[0]).toMatchObject({
      id: "continue_with_resident",
      recommended: true
    });
    expect(question.options?.[0]?.label).toContain("Phi-3.5-mini-instruct");
  });

  it("keeps a model-selection option scoped to the affected slot", () => {
    const question = buildResourceRiskQuestion({
      roleLabel: "Review",
      modelName: "Large-Coder-Model",
      slotId: "vision_gpu",
      risk: "unsupported",
      reasons: ["estimated_vram_exceeds_available"]
    });

    expect(question.prompt).toContain("Slot vision_gpu");
    expect(question.prompt).toContain("Large-Coder-Model");
    expect(question.defaultOptionId).toBe("smaller_profile");
    expect(question.options?.find((option) => option.id === "choose_other_model")?.label).toContain(
      "Slot vision_gpu"
    );
  });
});
