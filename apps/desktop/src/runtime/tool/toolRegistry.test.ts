import { describe, expect, it } from "vitest";
import { createDefaultToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import { getBuiltinMetadata, metadataToToolDefinition } from "@/runtime/tool/toolMetadata";
import { ToolRegistry } from "@/runtime/tool/toolRegistry";

function registerBuiltin(registry: ToolRegistry, name: Parameters<typeof getBuiltinMetadata>[0]): void {
  const metadata = getBuiltinMetadata(name);
  if (!metadata) {
    throw new Error(`Missing metadata for ${name}`);
  }
  registry.register(metadataToToolDefinition(metadata));
}

describe("ToolRegistry", () => {
  it("bumps generation on register and provider unregister", () => {
    const registry = new ToolRegistry();
    const initial = registry.getGeneration();
    registerBuiltin(registry, "read_file");
    expect(registry.getGeneration()).toBe(initial + 1);

    const unregister = registry.registerProvider({
      list: () => [metadataToToolDefinition(getBuiltinMetadata("grep")!)]
    });
    expect(registry.getGeneration()).toBe(initial + 2);

    unregister();
    expect(registry.getGeneration()).toBe(initial + 3);
  });

  it("filters listAvailable by toolset and checkAvailability", () => {
    const registry = new ToolRegistry();
    registerBuiltin(registry, "read_file");
    registerBuiltin(registry, "get_git_diff");
    registerBuiltin(registry, "run_tests");

    const withoutGit = createDefaultToolAvailabilityContext("D:/repo", {
      hasGitRepo: false,
      hasTestCommands: true
    });
    const withGit = createDefaultToolAvailabilityContext("D:/repo", {
      hasGitRepo: true,
      hasTestCommands: false
    });

    const readOnly = registry.listAvailable(withoutGit, { toolsets: ["filesystem.read", "git"] });
    expect(readOnly.map((entry) => entry.name)).toEqual(["read_file"]);

    const gitTools = registry.listAvailable(withGit, { toolsets: ["git", "tests"] });
    expect(gitTools.map((entry) => entry.name)).toEqual(["get_git_diff"]);

    expect(registry.isAvailable("get_git_diff", withoutGit)).toBe(false);
    expect(registry.isAvailable("get_git_diff", withGit)).toBe(true);
  });
});
