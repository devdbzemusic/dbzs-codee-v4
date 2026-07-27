import type { UseCaseScenario } from "./useCaseCatalog";
import { readFixture } from "./liveRuntimeHelpers";

export interface LiveChatFileContext {
  path: string;
  language: string;
  content: string;
}

export function resolveLiveFileContext(scenarioId: string): LiveChatFileContext {
  switch (scenarioId) {
    case "run-tests":
      return {
        path: "src/calculator.test.ts",
        language: "typescript",
        content: [
          readFixture("src/calculator.test.ts"),
          "",
          "=== package.json scripts ===",
          readFixture("package.json")
        ].join("\n")
      };
    default:
      return {
        path: "src/calculator.ts",
        language: "typescript",
        content: readFixture("src/calculator.ts")
      };
  }
}

export function buildLiveUserPrompt(scenario: UseCaseScenario): string {
  if (scenario.prompt) {
    return scenario.prompt;
  }
  return scenario.title;
}
