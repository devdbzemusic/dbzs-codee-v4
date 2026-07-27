import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildFixAndTestPatchJson,
  buildPatchJson,
  fixedSubtractContent,
  FIXTURE_CALCULATOR_PATH,
  FIXTURE_CALCULATOR_TEST_PATH,
  FIXTURE_GREET_PATH,
  multiplyCalculatorContent,
  multiplyTestFileContent,
  refactorGreetContent,
  resolveFixtureWorkspaceRoot
} from "./fixtureWorkspace";

export type UseCaseLayer = "vitest" | "e2e" | "live" | "backend";

export interface UseCaseScenario {
  id: string;
  category: string;
  title: string;
  description: string;
  prompt?: string;
  layers: UseCaseLayer[];
  targetAgent?: string;
  skillId?: string;
  agentMode?: boolean;
  mockResponse?: string;
  mockResponseType?: string;
  takeoverProposal?: string;
  takeoverProposalType?: string;
  expectKeywords?: string[];
  mustNotContain?: string[];
  expectPatchQueue?: boolean;
  expectJobEnqueue?: boolean;
  expectToolCalls?: string[];
  expectActivitySteps?: string[];
  expectPolicy?: "allow" | "forbidden" | "prompt";
  command?: string;
  runtimeState?: "running" | "stopped";
  improvementHint?: string;
  expectSendFalse?: boolean;
  expectPatchCount?: number;
  /** Live-Probe: mindestens ein Keyword pro Gruppe muss vorkommen */
  expectKeywordGroups?: string[][];
}

export interface UseCaseCatalog {
  version: number;
  workspaceId: string;
  description: string;
  scenarios: UseCaseScenario[];
}

export function loadUseCaseCatalog(root = resolveFixtureWorkspaceRoot()): UseCaseCatalog {
  const catalogPath = path.join(root, "scenarios.json");
  const raw = readFileSync(catalogPath, "utf8");
  return JSON.parse(raw) as UseCaseCatalog;
}

export function getScenariosByLayer(layer: UseCaseLayer, catalog = loadUseCaseCatalog()): UseCaseScenario[] {
  return catalog.scenarios.filter((scenario) => scenario.layers.includes(layer));
}

export function getScenarioById(id: string, catalog = loadUseCaseCatalog()): UseCaseScenario | undefined {
  return catalog.scenarios.find((scenario) => scenario.id === id);
}

export function resolveMockResponse(scenario: UseCaseScenario): string {
  if (scenario.mockResponse) {
    return scenario.mockResponse;
  }

  switch (scenario.mockResponseType ?? scenario.takeoverProposalType) {
    case "patch-calculator-fix":
      return buildPatchJson(FIXTURE_CALCULATOR_PATH, fixedSubtractContent(), "Fix subtract bug");
    case "patch-add-multiply":
      return buildPatchJson(FIXTURE_CALCULATOR_PATH, multiplyCalculatorContent(), "Add multiply");
    case "patch-refactor-greet":
      return buildPatchJson(FIXTURE_GREET_PATH, refactorGreetContent(), "Extract DEFAULT_GREETING");
    case "tool-list-files":
      return [
        "<CODEE_TOOL_CALL>",
        JSON.stringify({ name: "list_files", arguments: { path: "src" } }),
        "</CODEE_TOOL_CALL>"
      ].join("\n");
    case "tool-read-file":
      return [
        "<CODEE_TOOL_CALL>",
        JSON.stringify({ name: "read_file", arguments: { path: FIXTURE_CALCULATOR_PATH } }),
        "</CODEE_TOOL_CALL>"
      ].join("\n");
    case "tool-read-greet":
      return [
        "<CODEE_TOOL_CALL>",
        JSON.stringify({ name: "read_file", arguments: { path: FIXTURE_GREET_PATH } }),
        "</CODEE_TOOL_CALL>"
      ].join("\n");
    case "patch-multi-file-fix-test":
      return buildFixAndTestPatchJson();
    case "patch-add-multiply-test":
      return buildPatchJson(FIXTURE_CALCULATOR_TEST_PATH, multiplyTestFileContent(), "Add multiply tests");
    default:
      return `Mock-Antwort fuer ${scenario.id}`;
  }
}

export function resolveTakeoverProposal(scenario: UseCaseScenario): string {
  if (scenario.takeoverProposal) {
    return scenario.takeoverProposal;
  }
  if (scenario.takeoverProposalType) {
    return resolveMockResponse({ ...scenario, mockResponseType: scenario.takeoverProposalType });
  }
  return scenario.prompt ?? scenario.title;
}

export function evaluateKeywordExpectations(content: string, scenario: UseCaseScenario): {
  ok: boolean;
  missing: string[];
  forbidden: string[];
} {
  const lower = content.toLowerCase();
  const forbidden = (scenario.mustNotContain ?? []).filter((phrase) => content.includes(phrase));

  if (scenario.expectKeywordGroups?.length) {
    const missingGroups = scenario.expectKeywordGroups
      .filter((group) => !group.some((keyword) => lower.includes(keyword.toLowerCase())))
      .map((group) => group.join("|"));
    return {
      ok: missingGroups.length === 0 && forbidden.length === 0,
      missing: missingGroups,
      forbidden
    };
  }

  const missing = (scenario.expectKeywords ?? []).filter(
    (keyword) => !lower.includes(keyword.toLowerCase())
  );
  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}
