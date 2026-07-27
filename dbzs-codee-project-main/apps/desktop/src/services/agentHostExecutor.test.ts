import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostAction } from "@dbzs/shared";
import { agentHostExecutor } from "@/services/agentHostExecutor";

const serviceMocks = vi.hoisted(() => ({
  getNextHostAction: vi.fn(),
  claimHostAction: vi.fn(),
  completeHostAction: vi.fn(),
  failHostAction: vi.fn()
}));

vi.mock("@/services/agentWorkbenchService", () => ({
  agentWorkbenchService: serviceMocks
}));

function buildAction(overrides: Partial<HostAction> = {}): HostAction {
  return {
    id: "action-1",
    runId: "run-1",
    stepId: null,
    actionType: "apply_patch",
    status: "pending",
    payload: {
      file_path: "C:/demo/src/example.ts",
      proposed_content: "export const ok = true;\n"
    },
    result: null,
    createdAt: "2026-06-20T12:00:00Z",
    claimedAt: null,
    completedAt: null,
    errorMessage: null,
    ...overrides
  };
}

describe("agentHostExecutor", () => {
  beforeEach(() => {
    agentHostExecutor.stop(false);
    serviceMocks.getNextHostAction.mockReset();
    serviceMocks.claimHostAction.mockReset();
    serviceMocks.completeHostAction.mockReset();
    serviceMocks.failHostAction.mockReset();

    globalThis.window = globalThis.window || ({} as Window & typeof globalThis);
    window.dbzs = {
      ...(window.dbzs ?? {}),
      applyPatchWithRestorePoint: vi.fn().mockResolvedValue({
        snapshotId: "snap-1",
        file: { path: "C:/demo/src/example.ts", name: "example.ts", content: "export const ok = true;\n", language: "typescript" },
        diff: "+export const ok = true;",
        restorePointId: "rp-1"
      })
    } as Window["dbzs"];
  });

  it("dispatches apply_patch via safe patch bridge", async () => {
    agentHostExecutor.setWorkspaceRoot("C:/demo");
    const action = buildAction();
    const result = await agentHostExecutor.runOnce(action);

    expect(window.dbzs.applyPatchWithRestorePoint).toHaveBeenCalledWith(
      "C:/demo/src/example.ts",
      "export const ok = true;",
      "before_patch"
    );
    expect(result).toMatchObject({
      file_path: "C:/demo/src/example.ts",
      restore_point_id: "rp-1"
    });
  });

  it("executes run_command through executeSafeCommand", async () => {
    window.dbzs.executeSafeCommand = vi.fn().mockResolvedValue({
      runId: "cmd-1",
      commandId: "test",
      label: "Run tests",
      status: "completed",
      exitCode: 0,
      startedAt: "2026-06-20T12:00:00Z",
      finishedAt: "2026-06-20T12:00:05Z",
      timedOut: false,
      cancelled: false
    });

    const result = await agentHostExecutor.runOnce(
      buildAction({
        actionType: "run_command",
        payload: {
          workspace_root: "C:/demo",
          command_id: "test"
        }
      })
    );

    expect(window.dbzs.executeSafeCommand).toHaveBeenCalledWith("C:/demo", "test");
    expect(result).toMatchObject({ run_id: "cmd-1", exit_code: 0 });
  });
});
