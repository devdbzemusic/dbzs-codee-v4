import type {
  AgentAction,
  AgentPatchApplyResult,
  AgentPatchPreview,
  AgentPatchProposal,
  AgentPatchState,
  AgentPlanProposal,
  PatchValidationResult,
  RuntimeChatMessage
} from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import { createElectronReviewWorkspaceIO, loadFindings, loadRemediationState, saveRemediationReport, saveRemediationState } from "@/services/repositoryReview";
import { readActiveTaskContract, upsertActiveTaskContract } from "@/services/activeTaskContract";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  appendSystemPatchMessage,
  createMessageId,
  refreshWorkspaceAfterPatch,
  runPatchValidation,
  syncRuntimeAgentActions
} from "@/stores/runtimeChatStoreRuntimeHelpers";

export interface RuntimeChatPatchStateSlice {
  messages: RuntimeChatMessage[];
  planProposalsById: Record<string, AgentPlanProposal>;
  patchProposalsById: Record<string, AgentPatchProposal>;
  patchPreviewsById: Record<string, AgentPatchPreview>;
  agentActionsById: Record<string, AgentAction>;
  activePatchProposal: AgentPatchProposal | null;
  activePatchPreview: AgentPatchPreview | null;
  patchState: AgentPatchState | null;
  patchError: string | null;
  patchApplyResult: AgentPatchApplyResult | null;
  patchValidationResult: PatchValidationResult | null;
}

type PatchStoreSetter = (
  partial:
    | Partial<RuntimeChatPatchStateSlice>
    | ((state: RuntimeChatPatchStateSlice) => Partial<RuntimeChatPatchStateSlice> | RuntimeChatPatchStateSlice)
) => void;

type PatchStoreGetter = () => RuntimeChatPatchStateSlice;

function actionId(): string {
  return `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`;
}

export async function receivePatchProposalAction(
  set: PatchStoreSetter,
  get: PatchStoreGetter,
  proposal: AgentPatchProposal
): Promise<void> {
  const actionWorkspaceRoot = proposal.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath;
  if (!actionWorkspaceRoot) {
    set({ patchError: "Patch-Freigabe ohne aktiven Workspace wurde verworfen.", patchState: "FAILED" });
    return;
  }
  const actionWorkspaceId = workspaceScopeId(actionWorkspaceRoot);
  set({
    activePatchProposal: proposal,
    activePatchPreview: null,
    patchState: "PROPOSED",
    patchError: null,
    patchApplyResult: null,
    patchValidationResult: null
  });

  set((state) => ({
    patchProposalsById: {
      ...state.patchProposalsById,
      [proposal.id]: proposal
    }
  }));

  const preview = await previewPatchAction(set, get, proposal);
  if (!preview) {
    return;
  }

  const messages = get().messages;
  const lastMsg = messages[messages.length - 1];
  const targetMessageId = lastMsg && lastMsg.role === "assistant" ? lastMsg.id : `msg-${Date.now().toString(36)}-patch`;

  const showDiffAction = {
    id: actionId(),
    runId: proposal.runId,
    messageId: targetMessageId,
    workspaceRoot: actionWorkspaceRoot,
    workspaceId: actionWorkspaceId,
    kind: "show_diff" as const,
    title: "Diff anzeigen",
    riskLevel: "low" as const,
    payload: { proposalId: proposal.id },
    state: "pending" as const,
    createdAt: new Date().toISOString()
  };
  const approveAction = {
    id: actionId(),
    runId: proposal.runId,
    messageId: targetMessageId,
    workspaceRoot: actionWorkspaceRoot,
    workspaceId: actionWorkspaceId,
    kind: "approve_patch" as const,
    title: "Übernehmen",
    riskLevel: "medium" as const,
    payload: { proposalId: proposal.id },
    state: "pending" as const,
    createdAt: new Date().toISOString()
  };
  const rejectAction = {
    id: actionId(),
    runId: proposal.runId,
    messageId: targetMessageId,
    workspaceRoot: actionWorkspaceRoot,
    workspaceId: actionWorkspaceId,
    kind: "reject_patch" as const,
    title: "Ablehnen",
    riskLevel: "low" as const,
    payload: { proposalId: proposal.id },
    state: "pending" as const,
    createdAt: new Date().toISOString()
  };

  set((state) => {
    const updatedMessages = state.messages.map((m) => {
      if (m.id === targetMessageId) {
        return {
          ...m,
          patchProposalId: proposal.id,
          patchPreviewId: preview.proposalId,
          actions: [showDiffAction, approveAction, rejectAction]
        };
      }
      return m;
    });

    if (!updatedMessages.some((m) => m.id === targetMessageId)) {
      updatedMessages.push({
        id: targetMessageId,
        role: "assistant",
        content: "CODEE hat Dateiänderungen vorbereitet.",
        patchProposalId: proposal.id,
        patchPreviewId: preview.proposalId,
        actions: [showDiffAction, approveAction, rejectAction]
      });
    }

    const syncedRuntimeActions = syncRuntimeAgentActions(updatedMessages, state.planProposalsById);

    return {
      patchProposalsById: {
        ...state.patchProposalsById,
        [proposal.id]: proposal
      },
      patchPreviewsById: {
        ...state.patchPreviewsById,
        [preview.proposalId]: preview
      },
      messages: syncedRuntimeActions.messages,
      agentActionsById: syncedRuntimeActions.agentActionsById,
      activePatchProposal: proposal,
      activePatchPreview: preview,
      patchState: "WAITING_FOR_APPROVAL"
    };
  });
}

