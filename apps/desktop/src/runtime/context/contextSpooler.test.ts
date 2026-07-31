import { describe, it, expect } from "vitest";
import { ContextSpooler, buildTokenBudget, estimateTokensCharHeuristic, type SpoolerLaneItem } from "./contextSpooler";

function item(id: string, tokens: number, overrides: Partial<SpoolerLaneItem> = {}): SpoolerLaneItem {
  return { id, content: "x".repeat(tokens * 4), estimatedTokens: tokens, ...overrides };
}

describe("buildTokenBudget", () => {
  it("is in the same ballpark as the spec's 4096-token worked example (output=900, tool=300, safety=200)", () => {
    const budget = buildTokenBudget(4096);

    expect(budget.contextWindowTokens).toBe(4096);
    expect(Math.abs(budget.reservedOutputTokens - 900)).toBeLessThan(30);
    expect(Math.abs(budget.reservedToolTokens - 300)).toBeLessThan(30);
    expect(Math.abs(budget.safetyReserveTokens - 200)).toBeLessThan(30);
  });

  it("never lets input + output + tool + safety exceed the context window", () => {
    const budget = buildTokenBudget(4096);
    const maxInput = budget.contextWindowTokens - budget.reservedOutputTokens - budget.reservedToolTokens - budget.safetyReserveTokens;

    expect(
      budget.maxSystemTokens + budget.maxTaskTokens + budget.maxCodeTokens + budget.maxHistoryTokens + budget.maxMemoryTokens
    ).toBeLessThanOrEqual(maxInput);
  });
});

