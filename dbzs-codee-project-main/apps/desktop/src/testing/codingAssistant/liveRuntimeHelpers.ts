import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveFixtureWorkspaceRoot } from "./fixtureWorkspace";

export function readFixture(relativePath: string): string {
  const root = resolveFixtureWorkspaceRoot();
  const filePath = path.join(root, relativePath.replace(/\//g, path.sep));
  return readFileSync(filePath, "utf8");
}

const SCENARIO_HINTS: Record<string, string> = {
  "explain-bug": [
    "Aufgabe: Erklaere NUR den Bug in der Funktion subtract().",
    "Der bekannte Bug: subtract nutzt faelschlich `return a + b` statt `return a - b`.",
    "Nenne subtract, die fehlerhafte Zeile und den Fix. Erfinde keine anderen Funktionen."
  ].join("\n"),
  "run-tests": [
    "Aufgabe: Nenne den konkreten Testbefehl fuer dieses Projekt.",
    "package.json scripts.test ist `vitest run` — nenne npm test oder pnpm test.",
    "Erwaehne src/calculator.test.ts und dass der subtract-Test wegen des Bugs fehlschlaegt."
  ].join("\n"),
  "explain-divide-edge": [
    "Aufgabe: Erklaere das Verhalten von divide() bei b === 0.",
    "divide wirft Error('Division by zero') — das ist korrektes Verhalten.",
    "Optional: erwaehne den separaten subtract-Bug nur wenn relevant."
  ].join("\n")
};

export function buildLiveSystemPrompt(scenarioId?: string): string {
  const calculator = readFixture("src/calculator.ts");
  const packageJson = readFixture("package.json");
  const calculatorTest = readFixture("src/calculator.test.ts");

  const sections = [
    "Du bist der DBZS Coding Assistant in einem fest definierten Test-Workspace.",
    "Antworte knapp auf Deutsch. Nutze NUR Fakten aus den unten gezeigten Dateien.",
    "Erlaubte Funktionen in src/calculator.ts: add, subtract, divide — KEINE anderen (kein calculate, multiply o.a.).",
    "",
    "=== src/calculator.ts ===",
    calculator,
    "",
    "=== package.json ===",
    packageJson,
    "",
    "=== src/calculator.test.ts ===",
    calculatorTest
  ];

  if (scenarioId && SCENARIO_HINTS[scenarioId]) {
    sections.push("", "=== Szenario-Hinweis ===", SCENARIO_HINTS[scenarioId]);
  }

  return sections.join("\n");
}
