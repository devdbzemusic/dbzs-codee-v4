import { describe, expect, it } from "vitest";
import { evaluateTerminalCommandPolicy } from "@/runtime/tool/execPolicy";

describe("execPolicy", () => {
  it("forbids destructive rm -rf", () => {
    const result = evaluateTerminalCommandPolicy("rm -rf /tmp/project");
    expect(result.decision).toBe("forbidden");
  });

  it("allows benign commands", () => {
    const result = evaluateTerminalCommandPolicy("pnpm test");
    expect(result.decision).toBe("allow");
  });

  it("forbids global npm installs", () => {
    const result = evaluateTerminalCommandPolicy("npm install -g electron");
    expect(result.decision).toBe("forbidden");
    expect(result.ruleId).toBe("forbid-global-npm-install");
  });

  it("prompts for local dependency installs", () => {
    const result = evaluateTerminalCommandPolicy("npm install --save-dev electron");
    expect(result.decision).toBe("prompt");
    expect(result.ruleId).toBe("prompt-local-dependency-install");
  });

  it("prompts for recursive delete on Windows", () => {
    const result = evaluateTerminalCommandPolicy("Remove-Item -Recurse node_modules");
    expect(result.decision).toBe("prompt");
  });
});
