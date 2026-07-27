import type { ReviewGate } from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentOutputParseError } from "@/services/agentOutputParser";
import { approvalHub } from "@/services/approvalHub";
import { reviewGateService } from "@/services/reviewGateService";
import {
  useRuntimeChatApprovalStore
} from "@/stores/runtimeChatApprovalStore";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import type { useEditorStore } from "@/stores/editorStore";
import { AssistantQuestionCard } from "@/components/AssistantQuestionCard";
import { ReviewRemediationSelectionCard } from "@/components/ReviewRemediationSelectionCard";
import {
  ReviewGateCard,
  StructuredChatActionCard,
  TakeoverCard,
  ToolApprovalCard
} from "@/components/runtime-chat/RuntimeChatApprovalCards";
import { collectPendingAssistantQuestions } from "@/components/runtime-chat/runtimeChatApprovalsHelpers";

type QueueProposedChanges = ReturnType<typeof useEditorStore.getState>["queueProposedChanges"];

interface RuntimeChatApprovalsProps {
  onStatusNote: (note: string) => void;
  queueProposedChanges: QueueProposedChanges;
  workspaceRoot: string | null;
}

const POLL_INTERVAL_MS = 15_000;

export function RuntimeChatApprovals({ onStatusNote, queueProposedChanges, workspaceRoot }: RuntimeChatApprovalsProps) {
  const workspaceId = workspaceRoot ? workspaceScopeId(workspaceRoot) : null;
  const takeovers = useRuntimeChatApprovalStore((state) => state.takeovers);
  const toolApprovals = useRuntimeChatApprovalStore((state) => state.toolApprovals);
  const messages = useRuntimeChatStore((state) => state.messages);
  const planProposalsById = useRuntimeChatStore((state) => state.planProposalsById);

  const [reviewGates, setReviewGates] = useState<ReviewGate[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const loadReviewGates = useCallback(async () => {
    try {
      if (!workspaceId) {
        setReviewGates([]);
        return;
      }
      const gates = await reviewGateService.listPending({ workspaceId });
      setReviewGates(gates.filter((gate) => gate.workspaceId === workspaceId));
    } catch {
      // Polling failures should not block chat usage.
    }
  }, [workspaceId]);

  useEffect(() => {
    setReviewGates([]);
    if (!workspaceId) return;
    void loadReviewGates();
    const interval = window.setInterval(() => void loadReviewGates(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadReviewGates, workspaceId]);

  const pendingToolApprovals = useMemo(
    () => toolApprovals.filter((entry) => entry.status === "pending" && entry.workspaceId === workspaceId),
    [toolApprovals, workspaceId]
  );
  const scopedReviewGates = useMemo(
    () => reviewGates.filter((gate) => gate.workspaceId === workspaceId && gate.scopeStatus === "scoped"),
    [reviewGates, workspaceId]
  );
  const pendingTakeovers = useMemo(
    () => takeovers.filter((entry) => entry.status === "pending" && entry.workspaceId === workspaceId),
    [takeovers, workspaceId]
  );
  const pendingStructuredActions = useMemo(
    () => approvalHub.getPendingStructuredApprovalItems(messages, {
      planProposalsById,
      workspaceId: workspaceId ?? undefined
    }),
    [messages, planProposalsById, workspaceId]
  );
  const pendingAssistantQuestions = useMemo(
    () => collectPendingAssistantQuestions(messages, workspaceId ?? undefined),
    [messages, workspaceId]
  );
  const resolvedTakeovers = useMemo(
    () => takeovers.filter((entry) => entry.status !== "pending" && entry.workspaceId === workspaceId),
    [takeovers, workspaceId]
  );
  const pendingCount = useMemo(
    () => approvalHub.getPendingCount(scopedReviewGates, messages, {
      planProposalsById,
      workspaceId: workspaceId ?? undefined
    }) + pendingAssistantQuestions.length,
    [scopedReviewGates, messages, planProposalsById, takeovers, toolApprovals, workspaceId, pendingAssistantQuestions]
  );

  if (pendingCount === 0 && resolvedTakeovers.length === 0) {
    return null;
  }

  const handleApproveTakeover = async (approvalId: string) => {
    setBusyId(approvalId);
    try {
      const message = await approvalHub.approveTakeover(approvalId, queueProposedChanges, workspaceId ?? undefined);
      onStatusNote(message);
    } catch (error) {
      if (error instanceof AgentOutputParseError) {
        onStatusNote(`Freigabe fehlgeschlagen: ${error.message}`);
      } else {
        onStatusNote(error instanceof Error ? error.message : "Freigabe fehlgeschlagen.");
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleApproveGate = async (gateId: string) => {
    setBusyId(gateId);
    try {
      if (!workspaceId) throw new Error("Kein aktiver Workspace.");
      await reviewGateService.approve(gateId, workspaceId);
      onStatusNote("Job-Review freigegeben.");
      await loadReviewGates();
    } catch (error) {
      onStatusNote(error instanceof Error ? error.message : "Review-Freigabe fehlgeschlagen.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectGate = async (gateId: string) => {
    setBusyId(gateId);
    try {
      if (!workspaceId) throw new Error("Kein aktiver Workspace.");
      await reviewGateService.reject(gateId, workspaceId);
      onStatusNote("Job-Review abgelehnt.");
      await loadReviewGates();
    } catch (error) {
      onStatusNote(error instanceof Error ? error.message : "Review-Ablehnung fehlgeschlagen.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="border-b border-dbzs-border bg-dbzs-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-medium text-dbzs-text">Rückfragen & Freigaben</h4>
          {pendingCount > 0 ? (
            <span className="rounded border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-2 py-0.5 text-[10px] text-dbzs-cyan">
              {pendingCount} offen
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {resolvedTakeovers.length > 0 ? (
            <button
              className="rounded border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-muted hover:text-dbzs-text"
              onClick={() => approvalHub.clearResolvedTakeovers()}
              type="button"
            >
              Erledigte ausblenden
            </button>
          ) : null}
          <button
            className="rounded border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-muted hover:text-dbzs-text"
            onClick={() => setCollapsed((value) => !value)}
            type="button"
          >
            {collapsed ? "Einblenden" : "Einklappen"}
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <div className="mt-3 space-y-3">
          {pendingAssistantQuestions.map((pending) =>
            pending.question.requiredField === "review_remediation_selection" &&
            pending.remediationReviews ? (
            <ReviewRemediationSelectionCard
              busy={busyId === pending.actionId}
              key={pending.actionId}
              onSubmit={(answer) => {
                setBusyId(pending.actionId);
                void useRuntimeChatStore
                  .getState()
                  .submitAssistantAnswer(pending.actionId, pending.messageId, answer, workspaceId ?? "")
                  .finally(() => setBusyId(null));
                onStatusNote(answer.skipped ? "Rückfrage übersprungen." : "Antwort gesendet.");
              }}
              question={pending.question}
              reviews={pending.remediationReviews}
            />
            ) : (
              <AssistantQuestionCard
                busy={busyId === pending.actionId}
                key={pending.actionId}
                onSubmit={(answer) => {
                  setBusyId(pending.actionId);
                  void useRuntimeChatStore
                    .getState()
                    .submitAssistantAnswer(pending.actionId, pending.messageId, answer, workspaceId ?? "")
                    .finally(() => setBusyId(null));
                  onStatusNote(answer.skipped ? "Rückfrage übersprungen." : "Antwort gesendet.");
                }}
                question={pending.question}
              />
            )
          )}

          {pendingToolApprovals.map((approval) => (
            <ToolApprovalCard
              approval={approval}
              busy={busyId === approval.id}
              key={approval.id}
              onApprove={(rememberAllowlist) => {
                setBusyId(approval.id);
                approvalHub.approveTool(approval.id, { rememberAllowlist, workspaceId: workspaceId ?? undefined });
                setBusyId(null);
                onStatusNote(`Tool ${approval.toolName} freigegeben.`);
              }}
              onReject={() => {
                approvalHub.rejectTool(approval.id, workspaceId ?? undefined);
                onStatusNote(`Tool ${approval.toolName} abgelehnt.`);
              }}
            />
          ))}

          {pendingTakeovers.map((approval) => (
            <TakeoverCard
              approval={approval}
              busy={busyId === approval.id}
              key={approval.id}
              onApprove={() => void handleApproveTakeover(approval.id)}
              onReject={() => {
                approvalHub.rejectTakeover(approval.id, workspaceId ?? undefined);
                onStatusNote("Vorschlag abgelehnt.");
              }}
            />
          ))}

          {pendingStructuredActions.map((approval) => (
            <StructuredChatActionCard
              approval={approval}
              busy={busyId === approval.id}
              key={approval.id}
              onApprove={() => {
                setBusyId(approval.id);
                if (!workspaceId) return;
                void approvalHub.approveChatAction(approval.approveActionId, approval.messageId, workspaceId).finally(() => setBusyId(null));
                onStatusNote(`${approval.title} freigegeben.`);
              }}
              onReject={() => {
                setBusyId(approval.id);
                if (!workspaceId) return;
                void approvalHub.rejectChatAction(approval.rejectActionId ?? approval.approveActionId, approval.messageId, workspaceId).finally(() => setBusyId(null));
                onStatusNote(`${approval.title} abgelehnt.`);
              }}
            />
          ))}

          {scopedReviewGates.map((gate) => (
            <ReviewGateCard
              busy={busyId === gate.id}
              gate={gate}
              key={gate.id}
              onApprove={() => void handleApproveGate(gate.id)}
              onReject={() => void handleRejectGate(gate.id)}
            />
          ))}

          {resolvedTakeovers.map((approval) => (
            <TakeoverCard
              approval={approval}
              busy={false}
              key={approval.id}
              onApprove={() => undefined}
              onReject={() => undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function useRuntimeChatPendingApprovalCount(workspaceRoot: string | null): number {
  const workspaceId = workspaceRoot ? workspaceScopeId(workspaceRoot) : null;
  const pendingTakeovers = useRuntimeChatApprovalStore(
    (state) => state.takeovers.filter((entry) => entry.status === "pending" && entry.workspaceId === workspaceId).length
  );
  const pendingTools = useRuntimeChatApprovalStore(
    (state) => state.toolApprovals.filter((entry) => entry.status === "pending" && entry.workspaceId === workspaceId).length
  );
  const pendingStructuredActions = useRuntimeChatStore(
    (state) => approvalHub.getPendingStructuredApprovalItems(state.messages, {
      planProposalsById: state.planProposalsById,
      workspaceId: workspaceId ?? undefined
    }).length
  );
  const pendingAssistantQuestions = useRuntimeChatStore(
    (state) => collectPendingAssistantQuestions(state.messages, workspaceId ?? undefined).length
  );
  const [reviewGateCount, setReviewGateCount] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        if (!workspaceId) {
          setReviewGateCount(0);
          return;
        }
        const gates = await reviewGateService.listPending({ workspaceId });
        if (active) {
          setReviewGateCount(gates.length);
        }
      } catch {
        if (active) {
          setReviewGateCount(0);
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [workspaceId]);

  return pendingTakeovers + pendingTools + pendingStructuredActions + pendingAssistantQuestions + reviewGateCount;
}