describe("ContextSpooler.assemble", () => {
  it("acceptance: mandatory content is always included in full, never trimmed", () => {
    const budget = buildTokenBudget(4096);
    const hugeMandatory = [item("system", 100000)]; // far larger than any lane budget
    const spooler = new ContextSpooler(budget);

    const { lanes, manifest } = spooler.assemble({
      requestId: "req-1",
      modelId: "model-1",
      role: "coding",
      mandatory: hugeMandatory,
      activeTask: [],
      relevantCode: [],
      recentConversation: [],
      retrievedMemory: []
    });

    const mandatoryLane = lanes.find((l) => l.lane === "mandatory")!;
    expect(mandatoryLane.included).toEqual(hugeMandatory);
    expect(mandatoryLane.droppedIds).toEqual([]);
  });

  it("acceptance: output/tool/safety reserve is never touched by lane allocation", () => {
    const budget = buildTokenBudget(4096);
    const spooler = new ContextSpooler(budget);

    const { manifest } = spooler.assemble({
      requestId: "req-1",
      modelId: "model-1",
      role: "coding",
      mandatory: [item("system", 50)],
      activeTask: [item("task", 100000)],
      relevantCode: [item("code", 100000)],
      recentConversation: [item("msg", 100000)],
      retrievedMemory: [item("mem", 100000)]
    });

    expect(manifest.inputTokens).toBeLessThanOrEqual(
      manifest.contextWindowTokens - manifest.reservedOutputTokens - manifest.reservedToolTokens - manifest.safetyReserveTokens
    );
    expect(manifest.reservedOutputTokens).toBe(budget.reservedOutputTokens);
  });

  it("acceptance: 20 files + long history + big tool log + 4096 window stays within budget", () => {
    const budget = buildTokenBudget(4096);
    const spooler = new ContextSpooler(budget);
    const relevantCode = Array.from({ length: 20 }, (_, i) => item(`file-${i}`, 400)); // 8000 tokens of "excerpts"
    const recentConversation = Array.from({ length: 50 }, (_, i) => item(`turn-${i}`, 200)); // 10000 tokens of history
    const retrievedMemory = [item("tool-log-overflow", 5000)];

    const { manifest, lanes } = spooler.assemble({
      requestId: "req-1",
      modelId: "model-1",
      role: "coding",
      mandatory: [item("system", 300)],
      activeTask: [item("plan", 200)],
      relevantCode,
      recentConversation,
      retrievedMemory
    });

    expect(
      manifest.inputTokens + manifest.reservedOutputTokens + manifest.reservedToolTokens + manifest.safetyReserveTokens
    ).toBeLessThanOrEqual(manifest.contextWindowTokens);
    const mandatoryLane = lanes.find((l) => l.lane === "mandatory")!;
    expect(mandatoryLane.droppedIds).toEqual([]);
    expect(manifest.droppedSections.length).toBeGreaterThan(0); // not everything fit — some was dropped, not silently included
  });

  it("acceptance: relevant_code lane is budget-capped, so callers must pass excerpts not whole files", () => {
    const budget = buildTokenBudget(4096);
    const spooler = new ContextSpooler(budget);
    const wholeFiles = [item("huge-file-1", 50000), item("huge-file-2", 50000)];

    const { lanes, manifest } = spooler.assemble({
      requestId: "req-1",
      modelId: "model-1",
      role: "coding",
      mandatory: [],
      activeTask: [],
      relevantCode: wholeFiles,
      recentConversation: [],
      retrievedMemory: []
    });

    const codeLane = lanes.find((l) => l.lane === "relevant_code")!;
    expect(codeLane.included.length).toBe(0); // neither whole file fits -> both dropped, budget respected
    expect(codeLane.droppedIds).toEqual(["huge-file-1"]);
    expect(manifest.duplicateContextRemoved).toBe(1);
  });

  it("acceptance: history trimming keeps the newest turns, drops the oldest first", () => {
    const budget = buildTokenBudget(4096);
    const spooler = new ContextSpooler(budget);
    // oldest -> newest; way more than fits in the history lane budget
    const conversation = Array.from({ length: 100 }, (_, i) => item(`turn-${i}`, 50));

    const { lanes } = spooler.assemble({
      requestId: "req-1",
      modelId: "model-1",
      role: "coding",
      mandatory: [],
      activeTask: [],
      relevantCode: [],
      recentConversation: conversation,
      retrievedMemory: []
    });

    const historyLane = lanes.find((l) => l.lane === "recent_conversation")!;
    expect(historyLane.included.length).toBeGreaterThan(0);
    expect(historyLane.included.length).toBeLessThan(conversation.length);
    const includedIndices = historyLane.included.map((i) => Number(i.id.split("-")[1]));
    const droppedIndices = historyLane.droppedIds.map((id) => Number(id.split("-")[1]));
    expect(Math.min(...includedIndices)).toBeGreaterThan(Math.max(...droppedIndices)); // newest kept, oldest dropped
  });

  it("keeps repeated conversation turns as distinct chronological messages", () => {
    const budget = buildTokenBudget(4096);
    const spooler = new ContextSpooler(budget);

    const { lanes, manifest } = spooler.assemble({
      requestId: "req-1",
      modelId: "model-1",
      role: "coding",
      mandatory: [],
      activeTask: [],
      relevantCode: [],
      recentConversation: [
        item("turn-1", 20, { content: "Bitte nochmal prüfen" }),
        item("turn-2", 20, { content: "Bitte nochmal prüfen" })
      ],
      retrievedMemory: []
    });

    const historyLane = lanes.find((l) => l.lane === "recent_conversation")!;
    expect(historyLane.included.map((entry) => entry.id)).toEqual(["turn-1", "turn-2"]);
    expect(manifest.duplicateContextRemoved).toBe(0);
  });

  it("deduplicates workspace file samples against retrieval excerpts by source and content", () => {
    const spooler = new ContextSpooler(buildTokenBudget(4096));
    const result = spooler.assemble({
      requestId: "dedupe-workspace",
      modelId: "model-1",
      role: "coding",
      mandatory: [],
      activeTask: [item("workspace-file", 20, { source: "src/runtime.ts", dedupeContent: "same excerpt" })],
      relevantCode: [],
      retrievedContext: [item("rag-duplicate", 20, { source: "src\\runtime.ts", dedupeContent: "same excerpt" })],
      recentConversation: [],
      projectMemory: []
    });

    const retrieval = result.lanes.find((entry) => entry.lane === "retrieved_context");
    expect(retrieval?.included).toEqual([]);
    expect(result.manifest.duplicateContextRemoved).toBe(1);
  });

  it("keeps pinned active-task items even when the active-task lane is otherwise over budget", () => {
    const spooler = new ContextSpooler(buildTokenBudget(4096));
    const result = spooler.assemble({
      requestId: "pinned-active-task",
      modelId: "model-1",
      role: "coding",
      mandatory: [item("system", 600)],
      activeTask: [
        item("workspace-file", 400, { pinned: true, source: "docs/spec.md" }),
        item("workspace-summary", 80)
      ],
      relevantCode: [],
      recentConversation: [],
      projectMemory: []
    });

    const activeTask = result.lanes.find((entry) => entry.lane === "active_task");
    expect(activeTask?.included.map((entry) => entry.id)).toContain("workspace-file");
    expect(activeTask?.droppedIds).not.toContain("workspace-file");
  });

  it("does not drop anything when everything fits comfortably", () => {
    const budget = buildTokenBudget(200_000); // large window, small content
    const spooler = new ContextSpooler(budget);

    const { manifest } = spooler.assemble({
      requestId: "req-1",
      modelId: "model-1",
      role: "coding",
      mandatory: [item("system", 100)],
      activeTask: [item("task", 50)],
      relevantCode: [item("code", 50)],
      recentConversation: [item("turn-1", 50)],
      retrievedMemory: [item("mem", 50)]
    });

    expect(manifest.droppedSections).toEqual([]);
  });

  it("budgets repository retrieval independently and records source references", () => {
    const spooler = new ContextSpooler(buildTokenBudget(4096));
    const result = spooler.assemble({
      requestId: "rag-request",
      modelId: "model-1",
      role: "coding",
      mandatory: [], activeTask: [], relevantCode: [], recentConversation: [], projectMemory: [],
      retrievedContext: [item("rag-1", 100, { source: "src/runtime.ts:10" })]
    });
    const lane = result.lanes.find((entry) => entry.lane === "retrieved_context");
    expect(lane?.included.map((entry) => entry.id)).toEqual(["rag-1"]);
    expect(result.manifest.sections).toContainEqual(expect.objectContaining({ type: "retrieved_context", source: "src/runtime.ts:10" }));
  });

  it("lets active/relevant context win over duplicate retrieval items", () => {
    const spooler = new ContextSpooler(buildTokenBudget(4096));
    const result = spooler.assemble({
      requestId: "dedupe", modelId: "model-1", role: "coding", mandatory: [], activeTask: [],
      relevantCode: [item("active-code", 20, { source: "src/runtime.ts", dedupeContent: "same excerpt" })],
      retrievedContext: [item("rag-duplicate", 20, { source: "src\\runtime.ts", dedupeContent: "same excerpt" })],
      recentConversation: [], projectMemory: []
    });
    const retrieval = result.lanes.find((entry) => entry.lane === "retrieved_context");
    expect(retrieval?.included).toEqual([]);
    expect(result.manifest.duplicateContextRemoved).toBe(1);
    expect(result.manifest.duplicateTokenSavings).toBe(20);
  });
});

describe("estimateTokensCharHeuristic", () => {
  it("is the documented conservative chars/4 fallback", () => {
    expect(estimateTokensCharHeuristic("abcd")).toBe(1);
    expect(estimateTokensCharHeuristic("a".repeat(100))).toBe(25);
    expect(estimateTokensCharHeuristic("")).toBe(1); // never returns 0
  });
});
