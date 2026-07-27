import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_ALWAYS_EXPOSED,
  DISCLOSURE_THRESHOLD,
  isToolExposed,
  resolveToolExposure
} from "@/runtime/tool/toolDisclosure";
import { createDefaultToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import {
  ensureRuntimeKernelInitialized,
  resetRuntimeKernelForTests
} from "@/services/runtimeKernelService";

const fullContext = createDefaultToolAvailabilityContext("D:/repo", {
  hasGitRepo: true,
  hasTerminalBridge: true,
  hasTestCommands: true
});

describe("toolDisclosure", () => {
  beforeEach(async () => {
    resetRuntimeKernelForTests();
    await ensureRuntimeKernelInitialized();
  });

  it("uses full mode when catalog is below threshold", () => {
    const exposure = resolveToolExposure("ask", fullContext);
    expect(exposure.mode).toBe("full");
    expect(exposure.bridgeActive).toBe(false);
    expect(exposure.exposedNames.length).toBeLessThanOrEqual(DISCLOSURE_THRESHOLD);
  });

  it("uses bridge mode for large agent catalogs and keeps core tools exposed", () => {
    const exposure = resolveToolExposure("agent", fullContext);
    expect(exposure.mode).toBe("bridge");
    expect(exposure.bridgeActive).toBe(true);
    for (const name of CORE_ALWAYS_EXPOSED) {
      expect(exposure.exposedNames).toContain(name);
    }
    expect(exposure.exposedNames).toContain("tool_search");
    expect(exposure.exposedNames).toContain("tool_describe");
    expect(exposure.exposedNames).toContain("tool_call");
  });

  it("blocks deferred tools with guidance when bridge is active", () => {
    const exposure = resolveToolExposure("agent", fullContext);
    expect(exposure.bridgeActive).toBe(true);

    const deferred = exposure.deferrableNames[0];
    expect(deferred).toBeTruthy();

    const check = isToolExposed("agent", fullContext, deferred!);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("tool_search");
  });

  it("blocks unavailable tools with reason", () => {
    const ctx = createDefaultToolAvailabilityContext("D:/repo", { hasGitRepo: false });
    const check = isToolExposed("agent", ctx, "get_git_diff");
    expect(check.allowed).toBe(false);
    expect(check.reason).toBeTruthy();
  });
});
