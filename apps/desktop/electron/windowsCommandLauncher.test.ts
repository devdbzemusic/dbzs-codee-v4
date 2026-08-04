import { describe, expect, it } from "vitest";
import {
  buildWindowsCommandInvocation,
  quoteWindowsCmdArgument,
  requiresWindowsCmdLauncher,
  resolveWindowsCommandLauncher
} from "./windowsCommandLauncher.js";

describe("windowsCommandLauncher", () => {
  it("resolves ComSpec when it points at absolute cmd.exe", () => {
    const launcher = resolveWindowsCommandLauncher({
      ComSpec: "C:\\Windows\\System32\\cmd.exe"
    });
    expect(launcher.toLowerCase()).toContain("cmd.exe");
  });

  it("falls back to System32 cmd.exe for invalid ComSpec", () => {
    const launcher = resolveWindowsCommandLauncher({
      ComSpec: "powershell.exe"
    });
    expect(launcher).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("quotes arguments with spaces", () => {
    expect(quoteWindowsCmdArgument("hello world")).toBe('"hello world"');
    expect(quoteWindowsCmdArgument("simple")).toBe("simple");
  });

  it("rejects shell metacharacters in arguments", () => {
    expect(() => quoteWindowsCmdArgument("a&b")).toThrow(/metacharacters/i);
  });

  it("builds ComSpec /d /s /c invocation for npm", () => {
    const invocation = buildWindowsCommandInvocation("npm", ["test"], {
      ComSpec: "C:\\Windows\\System32\\cmd.exe"
    });
    expect(invocation.file.toLowerCase()).toContain("cmd.exe");
    expect(invocation.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(invocation.args[3]).toBe("npm test");
  });

  it("flags package managers as needing cmd launcher on win32", () => {
    expect(requiresWindowsCmdLauncher("win32", "npm")).toBe(true);
    expect(requiresWindowsCmdLauncher("win32", "pnpm")).toBe(true);
    expect(requiresWindowsCmdLauncher("win32", "git")).toBe(false);
    expect(requiresWindowsCmdLauncher("linux", "npm")).toBe(false);
  });
});
