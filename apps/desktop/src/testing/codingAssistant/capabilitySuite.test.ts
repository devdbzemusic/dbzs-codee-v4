import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bootstrapCapabilityHarness, getCapabilityScenarios } from "./capabilityScenarios";
import { formatCapabilityReport, runCapabilityScenarios } from "./capabilityTypes";
import { resolveFixtureWorkspaceRoot } from "./fixtureWorkspace";
import { loadUseCaseCatalog } from "./useCaseCatalog";

const runCapabilitySuite = process.env.RUN_CAPABILITY_SUITE === "1";
const capabilityDescribe = runCapabilitySuite ? describe : describe.skip;

capabilityDescribe("Coding Assistant Capability Suite", () => {
  beforeAll(() => {
    const root = resolveFixtureWorkspaceRoot();
    expect(root).toBeTruthy();
  });

  beforeEach(async () => {
    await bootstrapCapabilityHarness();
  });

  afterEach(() => {
    // Harness resets stores on next bootstrap.
  });

  for (const scenario of getCapabilityScenarios()) {
    it(`[${scenario.category}] ${scenario.id}: ${scenario.title}`, async () => {
      const result = await scenario.run();
      if (result.status === "fail") {
        console.warn(`Capability hint (${scenario.id}): ${result.improvementHint ?? scenario.improvementHint ?? result.message}`);
      }
      expect(result.status, result.message).toBe("pass");
    });
  }

  it("generates improvement backlog report", async () => {
    const scenarios = getCapabilityScenarios();
    const report = await runCapabilityScenarios(scenarios, { beforeScenario: bootstrapCapabilityHarness });
    const formatted = formatCapabilityReport(report);
    const catalog = loadUseCaseCatalog();

    expect(report.total).toBe(scenarios.length);
    expect(report.total).toBeGreaterThanOrEqual(catalog.scenarios.filter((s) => s.layers.includes("vitest")).length);
    expect(formatted).toContain("Coding Assistant Capability Report");

    if (process.env.CAPABILITY_REPORT === "1" || report.failed > 0) {
      const outDir = path.resolve(process.cwd(), "test-results");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "capability-report.txt"), formatted, "utf8");
    }

    expect(report.failed).toBe(0);
  });
});