export async function previewPatchAction(
  set: PatchStoreSetter,
  get: PatchStoreGetter,
  proposal = get().activePatchProposal
): Promise<AgentPatchPreview | null> {
  const workspaceRoot = proposal?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath;
  const previewAgentPatch = window.dbzs.previewAgentPatch;
  if (!proposal || !previewAgentPatch) {
    set({ patchError: "Patch Preview ist nicht verfuegbar.", patchState: "FAILED" });
    return null;
  }
  try {
    const preview = await previewAgentPatch({
      ...proposal,
      workspaceRoot: proposal.workspaceRoot ?? workspaceRoot ?? undefined
    });
    set({
      activePatchProposal: proposal,
      activePatchPreview: { ...preview, state: "WAITING_FOR_APPROVAL" },
      patchState: "WAITING_FOR_APPROVAL",
      patchError: null
    });
    return preview;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Patch Preview fehlgeschlagen.";
    set({ patchError: message, patchState: "FAILED" });
    appendSystemPatchMessage(set, `Patch Preview fehlgeschlagen:\n${message}`);
    return null;
  }
}

export async function approvePatchAction(set: PatchStoreSetter, get: PatchStoreGetter): Promise<void> {
  const preview = get().activePatchPreview;
  const approveAgentPatch = window.dbzs.approveAgentPatch;
  if (!preview || !approveAgentPatch) {
    throw new Error("Keine Patch Preview zur Freigabe vorhanden.");
  }
  const approved = await approveAgentPatch(preview.proposalId, preview.approvalVersion);
  set({ activePatchPreview: approved, patchState: "APPROVED", patchError: null });
}

export async function rejectPatchAction(set: PatchStoreSetter, get: PatchStoreGetter): Promise<void> {
  const proposal = get().activePatchProposal;
  const rejectAgentPatch = window.dbzs.rejectAgentPatch;
  if (!proposal || !rejectAgentPatch) {
    return;
  }
  const rejected = await rejectAgentPatch(proposal.id);
  set({ activePatchPreview: rejected, patchState: "REJECTED", patchError: null });
  appendSystemPatchMessage(set, "Patch-Vorschlag wurde verworfen. Es wurden keine Dateien geaendert.");
}

