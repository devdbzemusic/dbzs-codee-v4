/**
 * Post-fallback request binding, phase/agent, and provider-delta gates.
 */

import { describe, expect, it } from "vitest";
import {
  assertPreparedRequestReady,
  assertPromptBindingMatches,
  buildPromptBindingDiagnostics,
  freezePreparedRuntimeRequest,
  hashPromptText
} from "@/services/preparedRuntimeRequest";
import { assertValidPhaseAgentPair } from "@/services/phaseAgentInvariant";
import {
  isModelContentDelta,
  normalizeProviderStreamDelta
} from "@/services/providerRuntimeEvents";
import {
  buildRequiredContextArtifactBlock,
  summarizePackageJson,
  summarizeViteConfig
} from "@/services/requiredContextArtifacts";
import {
  allocateTokensRemoved,
  buildDroppedContextSources
} from "@/services/droppedContextSources";
import {
  finalizeRuntimeRun,
  resetRuntimeRunFinalizationForTests
} from "@/services/runtimeRunFinalization";
import { resolveEffectiveRuntimeDevice } from "@/services/agentTurnBudget";

function makePreparedRequestInput(
  overrides: Partial<Parameters<typeof freezePreparedRuntimeRequest>[0]> = {}
): Parameters<typeof freezePreparedRuntimeRequest>[0] {
  return {
    runId: "run-default",
    turnIndex: 0,
    bindingDecisionId: "decision-1",
    workflowKind: "planning",
    phase: "planning",
    targetAgent: "planner",
    modelRole: "planning",
    toolProfile: "planner",
    modelId: "model-1",
    modelName: "Codestral",
    slotId: "quality_cpu",
    providerId: "llama-cpp",
    protocolMode: "prompt",
    messages: [{ id: "1", role: "user", content: "default" }],
    tools: [],
    contextVersion: 1,
    contextStage: 1,
    outputReserveTokens: 512,
    safetyMarginTokens: 256,
    ...overrides
  };
}

describe("preparedRuntimeRequest binding", () => {
  it("freezes post-fallback messages and matches sent hashes/tokens", () => {
    const pre = [
      { id: "1", role: "system" as const, content: "huge " + "x".repeat(8000) },
      { id: "2", role: "user" as const, content: "Implementiere Electron" }
    ];
    const post = [
      { id: "1", role: "system" as const, content: "goal capsule" },
      { id: "2", role: "user" as const, content: "Implementiere Electron" }
    ];
    const prepared = freezePreparedRuntimeRequest(makePreparedRequestInput({
      runId: "run-1",
      messages: post,
      tools: [{ name: "read_file" }],
      contextVersion: 2,
      contextStage: 3,
      outputReserveTokens: 512,
      safetyMarginTokens: 1000
    }));
    expect(prepared.source).toBe("post_fallback");
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.messages)).toBe(true);

    const binding = buildPromptBindingDiagnostics({
      preFallbackMessages: pre,
      postFallbackMessages: prepared.messages,
      sentMessages: prepared.messages
    });
    expect(assertPromptBindingMatches(prepared, binding).ok).toBe(true);
    expect(assertPreparedRequestReady(prepared, 4096).ok).toBe(true);
  });

  it("blocks when message + tool payload exceed limit", () => {
    const prepared = freezePreparedRuntimeRequest(makePreparedRequestInput({
      runId: "run-tools",
      messages: [{ id: "1", role: "user", content: "x".repeat(8000) }],
      tools: [{ name: "read_file" }],
      outputReserveTokens: 1024,
      safetyMarginTokens: 0,
      toolPayloadTokens: 2500
    }));
    expect(assertPreparedRequestReady(prepared, 4096).ok).toBe(false);
  });

  it("blocks provider call when sent hash diverges from post-fallback", () => {
    const post = [{ id: "1", role: "user" as const, content: "post" }];
    const prepared = freezePreparedRuntimeRequest(makePreparedRequestInput({
      runId: "run-2",
      messages: post,
      contextVersion: 2,
      outputReserveTokens: 256,
      safetyMarginTokens: 100
    }));
    const binding = buildPromptBindingDiagnostics({
      preFallbackMessages: post,
      postFallbackMessages: prepared.messages,
      sentMessages: [{ id: "1", role: "user", content: "DIFFERENT PRE FALLBACK" }]
    });
    expect(assertPromptBindingMatches(prepared, binding).ok).toBe(false);
  });

  it("produces stable prompt hashes", () => {
    expect(hashPromptText("abc")).toBe(hashPromptText("abc"));
    expect(hashPromptText("abc")).not.toBe(hashPromptText("abd"));
  });
});

describe("phase/agent invariant", () => {
  it("allows planning+planner and implementation+coder", () => {
    expect(assertValidPhaseAgentPair("planning", "planner").ok).toBe(true);
    expect(assertValidPhaseAgentPair("implementation", "coder").ok).toBe(true);
    expect(assertValidPhaseAgentPair("review", "reviewer").ok).toBe(true);
  });

  it("blocks implementation+planner", () => {
    const result = assertValidPhaseAgentPair("implementation", "planner");
    expect(result.ok).toBe(false);
  });
});

