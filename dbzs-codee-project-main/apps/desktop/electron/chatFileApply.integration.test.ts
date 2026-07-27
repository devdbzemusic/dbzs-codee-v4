import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileChangeService } from "./fileChangeService";
import { PatchPipelineService } from "./patchPipelineService";
import { RestorePointService } from "./restorePointService";
import { AgentPatchCoordinator } from "./agentPatchCoordinator";
import { normalizeProposeFileChangesToolOutput } from "../src/services/runtimeChatPatchProposal";

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dbzs-chat-file-apply-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "math.ts"),
    "export function add(a: number, b: number): number {\n  return a - b;\n}\n",
    "utf-8"
  );
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.local"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "DBZS Test"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: root, stdio: "ignore" });
  return root;
}

function createCoordinator(): AgentPatchCoordinator {
  const restorePointService = new RestorePointService();
  const fileChangeService = new FileChangeService({ restorePointService });
  const patchPipelineService = new PatchPipelineService({ fileChangeService, restorePointService });
  return new AgentPatchCoordinator({ patchPipelineService, restorePointService });
}

describe("runtime chat real file apply integration", () => {
  it("normalizes propose_file_changes and applies a real approved patch with rollback", async () => {
    const workspaceRoot = await createWorkspace();
    const coordinator = createCoordinator();
    const fixed = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";

    const proposal = normalizeProposeFileChangesToolOutput({
      runId: "run-chat-apply",
      decisionId: "decision-chat-apply",
      workspaceRoot,
      output: {
        title: "Fix add implementation",
        summary: "Replace subtraction with addition.",
        changes: [
          {
            file_path: "src/math.ts",
            change_type: "modify",
            proposed_content: fixed,
            reason: "add currently subtracts.",
            risk_level: "low"
          }
        ],
        validation_commands: ["typecheck", "free shell string"]
      }
    });

    expect(proposal.validationCommands).toEqual(["pnpm_typecheck"]);

    const preview = await coordinator.createPreview(workspaceRoot, proposal);
    expect(preview.state).toBe("PREVIEW_READY");
    expect(preview.previews[0]?.diff).toContain("return a + b");

    const approved = coordinator.approveProposal(proposal.id, preview.approvalVersion);
    expect(approved.state).toBe("APPROVED");

    const applied = await coordinator.applyApprovedProposal(workspaceRoot, proposal.id);
    expect(applied.applied).toBe(true);
    await expect(fs.readFile(path.join(workspaceRoot, "src", "math.ts"), "utf-8")).resolves.toBe(fixed);

    const diff = execFileSync("git", ["diff", "--", "src/math.ts"], { cwd: workspaceRoot }).toString("utf-8");
    expect(diff).toContain("-  return a - b;");
    expect(diff).toContain("+  return a + b;");

    expect(applied.restorePointId).toBeTruthy();
    const rollback = await coordinator.rollback(workspaceRoot, applied.restorePointId!);
    expect(rollback.state).toBe("ROLLED_BACK");
    await expect(fs.readFile(path.join(workspaceRoot, "src", "math.ts"), "utf-8")).resolves.toContain("return a - b");
  });

  it("rejects invalid tool output before preview", () => {
    expect(() =>
      normalizeProposeFileChangesToolOutput({
        runId: "run-invalid",
        workspaceRoot: "C:/workspace",
        output: {
          title: "Invalid",
          summary: "Outside path",
          changes: [
            {
              file_path: "../outside.ts",
              change_type: "modify",
              proposed_content: "x",
              reason: "escape",
              risk_level: "high"
            }
          ]
        }
      })
    ).toThrow(/PATCH_PATH_INVALID/);
  });
});
