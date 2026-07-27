import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureWorkspaceFiles, resolveNamedFixtureWorkspaceRoot } from "./fixtureWorkspace";

const runCapabilitySuite = process.env.RUN_CAPABILITY_SUITE === "1";
const capabilityDescribe = runCapabilitySuite ? describe : describe.skip;

interface TuningLabScenario {
  id: string;
  intent: string;
  pipeline: string;
  workflow: string;
  prompt: string;
  requiresModel: boolean;
  expected?: Record<string, unknown>;
}

interface TuningLabCatalog {
  version: number;
  workspaceId: string;
  description: string;
  useCases: TuningLabScenario[];
}

capabilityDescribe("Runtime Chat Tuning Lab Capability Suite", () => {
  let fixtureRoot = "";
  let projectFiles: Awaited<ReturnType<typeof loadFixtureWorkspaceFiles>>["projectFiles"] = [];
  let fileContents = new Map<string, string>();
  let catalog: TuningLabCatalog;

  beforeAll(async () => {
    fixtureRoot = resolveNamedFixtureWorkspaceRoot("runtime-chat-tuning-lab", ["test-fixtures"]);
    const fixture = await loadFixtureWorkspaceFiles(fixtureRoot);
    projectFiles = fixture.projectFiles;
    fileContents = fixture.fileContents;
    const rawCatalog = fileContents.get("scenarios.json");
    expect(rawCatalog).toBeTruthy();
    catalog = JSON.parse(rawCatalog ?? "{}") as TuningLabCatalog;
  });

  it("loads the advanced tuning lab fixture", () => {
    expect(fixtureRoot).toContain("runtime-chat-tuning-lab");
    expect(projectFiles.length).toBeGreaterThanOrEqual(12);
  });

  it("contains direct-intent workspace coverage with three gguf models", () => {
    const ggufFiles = projectFiles
      .map((file) => file.relativePath)
      .filter((relativePath) => relativePath.endsWith(".gguf"));

    expect(ggufFiles).toEqual([
      "models/qwen/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf",
      "models/qwen/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
      "models/utility/embedding-small.gguf"
    ]);

    const countScenario = catalog.useCases.find((scenario) => scenario.id === "workspace-count-gguf");
    expect(countScenario?.intent).toBe("workspace_query");
    expect(countScenario?.pipeline).toBe("direct_intent");
    expect(countScenario?.requiresModel).toBe(false);
    expect(countScenario?.expected?.count).toBe(3);
  });

  it("covers review, refactor, debug, approval, planning and continuation workflows", () => {
    const intents = new Set(catalog.useCases.map((scenario) => scenario.intent));
    const pipelines = new Set(catalog.useCases.map((scenario) => scenario.pipeline));

    for (const intent of [
      "workspace_query",
      "review",
      "refactor",
      "debug",
      "implement",
      "approval",
      "plan",
      "continuation",
      "meta_status"
    ]) {
      expect(intents.has(intent), `Missing intent ${intent}`).toBe(true);
    }

    for (const pipeline of [
      "direct_intent",
      "review_pipeline",
      "implementation_pipeline",
      "debug_pipeline",
      "workflow_continuation",
      "planning_pipeline"
    ]) {
      expect(pipelines.has(pipeline), `Missing pipeline ${pipeline}`).toBe(true);
    }
  });

  it("contains concrete high-risk files for review and debugging", () => {
    expect(fileContents.get("src/core/priceEngine.ts")).toContain("vipDiscountPercent");
    expect(fileContents.get("src/services/cacheRegistry.ts")).toContain("purgeExpired");
    expect(fileContents.get("src/api/reviewController.ts")).toContain("request.selectedPaths.join");
    expect(fileContents.get("src/runtime/runtimeProbe.ts")).toContain('diagnostics: []');
    expect(fileContents.get("src/legacy/normalizeOwner.ts")).toContain("Team ");
  });

  it("contains a real security-oriented shell/path scenario", () => {
    const reviewController = fileContents.get("src/api/reviewController.ts") ?? "";
    const searchScenario = catalog.useCases.find((scenario) => scenario.id === "workspace-search-shell");
    const securityScenario = catalog.useCases.find((scenario) => scenario.id === "security-review-controller");

    expect(reviewController).toContain("codee review");
    expect(reviewController).toContain("path.resolve");
    expect(searchScenario?.requiresModel).toBe(false);
    expect(securityScenario?.intent).toBe("review");
    expect(securityScenario?.pipeline).toBe("review_pipeline");
  });

  it("models safe-scope and approval-boundary behavior", () => {
    const safeScenario = catalog.useCases.find((scenario) => scenario.id === "implementation-safe-scope");
    const approvalScenario = catalog.useCases.find((scenario) => scenario.id === "approval-legacy-boundary");

    expect(safeScenario?.expected?.approvalBoundary).toBe("src/legacy");
    expect(approvalScenario?.expected?.needsApproval).toBe(true);
  });
});