describe("provider content delta gate", () => {
  it("rejects overflow/safe-fallback text as model content", () => {
    expect(
      isModelContentDelta("Die Anfrage ist größer als das aktuelle Runtime-Kontextfenster.")
    ).toBe(false);
    expect(isModelContentDelta("ok", { safeFallback: true })).toBe(false);
    expect(isModelContentDelta("Hello from the model")).toBe(true);
  });

  it("normalizes error text to provider_error events", () => {
    const event = normalizeProviderStreamDelta(
      "Die Anfrage ist größer als das aktuelle Runtime-Kontextfenster."
    );
    expect(event.type).toBe("provider_error");
  });
});

describe("required context artifacts", () => {
  it("keeps package/vite summaries", () => {
    const pkg = summarizePackageJson(
      JSON.stringify({
        name: "demo",
        scripts: { dev: "vite", build: "tsc" },
        dependencies: { react: "18" },
        devDependencies: { vite: "5" }
      })
    );
    expect(pkg).toContain("demo");
    expect(pkg).toContain("dev");
    const vite = summarizeViteConfig(`
      import electron from 'vite-plugin-electron'
      export default { plugins: [electron()], build: { outDir: 'dist' } }
    `);
    expect(vite.toLowerCase()).toMatch(/electron|outdir|plugin/);

    const block = buildRequiredContextArtifactBlock({
      workspace: {
        rootPath: "C:/proj",
        name: "proj",
        fileTree: ["package.json", "package-lock.json", "vite.config.ts"],
        sampledFiles: [
          {
            path: "C:/proj/package.json",
            relativePath: "package.json",
            language: "json",
            content: JSON.stringify({ name: "proj", scripts: { dev: "vite" } })
          },
          {
            path: "C:/proj/vite.config.ts",
            relativePath: "vite.config.ts",
            language: "typescript",
            content: "export default { plugins: [] }"
          }
        ]
      },
      approvalState: "phase=implementation"
    });
    expect(block.artifacts).toContain("package_manifest");
    expect(block.artifacts).toContain("build_config");
    expect(block.artifacts).toContain("lockfile_summary");
    expect(block.text).toContain("Required Context");
  });
});

describe("drop accounting", () => {
  it("sums tokensRemoved to the fallback reduction", () => {
    const removed = allocateTokensRemoved(["a", "b"], 6626, 2448);
    expect(removed.a + removed.b).toBe(4178);
    const sources = buildDroppedContextSources(["a", "b"], "context_overflow", removed, {
      tokensBefore: 6626,
      tokensAfter: 2448
    });
    expect(sources.every((s) => s.tokensRemoved > 0)).toBe(true);
  });
});

describe("provider request hard budget", () => {
  it("erkennt den Diagnosefall 2262 + 1170 + 1024 als Overflow", () => {
    const prepared = freezePreparedRuntimeRequest(makePreparedRequestInput({
      runId: "run-mrxclmuh-q0ck",
      messages: [{ id: "m", role: "user", content: "diagnostic" }],
      tools: [{ name: "read_file" }],
      promptTokens: 2262,
      toolPayloadTokens: 1170,
      outputReserveTokens: 1024,
      safetyMarginTokens: 0
    }));
    expect(assertPreparedRequestReady(prepared, 4096)).toMatchObject({
      ok: false
    });
    expect(prepared.promptTokens + prepared.toolPayloadTokens + prepared.outputReserveTokens)
      .toBe(4456);
  });
});

describe("finalization provider errors", () => {
  it("skips parser and avoids false context_overflow when budget has margin", () => {
    resetRuntimeRunFinalizationForTests();
    const result = finalizeRuntimeRun({
      runId: "run-pf-1",
      outcome: "success",
      finalAnswer: "Die Anfrage ist größer als das aktuelle Runtime-Kontextfenster.",
      safeFallback: true,
      providerError: true,
      parserSkippedReason: "provider_error",
      contextWindowTokens: 4096,
      totalRequiredTokens: 2448
    });
    expect(result.outcome).toBe("generation_failed");
    expect(result.diagnostics.parserSucceeded).toBe(false);
    expect(result.diagnostics.parserSkippedReason).toBe("provider_error");
  });
});

describe("effective device honesty", () => {
  it("maps gpuLayers=0 to cpu", () => {
    expect(resolveEffectiveRuntimeDevice({ configuredSlot: "fast_gpu", gpuLayers: 0 }).effectiveDevice).toBe("cpu");
    expect(resolveEffectiveRuntimeDevice({ configuredSlot: "fast_gpu", gpuLayers: 33 }).effectiveDevice).toBe("gpu");
    expect(
      resolveEffectiveRuntimeDevice({ configuredSlot: "fast_gpu", gpuLayers: 20, cpuOffloadLayers: 4 }).effectiveDevice
    ).toBe("hybrid");
  });
});
