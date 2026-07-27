import { describe, expect, it } from "vitest";
import { parseDebugAnalyses } from "./debugAnalysisParser";

describe("parseDebugAnalyses", () => {
  it("parst TypeScript-Fehler mit Datei und Zeile", () => {
    const analyses = parseDebugAnalyses(
      [
        "src/App.tsx(12,3): error TS2304: Cannot find name 'DebugPanel'.",
        "src/App.tsx(12,3): error TS2304: Cannot find name 'DebugPanel'."
      ].join("\n")
    );

    expect(analyses).toHaveLength(1);
    expect(analyses[0]?.source).toBe("typecheck");
    expect(analyses[0]?.affectedFiles).toContain("src/App.tsx");
    expect(analyses[0]?.summary).toContain("TS2304");
  });

  it("parst Test-Fehler aus Vitest-Ausgabe", () => {
    const analyses = parseDebugAnalyses(
      [
        "FAIL  src/services/debugAnalysisParser.test.ts > parseDebugAnalyses > example",
        "AssertionError: expected 1 to be 2",
        "at src/services/debugAnalysisParser.test.ts:18:5"
      ].join("\n")
    );

    expect(analyses).toHaveLength(1);
    expect(analyses[0]?.source).toBe("test");
    expect(analyses[0]?.summary).toContain("debugAnalysisParser.test.ts");
  });

  it("parst Runtime-Fehler mit Stacktrace", () => {
    const analyses = parseDebugAnalyses(
      [
        "TypeError: Cannot read properties of undefined (reading 'name')",
        "    at renderPanel (src/components/DebugAgentPanel.tsx:44:12)",
        "    at processTicksAndRejections (node:internal/process/task_queues:95:5)"
      ].join("\n")
    );

    expect(analyses).toHaveLength(1);
    expect(analyses[0]?.source).toBe("runtime");
    expect(analyses[0]?.affectedFiles).toContain("src/components/DebugAgentPanel.tsx");
  });

  it("parst Lint-Fehler", () => {
    const analyses = parseDebugAnalyses("src/components/DebugAgentPanel.tsx:8:1  error  'x' is defined but never used  no-unused-vars");

    expect(analyses).toHaveLength(1);
    expect(analyses[0]?.source).toBe("lint");
    expect(analyses[0]?.summary).toContain("Lint-Fehler");
  });

  it("gibt fuer unlesbare Logs keine Analysen zurueck", () => {
    expect(parseDebugAnalyses("nur allgemeines log ohne fehler")).toEqual([]);
  });
});