import { readFileSync } from "node:fs";
import path from "node:path";

const FIXTURE_CALCULATOR_PATH = "src/calculator.ts";
const FIXTURE_GREET_PATH = "src/greet.ts";

function fixedSubtractContent(): string {
  return `export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
}
`;
}

function multiplyCalculatorContent(): string {
  return `${fixedSubtractContent().trim()}

export function multiply(a: number, b: number): number {
  return a * b;
}
`;
}

function refactorGreetContent(): string {
  return `const DEFAULT_GREETING = "Hello, stranger!";

export function greet(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return DEFAULT_GREETING;
  }
  return \`Hello, \${trimmed}!\`;
}
`;
}

function multiplyTestFileContent(): string {
  return `import { describe, expect, it } from "vitest";
import { add, divide, multiply, subtract } from "./calculator";

describe("calculator", () => {
  it("adds numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("subtracts numbers", () => {
    expect(subtract(5, 3)).toBe(2);
  });

  it("multiplies numbers", () => {
    expect(multiply(4, 3)).toBe(12);
  });

  it("divides numbers", () => {
    expect(divide(10, 2)).toBe(5);
  });
});
`;
}

function buildMultiFilePatchJson(): string {
  return JSON.stringify({
    changes: [
      {
        filePath: FIXTURE_CALCULATOR_PATH,
        proposedContent: multiplyCalculatorContent(),
        reason: "Fix subtract and add multiply"
      },
      {
        filePath: "src/calculator.test.ts",
        proposedContent: multiplyTestFileContent(),
        reason: "Add multiply test coverage"
      }
    ]
  });
}

function buildPatchJson(relativePath: string, proposedContent: string, reason?: string): string {
  return JSON.stringify({
    changes: [{ filePath: relativePath, proposedContent, reason: reason ?? "Test patch" }]
  });
}

export interface E2EScenarioShape {
  id: string;
  mockResponse?: string;
  mockResponseType?: string;
  takeoverProposal?: string;
  takeoverProposalType?: string;
}

export function resolveMockResponse(scenario: E2EScenarioShape): string {
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
        "Ich liste die Dateien.",
        "```tool-call",
        JSON.stringify({ tool: "list_files", input: { path: "src" } }),
        "```"
      ].join("\n");
    case "tool-read-file":
      return [
        "Ich lese die Datei.",
        "```tool-call",
        JSON.stringify({ tool: "read_file", input: { path: FIXTURE_CALCULATOR_PATH } }),
        "```"
      ].join("\n");
    case "tool-read-greet":
      return [
        "Ich lese greet.ts.",
        "```tool-call",
        JSON.stringify({ tool: "read_file", input: { path: FIXTURE_GREET_PATH } }),
        "```"
      ].join("\n");
    case "patch-multi-file-fix-test":
      return buildMultiFilePatchJson();
    case "patch-add-multiply-test":
      return buildPatchJson("src/calculator.test.ts", multiplyTestFileContent(), "Add multiply tests");
    default:
      return `Mock-Antwort fuer ${scenario.id}`;
  }
}

export const SKILL_TITLES: Record<string, string> = {
  architect: "Architektur und Meilensteine",
  "code-review": "Risiken, Regressionen, fehlende Tests",
  implement: "Implementierung und Patches",
  debug: "Fehleranalyse und Root Cause",
  docs: "Dokumentation und README",
  workspace: "Workspace-Struktur analysieren"
};

export function resolveSkillTitle(skillId?: string): string | undefined {
  return skillId ? SKILL_TITLES[skillId] : undefined;
}

export function resolveTakeoverProposal(scenario: E2EScenarioShape): string {
  if (scenario.takeoverProposal) {
    return scenario.takeoverProposal;
  }
  if (scenario.takeoverProposalType) {
    return resolveMockResponse({ ...scenario, mockResponseType: scenario.takeoverProposalType });
  }
  return scenario.id;
}

export function loadScenarioCatalog(): { scenarios: Array<E2EScenarioShape & Record<string, unknown>> } {
  const catalogPath = path.resolve(process.cwd(), "../../fixtures/coding-assistant-workspace/scenarios.json");
  return JSON.parse(readFileSync(catalogPath, "utf8"));
}
