import { describe, expect, it } from "vitest";
import { RuntimeEventBus } from "@/runtime/core/runtimeEventBus";
import { AgentLoop } from "@/runtime/agent/agentLoop";
import type { AgentPolicy, AgentRunRequest, PlannerResult } from "@/runtime/agent/agentContracts";
import type { ToolRequest, ToolResult } from "@/runtime/tool/toolContracts";

const request: AgentRunRequest = {
  runId: "run-1",
  actorId: "actor",
  goal: "Update docs",
  mode: "edit",
  role: "coder",
  workspaceRoot: "D:/repo",
  executionContext: {
    primaryFilePath: "docs/RUNTIME_ARCHITECTURE_CODEE.md",
    relatedFilePaths: ["docs/RUNTIME_ARCHITECTURE_CODEE.md", "apps/desktop/src/runtime/runtimeKernel.ts"],
    searchQuery: "runtime architecture",
    gitDiffFilePath: "apps/desktop/src/runtime/runtimeKernel.ts",
    testCommandId: "pnpm_typecheck",
    scratchNotePath: ".codee/runtime-agent-proposal.md",
    contextSummary: "active_file:1, git_diff:1",
    primaryFileExcerpt: "# Codee Runtime Architecture"
  }
};

const plan: PlannerResult = {
  summary: "single step",
  steps: [
    {
      id: "s1",
      title: "step",
      objective: "update readme",
      expectedTools: ["read_file", "apply_patch"]
    }
  ]
};

const policy: AgentPolicy = {
  maxRuntimeMs: 1000,
  maxSteps: 2,
  maxToolCalls: 3,
  maxRetriesPerStep: 0,
  requiresApprovalForPatch: true
};

function resultFor(requestInput: ToolRequest): ToolResult {
  if (requestInput.name === "apply_patch") {
    return {
      requestId: requestInput.requestId,
      toolName: requestInput.name,
      status: "ok",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      output: { patchId: "patch-1" }
    };
  }

  return {
    requestId: requestInput.requestId,
    toolName: requestInput.name,
    status: "ok",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    output: "ok"
  };
}

describe("AgentLoop", () => {
  it("uses execution context to build scoped tool inputs", async () => {
    const seenRequests: ToolRequest[] = [];
    const loop = new AgentLoop(
      new RuntimeEventBus(),
      {
        runTool: async (toolRequest) => {
          seenRequests.push(toolRequest);
          return resultFor(toolRequest);
        }
      },
      policy,
      async () => true
    );

    await loop.run(request, plan, new AbortController().signal);

    expect(seenRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "read_file",
          input: expect.objectContaining({ path: "docs/RUNTIME_ARCHITECTURE_CODEE.md" })
        }),
        expect.objectContaining({
          name: "apply_patch",
          input: expect.objectContaining({
            path: ".codee/runtime-agent-proposal.md",
            targetPath: "docs/RUNTIME_ARCHITECTURE_CODEE.md",
            summary: "update readme",
            previewOnly: true
          })
        })
      ])
    );

    const patchRequest = seenRequests.find((entry) => entry.name === "apply_patch");
    expect(patchRequest).toBeDefined();
    expect((patchRequest?.input as { proposedContent: string }).proposedContent).toContain("# Runtime Change Proposal");
    expect((patchRequest?.input as { proposedContent: string }).proposedContent).toContain("Target File: docs/RUNTIME_ARCHITECTURE_CODEE.md");
  });

  it("cancels when patch approval is rejected", async () => {
    const loop = new AgentLoop(
      new RuntimeEventBus(),
      {
        runTool: async (toolRequest) => resultFor(toolRequest)
      },
      policy,
      async () => false
    );

    const result = await loop.run(request, plan, new AbortController().signal);
    expect(result.status).toBe("cancelled");
  });

  it("completes when patch approval is granted", async () => {
    const loop = new AgentLoop(
      new RuntimeEventBus(),
      {
        runTool: async (toolRequest) => resultFor(toolRequest)
      },
      policy,
      async () => true
    );

    const result = await loop.run(request, plan, new AbortController().signal);
    expect(result.status).toBe("completed");
    expect(result.appliedPatchPreviewIds).toContain("patch-1");
  });

  it("uses configured test command during verification", async () => {
    const seenRequests: ToolRequest[] = [];
    const verificationPlan: PlannerResult = {
      summary: "verify",
      steps: [
        {
          id: "verify-1",
          title: "verify",
          objective: "validate runtime",
          expectedTools: ["run_tests", "get_git_diff"]
        }
      ]
    };

    const loop = new AgentLoop(
      new RuntimeEventBus(),
      {
        runTool: async (toolRequest) => {
          seenRequests.push(toolRequest);
          return resultFor(toolRequest);
        }
      },
      policy,
      async () => true
    );

    await loop.run(request, verificationPlan, new AbortController().signal);

    expect(seenRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "run_tests",
          input: expect.objectContaining({ commandId: "pnpm_typecheck" })
        }),
        expect.objectContaining({
          name: "get_git_diff",
          input: expect.objectContaining({ filePath: "apps/desktop/src/runtime/runtimeKernel.ts" })
        })
      ])
    );
  });
});