export async function applyPatchAction(set: PatchStoreSetter, get: PatchStoreGetter): Promise<void> {
  const proposal = get().activePatchProposal;
  const workspaceRoot = proposal?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath;
  const applyAgentPatch = window.dbzs.applyAgentPatch;
  if (!proposal || !workspaceRoot || !applyAgentPatch) {
    set({ patchError: "Patch Apply ist nicht verfuegbar.", patchState: "FAILED" });
    return;
  }
  if (get().patchState === "APPLYING" || get().patchState === "APPLIED" || get().patchState === "PASSED") {
    return;
  }

  try {
    if (get().patchState !== "APPROVED") {
      throw new Error("patch_not_explicitly_approved");
    }
    set({ patchState: "APPLYING", patchError: null });
    const result = await applyAgentPatch(proposal.id);
    const touchedFiles = [...result.changedFiles, ...result.deletedFiles];
    set({ patchApplyResult: result, patchState: result.state, patchError: result.errors[0] ?? null });
    await refreshWorkspaceAfterPatch(workspaceRoot, touchedFiles);

    let validation: PatchValidationResult | null = null;
    if (result.applied) {
      validation = await validatePatchAction(set, get);
    }

    const remediationContract = readActiveTaskContract(workspaceRoot);
    const remediationCapsule = remediationContract?.reviewRemediation;
    if (remediationCapsule) {
      const io = createElectronReviewWorkspaceIO();
      const [persisted, originalFindings] = await Promise.all([
        loadRemediationState(io, workspaceRoot, remediationCapsule.reviewId),
        loadFindings(io, workspaceRoot, remediationCapsule.reviewId)
      ]);
      if (persisted && originalFindings) {
        const normalizedTouched = touchedFiles.map((file) => file.replace(/\\/g, "/").toLowerCase());
        const selected = new Set(remediationCapsule.selectedFindingIds);
        const affectedIds = new Set(
          originalFindings
            .filter((finding) =>
              selected.has(finding.id) &&
              normalizedTouched.some((file) =>
                file === finding.path.toLowerCase() ||
                file.endsWith(`/${finding.path.toLowerCase()}`)
              )
            )
            .map((finding) => finding.id)
        );
        const verificationCommands = validation?.commands.map((command) => command.commandId) ?? [];
        const resolutions = persisted.resolutions.map((resolution) =>
          affectedIds.has(resolution.findingId)
            ? {
                ...resolution,
                status: validation?.success ? "verified" as const : result.applied ? "fixed" as const : "failed" as const,
                changedFiles: touchedFiles,
                verificationCommands,
                verificationResult: validation
                  ? validation.success ? "passed" : "failed"
                  : "not_run"
              }
            : resolution
        );
        const verifiedCount = resolutions.filter((resolution) => resolution.status === "verified").length;
        const allDone =
          resolutions.length > 0 &&
          resolutions.every((resolution) => resolution.status === "verified" || resolution.status === "skipped");
        const now = new Date().toISOString();
        await saveRemediationState(io, workspaceRoot, {
          ...persisted,
          status: allDone ? "completed" : result.applied ? "in_progress" : "failed",
          resolutions,
          updatedAt: now
        });
        await saveRemediationReport(
          io,
          workspaceRoot,
          remediationCapsule.reviewId,
          [
            `# Remediation Report · ${remediationCapsule.reviewId}`,
            "",
            `Status: ${allDone ? "completed" : result.applied ? "in_progress" : "failed"}`,
            `Verifiziert: ${verifiedCount}/${resolutions.length}`,
            "",
            "## Findings",
            ...resolutions.map((resolution) =>
              `- ${resolution.findingId}: ${resolution.status}` +
              (resolution.changedFiles.length ? ` · ${resolution.changedFiles.join(", ")}` : "")
            ),
            "",
            "Das originale `findings.json` bleibt unverändert."
          ].join("\n")
        );
        if (verifiedCount > 0 && remediationContract) {
          upsertActiveTaskContract(workspaceRoot, {
            originalRequest: remediationContract.originalRequest,
            confirmedGoal: remediationContract.confirmedGoal,
            acceptanceCriteria: remediationContract.acceptanceCriteria,
            taskType: remediationContract.taskType,
            assignedAgent: "reviewer",
            currentPhase: "review"
          });
        }
      }
    }

    const messageId = createMessageId("patch");
    const rollbackAction = {
      id: actionId(),
      runId: proposal.runId,
      messageId,
      workspaceRoot,
      workspaceId: workspaceScopeId(workspaceRoot),
      kind: "rollback_patch" as const,
      title: "Rollback",
      riskLevel: "medium" as const,
      payload: { proposalId: proposal.id, restorePointId: result.restorePointId },
      state: "pending" as const,
      createdAt: new Date().toISOString()
    };
    const testAction = {
      id: actionId(),
      runId: proposal.runId,
      messageId,
      workspaceRoot,
      workspaceId: workspaceScopeId(workspaceRoot),
      kind: "confirm_continue" as const,
      title: "Tests starten",
      riskLevel: "low" as const,
      payload: { proposalId: proposal.id },
      state: "pending" as const,
      createdAt: new Date().toISOString()
    };
    const openFileAction = {
      id: actionId(),
      runId: proposal.runId,
      messageId,
      workspaceRoot,
      workspaceId: workspaceScopeId(workspaceRoot),
      kind: "open_file" as const,
      title: "Datei öffnen",
      riskLevel: "low" as const,
      payload: { filePath: proposal.changes[0]?.filePath, filePaths: proposal.changes.map((c) => c.filePath) },
      state: "pending" as const,
      createdAt: new Date().toISOString()
    };
    const followUpActions = result.applied ? [testAction, rollbackAction, openFileAction] : [];

    set((state) => {
      const targetMessageId = state.messages.find((m) => m.patchProposalId === proposal.id)?.id || messageId;
      const updatedMessages = state.messages.map((m) => {
        if (m.id === targetMessageId) {
          return {
            ...m,
            content: m.content + (result.applied ? "\n\n✓ Änderung angewendet" : "\n\n✗ Änderung konnte nicht angewendet werden."),
            actions: followUpActions
          };
        }
        return m;
      });

      if (!updatedMessages.some((m) => m.id === targetMessageId)) {
        updatedMessages.push({
          id: targetMessageId,
          role: "assistant",
          content: result.applied ? "✓ Änderung angewendet" : "✗ Änderung konnte nicht angewendet werden.",
          actions: followUpActions,
          patchProposalId: proposal.id
        });
      }

      const syncedRuntimeActions = syncRuntimeAgentActions(updatedMessages, state.planProposalsById);
      return {
        messages: syncedRuntimeActions.messages,
        agentActionsById: syncedRuntimeActions.agentActionsById
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Patch Apply fehlgeschlagen.";
    set({ patchError: message, patchState: "FAILED" });
    appendSystemPatchMessage(set, `Patch Apply fehlgeschlagen:\n${message}`);
  }
}

export async function rollbackPatchAction(
  set: PatchStoreSetter,
  get: PatchStoreGetter,
  restorePointId?: string
): Promise<void> {
  const targetRestorePointId = restorePointId ?? get().patchApplyResult?.restorePointId;
  const proposal = get().activePatchProposal;
  const workspaceRoot = proposal?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath;
  const rollbackAgentPatch = window.dbzs.rollbackAgentPatch;
  if (!targetRestorePointId || !workspaceRoot || !rollbackAgentPatch) {
    set({ patchError: "Rollback ist nicht verfuegbar." });
    return;
  }
  const rollback = await rollbackAgentPatch(targetRestorePointId);
  set({ patchApplyResult: rollback, patchState: rollback.state, patchError: rollback.errors[0] ?? null });
  await refreshWorkspaceAfterPatch(workspaceRoot, [...rollback.changedFiles, ...rollback.deletedFiles]);

  if (proposal) {
    const targetMessageId = get().messages.find((m) => m.patchProposalId === proposal.id)?.id;
    if (targetMessageId) {
      set((state) => {
        const updatedMessages = state.messages.map((m) =>
          m.id === targetMessageId
            ? { ...m, content: `${m.content}\n\nDie Änderung wurde vollständig zurückgerollt.`, actions: [] }
            : m
        );
        return syncRuntimeAgentActions(updatedMessages, state.planProposalsById);
      });
    }
  }
}

export async function validatePatchAction(set: PatchStoreSetter, get: PatchStoreGetter): Promise<PatchValidationResult | null> {
  const proposal = get().activePatchProposal;
  const workspaceRoot = proposal?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath;
  if (!proposal || !workspaceRoot) {
    return null;
  }
  set({ patchState: "VALIDATING" });
  const validation = await runPatchValidation(workspaceRoot, proposal);
  set({
    patchValidationResult: validation,
    patchState: validation ? (validation.success ? "PASSED" : "FAILED") : "APPLIED"
  });
  return validation;
}

export function clearPatchStateAction(set: PatchStoreSetter): void {
  set({
    activePatchProposal: null,
    activePatchPreview: null,
    patchState: null,
    patchError: null,
    patchApplyResult: null,
    patchValidationResult: null
  });
}
