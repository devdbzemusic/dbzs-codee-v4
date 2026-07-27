import { describe, expect, it } from "vitest";
import {
  buildInstallDependencyArgs,
  buildPackageManagerCommandSuggestions,
  detectWorkspacePackageContract
} from "@dbzs/shared";

describe("workspacePackageContract", () => {
  it("prefers packageManager field", () => {
    const contract = detectWorkspacePackageContract({
      packageJson: { packageManager: "pnpm@9.0.0", scripts: { test: "vitest" } },
      lockfileNames: ["package-lock.json", "bun.lock"]
    });
    expect(contract.packageManager).toBe("pnpm");
    expect(contract.source).toBe("package_json");
  });

  it("detects npm from package-lock only", () => {
    const contract = detectWorkspacePackageContract({
      packageJson: { scripts: { test: "node test.js", build: "vite build" } },
      lockfileNames: ["package-lock.json"]
    });
    expect(contract.packageManager).toBe("npm");
    const suggestions = buildPackageManagerCommandSuggestions(contract);
    expect(suggestions.some((s) => s.id === "npm_test")).toBe(true);
    expect(suggestions.some((s) => s.id.startsWith("pnpm_"))).toBe(false);
    expect(suggestions.some((s) => s.id === "npm_run_build")).toBe(true);
    expect(suggestions.some((s) => s.id.includes("typecheck"))).toBe(false);
  });

  it("marks package-lock + bun.lock as ambiguous", () => {
    const contract = detectWorkspacePackageContract({
      packageJson: { scripts: { test: "vitest" } },
      lockfileNames: ["package-lock.json", "bun.lock"]
    });
    expect(contract.packageManager).toBe("ambiguous");
    const suggestions = buildPackageManagerCommandSuggestions(contract);
    expect(suggestions.every((s) => !s.command.startsWith("pnpm") && s.command !== "pnpm")).toBe(true);
    expect(suggestions.filter((s) => s.command === "npm" || s.command === "bun")).toHaveLength(0);
  });

  it("builds electron as local dev dependency for npm", () => {
    const built = buildInstallDependencyArgs({
      packageManager: "npm",
      packages: [{ name: "electron" }],
      dependencyType: "development"
    });
    expect(built).toEqual({
      command: "npm",
      args: ["install", "--save-dev", "electron"]
    });
  });
});
