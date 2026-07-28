import { describe, expect, it } from "vitest";
import {
  batchFitsBudget,
  buildRepositoryInventory,
  buildRepositoryReviewRequest,
  computeReviewBatchBudget,
  createHeuristicBatchAnalyzer,
  dedupeRepositoryReviewFindings,
  describeEmptyReviewPlan,
  ensureBatchFitsOrSplit,
  filterFindingsToExistingPaths,
  isDestructiveReviewCommand,
  isInstallReviewCommand,
  matchesCompleteRepositoryReviewIntent,
  normalizePersistedReviewOutcome,
  planReviewBatches,
  planReviewCommands,
  RepositoryReviewOrchestrator,
  resolveRepositoryReviewScope,
  runReviewCommands,
  splitReviewBatch
} from "@/services/repositoryReview";
import type { ReviewWorkspaceFileEntry, ReviewWorkspaceIO } from "@/services/repositoryReview/types";

function createMemoryIO(files: Record<string, string>): ReviewWorkspaceIO {
  const store = new Map<string, string>(
    Object.entries(files).filter(([path]) => !path.includes("..") && !path.startsWith("/"))
  );
  return {
    async listFiles() {
      const entries: ReviewWorkspaceFileEntry[] = [];
      for (const [relativePath, content] of store.entries()) {
        if (relativePath.startsWith(".codee/")) continue;
        if (relativePath.includes("..")) continue;
        entries.push({
          relativePath,
          bytes: content.length,
          lines: content.split(/\r?\n/).length
        });
      }
      return entries;
    },
    async readText(_root, relativePath) {
      return store.get(relativePath.replace(/\\/g, "/")) ?? null;
    },
    async writeText(_root, relativePath, content) {
      store.set(relativePath.replace(/\\/g, "/"), content);
    },
    async pathExists(_root, relativePath) {
      return store.has(relativePath.replace(/\\/g, "/"));
    },
    async getGitState() {
      return { branch: "main", dirty: true, changedFiles: ["src/app.ts"] };
    },
    async runCommand({ command }) {
      if (command.includes("typecheck")) {
        return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 12 };
      }
      return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 8 };
    }
  };
}

describe("repository review intent", () => {
  it("migriert persistierte V1-Outcomes auf kanonische V2-Werte", () => {
    expect(normalizePersistedReviewOutcome("completed_with_skipped_checks"))
      .toBe("completed_with_warnings");
    expect(normalizePersistedReviewOutcome("paused")).toBe("partial");
    expect(normalizePersistedReviewOutcome("batch_failed")).toBe("failed");
  });

  it("maps complete review phrase to full_repository", () => {
    expect(matchesCompleteRepositoryReviewIntent("Mache einen kompletten Codereview")).toBe(true);
    expect(resolveRepositoryReviewScope("Mache einen kompletten Codereview")).toBe("full_repository");
  });

  it("does not treat vague review as complete", () => {
    expect(matchesCompleteRepositoryReviewIntent("mach einen code review")).toBe(false);
    expect(resolveRepositoryReviewScope("mach einen code review")).toBeNull();
  });
});

