import { describe, expect, it } from "vitest";
import { canaryStageLabel, isRunInCanary, shouldStopForShadowMismatch } from "@/services/runtimeChatRollout";

describe("runtimeChatRollout", () => {
  it("maps canary stage boundaries correctly", () => {
    expect(canaryStageLabel(-1)).toBe("legacy-0");
    expect(canaryStageLabel(0)).toBe("legacy-0");
    expect(canaryStageLabel(1)).toBe("canary-5");
    expect(canaryStageLabel(5)).toBe("canary-5");
    expect(canaryStageLabel(6)).toBe("canary-25");
    expect(canaryStageLabel(25)).toBe("canary-25");
    expect(canaryStageLabel(26)).toBe("canary-50");
    expect(canaryStageLabel(50)).toBe("canary-50");
    expect(canaryStageLabel(51)).toBe("canary-100");
    expect(canaryStageLabel(100)).toBe("canary-100");
  });

  it("is deterministic per run id", () => {
    const runId = "run-stable-123";
    const first = isRunInCanary(runId, 25);
    const second = isRunInCanary(runId, 25);
    expect(first).toBe(second);
  });

  it("honors 0% and 100% gates", () => {
    expect(isRunInCanary("run-a", 0)).toBe(false);
    expect(isRunInCanary("run-b", -10)).toBe(false);
    expect(isRunInCanary("run-c", 100)).toBe(true);
    expect(isRunInCanary("run-d", 150)).toBe(true);
  });

  it("stops only when mismatch gate is enabled", () => {
    expect(
      shouldStopForShadowMismatch({
        shadowMode: true,
        stopOnShadowMismatch: true,
        shadowMatch: false
      })
    ).toBe(true);

    expect(
      shouldStopForShadowMismatch({
        shadowMode: true,
        stopOnShadowMismatch: true,
        shadowMatch: true
      })
    ).toBe(false);

    expect(
      shouldStopForShadowMismatch({
        shadowMode: true,
        stopOnShadowMismatch: false,
        shadowMatch: false
      })
    ).toBe(false);

    expect(
      shouldStopForShadowMismatch({
        shadowMode: false,
        stopOnShadowMismatch: true,
        shadowMatch: false
      })
    ).toBe(false);
  });
});
