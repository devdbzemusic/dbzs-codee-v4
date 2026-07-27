import { beforeEach, describe, expect, it } from "vitest";
import { listExposedToolNames } from "@/runtime/agent/toolProtocolAdapter";
import { createDefaultToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import {
  ensureRuntimeKernelInitialized,
  resetRuntimeKernelForTests
} from "@/services/runtimeKernelService";

describe("toolProtocolAdapter", () => {
  beforeEach(async () => {
    resetRuntimeKernelForTests();
    await ensureRuntimeKernelInitialized();
  });

  it("excludes git tools when repository is unavailable", () => {
    const ctx = createDefaultToolAvailabilityContext("D:/repo", { hasGitRepo: false });
    const exposed = listExposedToolNames("agent", ctx);
    expect(exposed).not.toContain("get_git_diff");
  });

  it("includes bridge tools in bridge mode", () => {
    const ctx = createDefaultToolAvailabilityContext("D:/repo", {
      hasGitRepo: true,
      hasTerminalBridge: true,
      hasTestCommands: true
    });
    const exposed = listExposedToolNames("agent", ctx);
    expect(exposed).toContain("tool_search");
    expect(exposed).toContain("tool_call");
  });
});
