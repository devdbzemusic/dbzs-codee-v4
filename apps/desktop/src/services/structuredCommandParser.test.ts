import { describe, expect, it } from "vitest";
import { parseStructuredCommandLine } from "./structuredCommandParser";

describe("parseStructuredCommandLine", () => {
  it("preserves quoted paths and native Windows backslashes", () => {
    expect(parseStructuredCommandLine('pytest "tests\\safe file.py::test_case" -q', "C:\\repo")).toMatchObject({
      command: "pytest", args: ["tests\\safe file.py::test_case", "-q"]
    });
  });

  it.each(["pytest a.py | more", "pytest $(whoami)", "pytest `whoami`", 'pytest "open'])
  ("blocks shell syntax: %s", (command) => {
    expect(() => parseStructuredCommandLine(command, "C:\\repo")).toThrow("[COMMAND_BLOCKED]");
  });
});