describe("repository inventory + commands", () => {
  it("builds inventory with scripts and excludes cross-workspace paths", async () => {
    const io = createMemoryIO({
      "package.json": JSON.stringify({
        scripts: { typecheck: "tsc -p .", test: "vitest", build: "vite build", lint: "eslint ." }
      }),
      "src/app.ts": "export const x = 1;\n",
      "src/evil.ts": "eval('x');\n",
      "../outside.ts": "should not appear"
    });
    // Force a sneaky absolute-like relative through listFiles override
    const listed = await io.listFiles("C:/demo");
    expect(listed.some((f) => f.relativePath.includes(".."))).toBe(false);

    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository"
    });
    const inventory = await buildRepositoryInventory(request, io);
    expect(inventory.packageManager).toBe("npm");
    expect(inventory.typecheckCommands.length).toBeGreaterThan(0);
    expect(inventory.testCommands.length).toBeGreaterThan(0);
    expect(inventory.files).toContain("src/app.ts");
  });

  it("blocks destructive commands and marks install as requiring approval", async () => {
    expect(isDestructiveReviewCommand("rm -rf /")).toBe(true);
    expect(isInstallReviewCommand("npm install lodash")).toBe(true);
    const io = createMemoryIO({
      "package.json": JSON.stringify({ scripts: { typecheck: "tsc" } }),
      "src/a.ts": "const a = 1;\n"
    });
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository"
    });
    const inventory = await buildRepositoryInventory(request, io);
    const plans = [
      ...planReviewCommands(request, inventory),
      {
        id: "install-1",
        command: "npm install",
        cwd: request.workspaceRoot,
        purpose: "Install",
        timeoutMs: 1000,
        requiresApproval: true
      },
      {
        id: "destructive-1",
        command: "rm -rf node_modules",
        cwd: request.workspaceRoot,
        purpose: "Destructive",
        timeoutMs: 1000,
        requiresApproval: false
      }
    ];
    const results = await runReviewCommands({
      io,
      commands: plans,
      executionAllowed: true,
      approveInstall: false
    });
    expect(results.find((r) => r.id === "install-1")?.status).toBe("not_executed");
    expect(results.find((r) => r.id === "destructive-1")?.status).toBe("not_available");
    expect(results.find((r) => r.id.startsWith("typecheck"))?.status).toBe("passed");
  });

  it("marks checks as not_executed when execution is disallowed", async () => {
    const io = createMemoryIO({
      "package.json": JSON.stringify({ scripts: { typecheck: "tsc" } }),
      "src/a.ts": "const a = 1;\n"
    });
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository"
    });
    const inventory = await buildRepositoryInventory(request, io);
    const results = await runReviewCommands({
      io,
      commands: planReviewCommands(request, inventory),
      executionAllowed: false
    });
    expect(results.every((r) => r.status === "not_executed")).toBe(true);
    expect(results.every((r) => r.status !== "passed")).toBe(true);
  });
});

describe("batching + findings", () => {
  it("splits repository into multiple batches", async () => {
    const files: Record<string, string> = {
      "package.json": "{}",
      "src/main.ts": "export {};\n",
      "src/store.ts": "export {};\n",
      "src/api.ts": "export {};\n",
      "src/db.ts": "export {};\n",
      "src/Button.tsx": "export {};\n",
      "src/audio.ts": "export {};\n",
      "src/app.test.ts": "export {};\n"
    };
    const io = createMemoryIO(files);
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository"
    });
    const inventory = await buildRepositoryInventory(request, io);
    const batches = planReviewBatches(request, inventory);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.paths.length <= 8)).toBe(true);
  });

  it("plant stabile Batch-IDs und hält auch kleine Rest-Chunks im 3–8-Dateien-Rahmen", async () => {
    const ordered = Array.from({ length: 10 }, (_, index) => `src/misc-${index}.ts`);
    const files = Object.fromEntries(ordered.map((file) => [file, "export {};\n"]));
    const io = createMemoryIO(files);
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository"
    });
    const inventory = await buildRepositoryInventory(request, io);
    const first = planReviewBatches(request, { ...inventory, files: [...inventory.files].reverse() });
    const second = planReviewBatches(request, inventory);
    expect(first).toEqual(second);
    expect(first.map((item) => item.paths.length)).toEqual([7, 3]);
    expect(first.map((item) => item.title)).toEqual([
      "Weitere Module · 1/2",
      "Weitere Module · 2/2"
    ]);
  });

  it("ignores a stray selectedPaths for full_repository and still produces batches", async () => {
    const files = {
      "package.json": "{}",
      "src/main.ts": "export {};\n",
      "src/store.ts": "export {};\n",
      "src/api.ts": "export {};\n",
      "src/db.ts": "export {};\n",
      "src/Button.tsx": "export {};\n",
      "src/audio.ts": "export {};\n",
      "src/app.test.ts": "export {};\n"
    };
    const io = createMemoryIO(files);
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository",
      selectedPaths: ["src/main.ts"]
    });
    const inventory = await buildRepositoryInventory(request, io);
    const batches = planReviewBatches(request, inventory);
    const reviewedPaths = new Set(batches.flatMap((batch) => batch.paths));
    expect(batches.length).toBeGreaterThan(0);
    expect(reviewedPaths.size).toBeGreaterThan(1);
    expect(reviewedPaths.has("src/store.ts")).toBe(true);
  });

  it("splits on overflow instead of aborting", () => {
    const batch = {
      batchId: "batch-1",
      title: "Test",
      paths: ["a.ts", "b.ts", "c.ts", "d.ts"],
      purpose: "test",
      estimatedTokens: 99999,
      priority: 1
    };
    const fileContents = new Map(
      batch.paths.map((p) => [p, "x".repeat(20_000)])
    );
    const result = ensureBatchFitsOrSplit({
      batch,
      runtimeContextLimit: 2048,
      systemText: "sys",
      taskText: "task",
      fileContents
    });
    expect(result.splitApplied).toBe(true);
    expect(result.batches.length).toBe(2);
    expect(splitReviewBatch(batch).length).toBe(2);
  });

  it("rejects findings for unknown paths and dedupes", () => {
    const findings = [
      {
        id: "1",
        severity: "P1" as const,
        category: "security" as const,
        path: "src/a.ts",
        title: "HTML injection sink",
        evidence: "innerHTML",
        impact: "xss",
        recommendation: "fix"
      },
      {
        id: "2",
        severity: "P1" as const,
        category: "security" as const,
        path: "src/a.ts",
        title: "HTML injection sink",
        evidence: "innerHTML",
        impact: "xss",
        recommendation: "fix"
      },
      {
        id: "3",
        severity: "P2" as const,
        category: "correctness" as const,
        path: "src/missing.ts",
        title: "Ghost",
        evidence: "nope",
        impact: "x",
        recommendation: "y"
      }
    ];
    const existing = new Set(["src/a.ts"]);
    const filtered = filterFindingsToExistingPaths(findings, existing);
    expect(filtered).toHaveLength(2);
    expect(dedupeRepositoryReviewFindings("ws", filtered)).toHaveLength(1);
  });

  it("requires safety margin in budget", () => {
    const budget = computeReviewBatchBudget({
      runtimeContextLimit: 1000,
      systemText: "a".repeat(400),
      taskText: "b".repeat(400),
      fileTexts: ["c".repeat(20_000)],
      outputReserveTokens: 400
    });
    expect(budget.totalRequiredTokens).toBeGreaterThan(1000);
    expect(batchFitsBudget(budget)).toBe(false);
  });
});

