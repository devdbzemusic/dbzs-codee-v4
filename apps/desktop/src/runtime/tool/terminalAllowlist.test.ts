import { beforeEach, describe, expect, it } from "vitest";
import {
  isTerminalAllowlisted,
  listTerminalAllowlist,
  normalizeTerminalCommand,
  rememberTerminalAllowlist,
  revokeTerminalAllowlist
} from "@/runtime/tool/terminalAllowlist";
import { ensureLocalStorage } from "@/test/ensureLocalStorage";

const STORAGE_KEY = "dbzs-terminal-allowlist-v1";

describe("terminalAllowlist", () => {
  beforeEach(() => {
    ensureLocalStorage();
    localStorage.clear();
  });

  it("normalizes commands for comparison", () => {
    expect(normalizeTerminalCommand("  Pnpm   Test  ")).toBe("pnpm test");
  });

  it("matches exact and prefix patterns per workspace", () => {
    rememberTerminalAllowlist("D:/repo-a", "pnpm test", "prefix");
    rememberTerminalAllowlist("D:/repo-b", "npm run lint", "exact");

    expect(isTerminalAllowlisted("D:/repo-a", "pnpm test --filter desktop")).toBe(true);
    expect(isTerminalAllowlisted("D:/repo-a", "pnpm install")).toBe(false);
    expect(isTerminalAllowlisted("D:/repo-b", "npm run lint")).toBe(true);
    expect(isTerminalAllowlisted("D:/repo-b", "npm run lint --fix")).toBe(false);
    expect(isTerminalAllowlisted("D:/repo-b", "pnpm test")).toBe(false);
  });

  it("isolates workspaces and supports revoke", () => {
    rememberTerminalAllowlist("D:/repo-a", "cargo build", "prefix");
    expect(listTerminalAllowlist("D:/repo-a")).toHaveLength(1);
    expect(listTerminalAllowlist("D:/repo-b")).toHaveLength(0);

    revokeTerminalAllowlist("D:/repo-a", "cargo build");
    expect(isTerminalAllowlisted("D:/repo-a", "cargo build")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });
});
