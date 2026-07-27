/**
 * Provider tool budget estimates must match the agent-loop catalog injection.
 */

import { describe, expect, it } from "vitest";
import {
  estimateProviderToolBudget,
  messagesAlreadyIncludeToolCatalog
} from "@/services/providerToolBudget";
import { computeFinalRequestTokenBudget } from "@/services/finalRequestTokenBudget";
import { resolveWorkflowPhaseToolNames } from "@/services/workflowPhaseToolPolicy";

describe("providerToolBudget", () => {
  it("returns empty estimate when tools disabled", () => {
    const estimate = estimateProviderToolBudget({
      toolsEnabled: false,
      providerId: "llama-cpp",
      profile: "agent",
      workspaceRoot: "C:/demo"
    });
    expect(estimate.toolTokens).toBe(0);
    expect(estimate.toolSystemMessages).toHaveLength(0);
    expect(estimate.toolCount).toBe(0);
  });

  it("estimates full prompt-mode tool catalog for llama-cpp", () => {
    const estimate = estimateProviderToolBudget({
      toolsEnabled: true,
      providerId: "llama-cpp",
      profile: "agent",
      workspaceRoot: "C:/demo"
    });
    expect(estimate.protocolMode).toBe("prompt");
    expect(estimate.toolSystemMessages.length).toBeGreaterThan(0);
    expect(estimate.toolsText).toContain("[Tool Catalog]");
    expect(estimate.toolTokens).toBeGreaterThan(200);
    expect(estimate.toolBodyBytes).toBeGreaterThan(800);
    expect(estimate.toolCount).toBeGreaterThanOrEqual(5);
  });

  it("detects catalog already present in messages", () => {
    expect(
      messagesAlreadyIncludeToolCatalog([
        { id: "1", role: "system", content: "[Tool Catalog]\n- read_file: ..." }
      ])
    ).toBe(true);
    expect(
      messagesAlreadyIncludeToolCatalog([{ id: "1", role: "system", content: "hello" }])
    ).toBe(false);
  });

  it("forces overflow when catalog is counted into a tight 4k budget", () => {
    const estimate = estimateProviderToolBudget({
      toolsEnabled: true,
      providerId: "llama-cpp",
      profile: "agent",
      workspaceRoot: "C:/demo"
    });
    const budget = computeFinalRequestTokenBudget({
      runtimeContextLimit: 4096,
      systemText: "x".repeat(12_000),
      chatText: "Implementiere Electron",
      toolsText: estimate.toolsText,
      outputReserveTokens: 1024
    });
    expect(budget.toolTokens).toBeGreaterThan(200);
    expect(budget.totalRequiredTokens).toBeGreaterThan(4096);
    expect(budget.overflowTokens).toBeGreaterThan(0);
  });

  it("keeps the compact planning tool catalog below the old oversized threshold", () => {
    const estimate = estimateProviderToolBudget({
      toolsEnabled: true,
      providerId: "llama-cpp",
      profile: "full",
      workspaceRoot: "C:/demo",
      skillAllowedNames: resolveWorkflowPhaseToolNames({
        taskType: "planning",
        phase: "planning"
      })
    });

    expect(estimate.toolCount).toBeLessThanOrEqual(5);
    expect(estimate.toolBodyBytes).toBeLessThan(3000);
  });
});
