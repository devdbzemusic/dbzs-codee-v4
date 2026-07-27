import { describe, expect, it } from "vitest";
import type { ContextCollector, ContextSourceType } from "@/runtime/context/contextContracts";
import { ContextPipeline } from "@/runtime/context/contextPipeline";

function collector(
  id: string,
  signals: Array<{ key: string; value: string; source?: ContextSourceType }>
): ContextCollector {
  return {
    id,
    collect: async () =>
      signals.map((signal) => ({
        source: signal.source ?? "workspace",
        key: signal.key,
        value: signal.value
      }))
  };
}

describe("ContextPipeline", () => {
  it("respects token budget", async () => {
    const pipeline = new ContextPipeline([
      collector("a", [
        { key: "k1", value: "alpha beta gamma" },
        { key: "k2", value: "delta epsilon zeta eta theta" }
      ])
    ]);

    const result = await pipeline.buildPromptContext({
      userGoal: "alpha",
      maxTokens: 6
    });

    expect(result.estimatedTokens).toBeLessThanOrEqual(6);
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it("summarizes selected sources", async () => {
    const pipeline = new ContextPipeline([
      collector("a", [{ key: "active", value: "const test = 1;", source: "active_file" }]),
      collector("b", [{ key: "diff", value: "@@ -1 +1 @@", source: "git_diff" }])
    ]);

    const result = await pipeline.buildPromptContext({
      userGoal: "review",
      maxTokens: 100
    });

    expect(result.summary).toContain("active_file:1");
    expect(result.summary).toContain("git_diff:1");
  });
});
