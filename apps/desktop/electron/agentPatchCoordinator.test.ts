import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { AgentPatchCoordinator, createAgentPatchProposal } from "./agentPatchCoordinator";
import { FileChangeService } from "./fileChangeService";
import { PatchPipelineService } from "./patchPipelineService";
import { RestorePointService } from "./restorePointService";

const execFileAsync = promisify(execFile);

const tempRoots: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dbzs-agent-patch-"));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "codee@example.test"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "CODEE Test"], { cwd: root });
  return root;
}

function createCoordinator(): AgentPatchCoordinator {
  const restorePointService = new RestorePointService({ maxPointsPerWorkspace: 20 });
  const fileChangeService = new FileChangeService({ restorePointService });
  const patchPipelineService = new PatchPipelineService({ fileChangeService, restorePointService });
  return new AgentPatchCoordinator({
    patchPipelineService,
    restorePointService
  });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("AgentPatchCoordinator file apply acceptance", () => {
  it("applies a real approved patch and rolls it back", async () => {
    const workspaceRoot = await createWorkspace();
    const mathPath = path.join(workspaceRoot, "src", "math.ts");
    const before = "export function add(a: number, b: number): number {\n  return a - b;\n}\n";
    const after = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
    await fs.writeFile(mathPath, before, "utf-8");
    await execFileAsync("git", ["add", "src/math.ts"], { cwd: workspaceRoot });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspaceRoot });

    const coordinator = createCoordinator();
    const proposal = createAgentPatchProposal({
      id: "proposal-add-fix",
      runId: "run-file-apply",
      title: "Fix add function",
      summary: "Replace subtraction with addition.",
      changes: [
        {
          id: "change-math",
          decisionId: "decision-test",
          filePath: "src/math.ts",
          changeType: "modify",
          proposedContent: after,
          reason: "add must return the sum.",
          summary: "a - b -> a + b",
          riskLevel: "low",
          requiresReview: true
        }
      ],
      validationCommands: ["test"]
    });

    const preview = await coordinator.createPreview(workspaceRoot, proposal);
    expect(preview.state).toBe("PREVIEW_READY");
    expect(preview.previews[0]?.diff).toContain("-  return a - b;");
    expect(preview.previews[0]?.diff).toContain("+  return a + b;");

    coordinator.approveProposal(proposal.id, preview.approvalVersion);
    const applyResult = await coordinator.applyApprovedProposal(workspaceRoot, proposal.id);

    expect(applyResult.errors).toEqual([]);
    expect(applyResult.applied).toBe(true);
    expect(applyResult.restorePointId).toBeTruthy();
    await expect(fs.readFile(mathPath, "utf-8")).resolves.toBe(after);

    const diff = await execFileAsync("git", ["diff", "--", "src/math.ts"], { cwd: workspaceRoot });
    expect(diff.stdout).toContain("-  return a - b;");
    expect(diff.stdout).toContain("+  return a + b;");

    const rollback = await coordinator.rollback(workspaceRoot, applyResult.restorePointId!);
    expect(rollback.state).toBe("ROLLED_BACK");
    await expect(fs.readFile(mathPath, "utf-8")).resolves.toBe(before);
  });

  it("creates and deletes files with restore points", async () => {
    const workspaceRoot = await createWorkspace();
    const coordinator = createCoordinator();
    const createProposal = createAgentPatchProposal({
      id: "proposal-create",
      runId: "run-create",
      title: "Create note",
      summary: "Create a text file.",
      changes: [
        {
          id: "change-create",
          filePath: "src/note.txt",
          changeType: "create",
          proposedContent: "hello\n",
          reason: "new test file",
          summary: "create note",
          riskLevel: "low",
          requiresReview: true
        }
      ]
    });

    const preview = await coordinator.createPreview(workspaceRoot, createProposal);
    coordinator.approveProposal(createProposal.id, preview.approvalVersion);
    const created = await coordinator.applyApprovedProposal(workspaceRoot, createProposal.id);
    expect(created.errors).toEqual([]);
    expect(created.applied).toBe(true);
    await expect(fs.readFile(path.join(workspaceRoot, "src", "note.txt"), "utf-8")).resolves.toBe("hello\n");

    const deleteProposal = createAgentPatchProposal({
      id: "proposal-delete",
      runId: "run-delete",
      title: "Delete note",
      summary: "Delete a text file.",
      changes: [
        {
          id: "change-delete",
          filePath: "src/note.txt",
          changeType: "delete",
          reason: "cleanup",
          summary: "delete note",
          riskLevel: "low",
          requiresReview: true
        }
      ]
    });

    const deletePreview = await coordinator.createPreview(workspaceRoot, deleteProposal);
    coordinator.approveProposal(deleteProposal.id, deletePreview.approvalVersion);
    const deleted = await coordinator.applyApprovedProposal(workspaceRoot, deleteProposal.id);
    expect(deleted.deletedFiles).toEqual(["src/note.txt"]);
    await expect(fs.access(path.join(workspaceRoot, "src", "note.txt"))).rejects.toThrow();
  });

  it("blocks paths outside the workspace", async () => {
    const workspaceRoot = await createWorkspace();
    const coordinator = createCoordinator();
    const proposal = createAgentPatchProposal({
      id: "proposal-outside",
      runId: "run-outside",
      title: "Bad path",
      summary: "Attempt path escape.",
      changes: [
        {
          id: "change-outside",
          filePath: "../outside.ts",
          changeType: "modify",
          proposedContent: "x",
          reason: "bad",
          summary: "bad",
          riskLevel: "high",
          requiresReview: true
        }
      ]
    });

    await expect(coordinator.createPreview(workspaceRoot, proposal)).rejects.toThrow("workspace-relativ");
  });

  it("blocks workspace-protected paths from patch preview", async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, ".codee"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, ".codee", "protected-paths.json"),
      JSON.stringify({
        protectedPaths: [{ path: "src/locked.ts", reason: "manuell gesperrt" }]
      }),
      "utf-8"
    );
    await fs.writeFile(path.join(workspaceRoot, "src", "locked.ts"), "export const locked = false;\n", "utf-8");
    const coordinator = createCoordinator();
    const proposal = createAgentPatchProposal({
      id: "proposal-locked",
      runId: "run-locked",
      title: "Change locked file",
      summary: "Attempt to change a protected file.",
      changes: [
        {
          id: "change-locked",
          filePath: "src/locked.ts",
          changeType: "modify",
          proposedContent: "export const locked = true;\n",
          reason: "test",
          summary: "locked=true",
          riskLevel: "medium",
          requiresReview: true
        }
      ]
    });

    await expect(coordinator.createPreview(workspaceRoot, proposal)).rejects.toThrow("[PATCH_WORKSPACE_PATH_LOCKED]");
  });

  it("rejects stale approvals after proposal preview version changes", async () => {
    const workspaceRoot = await createWorkspace();
    await fs.writeFile(path.join(workspaceRoot, "src", "math.ts"), "export const x = 1;\n", "utf-8");
    const coordinator = createCoordinator();
    const proposal = createAgentPatchProposal({
      id: "proposal-stale",
      runId: "run-stale",
      title: "Change x",
      summary: "Change x.",
      changes: [
        {
          id: "change-x",
          filePath: "src/math.ts",
          changeType: "modify",
          proposedContent: "export const x = 2;\n",
          reason: "test",
          summary: "x=2",
          riskLevel: "low",
          requiresReview: true
        }
      ],
      createdAt: "2026-07-01T00:00:00.000Z"
    });

    const first = await coordinator.createPreview(workspaceRoot, proposal);
    const second = await coordinator.createPreview(workspaceRoot, { ...proposal, createdAt: "2026-07-01T00:00:01.000Z" });

    expect(second.approvalVersion).not.toBe(first.approvalVersion);
    expect(() => coordinator.approveProposal(proposal.id, first.approvalVersion)).toThrow("Freigabe passt nicht");
  });
});