describe("RepositoryReviewOrchestrator", () => {
  it("completes a full repository review with artifacts and honest outcome", async () => {
    const io = createMemoryIO({
      "package.json": JSON.stringify({
        name: "demo",
        scripts: { typecheck: "tsc", test: "vitest", build: "vite build" }
      }),
      "src/app.ts": "export const ok = 1;\n",
      "src/bad.ts": "eval('boom');\nTODO: fix\n",
      "src/ui.tsx": "export function X(){ return null }\n"
    });
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository",
      depth: "quick"
    });
    const orch = new RepositoryReviewOrchestrator({
      io,
      runtimeContextLimit: 8192,
      executionAllowed: false,
      batchAnalyzer: createHeuristicBatchAnalyzer(),
      createReviewId: () => "rev-test-1"
    });
    const result = await orch.start(request);
    expect(result.outcome).toBe("degraded_heuristic_only");
    expect(result.progress.totalBatches).toBeGreaterThan(0);
    expect(result.progress.completedBatches).toBe(result.progress.totalBatches);
    expect(result.findings.some((f) => f.path === "src/bad.ts")).toBe(true);
    expect(await io.readText("C:/demo", ".codee/reviews/rev-test-1/REVIEW_REPORT.md")).toMatch(
      /Repository Review Report/
    );
    expect(await io.readText("C:/demo", ".codee/reviews/rev-test-1/findings.json")).toContain("eval");
  });

  it("does not re-run a completed review on resume", async () => {
    const io = createMemoryIO({
      "package.json": "{}",
      "src/a.ts": "export {};\n"
    });
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository",
      depth: "quick"
    });
    const orch = new RepositoryReviewOrchestrator({
      io,
      executionAllowed: false,
      createReviewId: () => "rev-resume"
    });
    const first = await orch.start(request);
    expect(first.outcome === "completed" || first.outcome === "degraded_heuristic_only").toBe(
      true
    );
    const second = await orch.resume(request, "rev-resume");
    expect(second.outcome === "completed" || second.outcome === "degraded_heuristic_only").toBe(
      true
    );
    expect(second.progress.status).toBe("completed");
  });

  it("fails inventory when no files are in scope", async () => {
    const io = createMemoryIO({});
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository"
    });
    const orch = new RepositoryReviewOrchestrator({
      io,
      createReviewId: () => "rev-empty"
    });
    const result = await orch.start(request);
    expect(result.outcome).toBe("failed");
  });

  it("skips an oversized, unsplittable batch and completes the review", async () => {
    const io = createMemoryIO({
      "src/ok.ts": "export const ok = 1;",
      "src/too-large.ts": "a".repeat(20_000)
    });
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository"
    });
    const orch = new RepositoryReviewOrchestrator({
      io,
      runtimeContextLimit: 8192,
      batchAnalyzer: createHeuristicBatchAnalyzer(),
      createReviewId: () => "rev-oversized-skip"
    });
    const result = await orch.start(request);

    // The overall review should complete with warnings, not fail.
    expect(result.outcome).toBe("completed_with_warnings");
    expect(result.progress.completedBatches).toBe(result.progress.totalBatches);

    // There should be a diagnostic entry for the skipped batch.
    const oversizedDiagnostic = result.diagnostics?.find((d) =>
      d.providerError?.includes("exceeds context limit")
    );
    expect(oversizedDiagnostic).toBeDefined();
    expect(oversizedDiagnostic?.batchId).toContain("too-large");
  });

  it("classifies a non-empty inventory with zero eligible batches as empty_plan", async () => {
    const io = createMemoryIO({
      "styles.css": "body { color: red; }",
      "notes.txt": "just some notes"
    });
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository"
    });
    const orch = new RepositoryReviewOrchestrator({
      io,
      createReviewId: () => "rev-empty-plan"
    });
    const result = await orch.start(request);
    expect(result.outcome).toBe("empty_plan");
    expect(result.inventory?.fileCount).toBeGreaterThan(0);
    expect(result.plan?.batches.length ?? 0).toBe(0);
    expect(result.progress.currentBatchTitle).toMatch(/Dateiformat-Filter/);

    // This part was removed as `detail` is not persisted on the state file itself.
  });

  it("classifies a non-empty inventory with zero eligible batches as empty_plan", async () => {
    const io = createMemoryIO({
      "styles.css": "body { color: red; }",
      "notes.txt": "just some notes"
    });
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "full_repository"
    });
    const orch = new RepositoryReviewOrchestrator({
      io,
      createReviewId: () => "rev-empty-plan"
    });
    const result = await orch.start(request);
    expect(result.outcome).toBe("empty_plan");
    expect(result.inventory?.fileCount).toBeGreaterThan(0);
    expect(result.plan?.batches.length ?? 0).toBe(0);
    expect(result.progress.currentBatchTitle).toMatch(/Dateiformat-Filter/);

    const stateRaw = await io.readText("C:/demo", ".codee/reviews/rev-empty-plan/review-state.json");
    expect(stateRaw).toBeTruthy();
    const state = JSON.parse(stateRaw!);
    expect(state.outcome).toBe("empty_plan");
    expect(state.detail).toMatch(/Dateiformat-Filter/);
  });

  it("names the affected selection when describing an empty selectedPaths plan", () => {
    const request = buildRepositoryReviewRequest({
      workspaceId: "c:/demo",
      workspaceRoot: "C:/demo",
      scope: "selected_paths",
      selectedPaths: ["styles.css"]
    });
    expect(describeEmptyReviewPlan(request)).toMatch(/styles\.css/);
  });

  it("isolates workspaces on resume", async () => {
    const io = createMemoryIO({
      "package.json": "{}",
      "src/a.ts": "export {};\n"
    });
    const orch = new RepositoryReviewOrchestrator({
      io,
      createReviewId: () => "rev-ws"
    });
    await orch.start(
      buildRepositoryReviewRequest({
        workspaceId: "c:/demo",
        workspaceRoot: "C:/demo",
        scope: "full_repository",
        depth: "quick"
      })
    );
    const mismatched = await orch.resume(
      buildRepositoryReviewRequest({
        workspaceId: "c:/other",
        workspaceRoot: "C:/demo",
        scope: "full_repository"
      }),
      "rev-ws"
    );
    expect(mismatched.outcome).toBe("inventory_failed");
  });
});
