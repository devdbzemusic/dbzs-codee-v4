import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureLocalStorage } from "@/test/ensureLocalStorage";
import { useRuntimeChatApprovalStore } from "./runtimeChatApprovalStore";

const enqueueJobMock = vi.fn();

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    enqueueJob: (...args: unknown[]) => enqueueJobMock(...args)
  }
}));

describe("useRuntimeChatApprovalStore", () => {
  beforeEach(() => {
    ensureLocalStorage();
    localStorage.clear();
    enqueueJobMock.mockReset();
    useRuntimeChatApprovalStore.setState({ takeovers: [], toolApprovals: [] });
  });

  it("queues a pending approval instead of executing immediately", () => {
    const id = useRuntimeChatApprovalStore.getState().requestTakeoverApproval({
      proposal: "Milestone 1: API bauen",
      workspaceRoot: "D:/repo",
      workspaceContext: null,
      activeFile: null
    });

    const pending = useRuntimeChatApprovalStore.getState().takeovers;
    expect(id).toBeTruthy();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.kind).toBe("implementation");
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("executes takeover only after approval", async () => {
    enqueueJobMock.mockResolvedValue({
      id: "job_1",
      title: "Uebernehmen: Patch",
      status: "queued"
    });
    const queueProposedChanges = vi.fn();

    const id = useRuntimeChatApprovalStore.getState().requestTakeoverApproval({
      proposal: "Milestone 1: API bauen",
      workspaceRoot: "D:/repo",
      workspaceContext: null,
      activeFile: null
    });

    const message = await useRuntimeChatApprovalStore
      .getState()
      .approveTakeover(id, queueProposedChanges, "d:/repo");

    expect(enqueueJobMock).toHaveBeenCalledOnce();
    expect(message).toContain("Job eingereiht");
    expect(useRuntimeChatApprovalStore.getState().takeovers[0]?.status).toBe("approved");
  });

  it("marks takeover as rejected without enqueueing", () => {
    const id = useRuntimeChatApprovalStore.getState().requestTakeoverApproval({
      proposal: "Milestone 1",
      workspaceRoot: "D:/repo",
      workspaceContext: null,
      activeFile: null
    });

    useRuntimeChatApprovalStore.getState().rejectTakeover(id, "d:/repo");

    expect(enqueueJobMock).not.toHaveBeenCalled();
    expect(useRuntimeChatApprovalStore.getState().takeovers[0]?.status).toBe("rejected");
  });

  it("resolves tool approval promises on approve/reject", async () => {
    const pending = useRuntimeChatApprovalStore
      .getState()
      .requestToolApproval(
        "runtime-chat",
        "write_file",
        "Policy requires explicit approval",
        undefined,
        "D:/repo"
      );

    useRuntimeChatApprovalStore.getState().approveToolApproval(
      useRuntimeChatApprovalStore.getState().toolApprovals[0]?.id ?? "",
      { workspaceId: "d:/repo" }
    );

    await expect(pending).resolves.toBe(true);
  });

  it("persists terminal allowlist when approving with rememberAllowlist", async () => {
    const pending = useRuntimeChatApprovalStore
      .getState()
      .requestToolApproval(
        "runtime-chat",
        "run_terminal_command",
        "Policy requires explicit approval",
        { command: "pnpm test" },
        "D:/repo"
      );

    const approvalId = useRuntimeChatApprovalStore.getState().toolApprovals[0]?.id ?? "";
    useRuntimeChatApprovalStore.getState().approveToolApproval(approvalId, {
      rememberAllowlist: true,
      workspaceId: "d:/repo"
    });

    await expect(pending).resolves.toBe(true);
    const raw = localStorage.getItem("dbzs-terminal-allowlist-v1");
    expect(raw).toContain("pnpm test");
  });

  it("rejects old pending approvals and removes old cards on workspace switch", async () => {
    useRuntimeChatApprovalStore.getState().requestTakeoverApproval({
      proposal: "Aenderung in A",
      workspaceRoot: "D:/workspace-a",
      workspaceContext: null,
      activeFile: null
    });
    const pendingTool = useRuntimeChatApprovalStore.getState().requestToolApproval(
      "runtime-chat",
      "write_file",
      "Policy requires explicit approval",
      undefined,
      "D:/workspace-a"
    );

    useRuntimeChatApprovalStore.getState().switchWorkspace("D:/workspace-b");

    await expect(pendingTool).resolves.toBe(false);
    expect(useRuntimeChatApprovalStore.getState().takeovers).toEqual([]);
    expect(useRuntimeChatApprovalStore.getState().toolApprovals).toEqual([]);
  });

  it("blocks a takeover approval with the wrong workspace", async () => {
    const id = useRuntimeChatApprovalStore.getState().requestTakeoverApproval({
      proposal: "Aenderung in A",
      workspaceRoot: "D:/workspace-a",
      workspaceContext: null,
      activeFile: null
    });

    await expect(
      useRuntimeChatApprovalStore.getState().approveTakeover(id, vi.fn(), "d:/workspace-b")
    ).rejects.toThrow("anderen Workspace");
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});
