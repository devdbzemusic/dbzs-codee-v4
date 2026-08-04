import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeChatPatchPanel } from "./RuntimeChatPatchPanel";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";

describe("RuntimeChatPatchPanel integration", () => {
  const applyPatch = vi.fn(async () => undefined);
  const rejectPatch = vi.fn(async () => undefined);
  const rollbackPatch = vi.fn(async () => undefined);
  const validatePatch = vi.fn(async () => undefined);

  beforeEach(() => {
    applyPatch.mockClear();
    rejectPatch.mockClear();
    rollbackPatch.mockClear();
    validatePatch.mockClear();
    useRuntimeChatStore.setState({
      activePatchProposal: {
        id: "proposal-1",
        runId: "run-1",
        title: "Fix add function",
        summary: "Replace subtraction with addition.",
        changes: [
          {
            id: "change-1",
            filePath: "src/math.ts",
            changeType: "modify",
            proposedContent: "export const add = () => 2;",
            reason: "Patch anwenden",
            summary: "a-b -> a+b",
            riskLevel: "low",
            requiresReview: true
          }
        ]
      },
      activePatchPreview: {
        proposalId: "proposal-1",
        state: "WAITING_FOR_APPROVAL",
        approvalVersion: "v1",
        createdAt: new Date().toISOString(),
        previews: [
          {
            changeId: "change-1",
            filePath: "src/math.ts",
            changeType: "modify",
            snapshotId: "snapshot-1",
            beforeContent: "return a - b",
            afterContent: "return a + b",
            diff: "- return a - b\n+ return a + b"
          }
        ]
      },
      patchState: "APPROVED",
      patchError: null,
      patchApplyResult: { applied: true, errors: [], restorePointId: "restore-1" },
      patchValidationResult: {
        success: true,
        commands: [{ commandId: "pnpm vitest", exitCode: 0 }]
      },
      applyPatch,
      rejectPatch,
      rollbackPatch,
      validatePatch
    } as never);
  });

  it("renders the real patch review surface and wires review actions", () => {
    render(<RuntimeChatPatchPanel />);

    expect(screen.getByText("Patch Review")).toBeInTheDocument();
    expect(screen.getByText("Fix add function")).toBeInTheDocument();
    expect(screen.getByText(/Validierung erfolgreich/i)).toBeInTheDocument();
    expect(screen.getByText(/pnpm vitest: exit 0/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ablehnen" }));
    fireEvent.click(screen.getByRole("button", { name: "Tests starten" }));
    fireEvent.click(screen.getByRole("button", { name: "Zurücksetzen" }));

    expect(applyPatch).toHaveBeenCalledTimes(1);
    expect(rejectPatch).toHaveBeenCalledTimes(1);
    expect(validatePatch).toHaveBeenCalledTimes(1);
    expect(rollbackPatch).toHaveBeenCalledTimes(1);
  });
});
