import type { AssistantQuestion, ReviewArtifactSummary, ReviewGate, RuntimeChatMessage } from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentOutputParseError } from "@/services/agentOutputParser";
import { approvalHub } from "@/services/approvalHub";
import { reviewGateService } from "@/services/reviewGateService";
import {
  type ChatTakeoverApproval,
  useRuntimeChatApprovalStore
} from "@/stores/runtimeChatApprovalStore";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import type { useEditorStore } from "@/stores/editorStore";
import { AssistantQuestionCard } from "@/components/AssistantQuestionCard";
import { ReviewRemediationSelectionCard } from "@/components/ReviewRemediationSelectionCard";

interface PendingAssistantQuestion {
  actionId: string;
  messageId: string;
  question: AssistantQuestion;
  remediationReviews?: ReviewArtifactSummary[];
}

function collectPendingAssistantQuestions(
  messages: RuntimeChatMessage[],
  workspaceId?: string
): PendingAssistantQuestion[] {
  const result: PendingAssistantQuestion[] = [];
  for (const message of messages) {
    for (const action of message.actions ?? []) {
      if (
        action.kind !== "answer_question" ||
        action.state !== "pending" ||
        (workspaceId && action.workspaceId !== workspaceId)
      ) {
        continue;
      }
      const payload = action.payload as {
        question?: AssistantQuestion;
        remediationReviews?: ReviewArtifactSummary[];
      } | undefined;
      const question = payload?.question;
      if (question) {
        result.push({
          actionId: action.id,
          messageId: message.id,
          question,
          remediationReviews: payload?.remediationReviews
        });
      }
    }
  }
  return result;
}

type QueueProposedChanges = ReturnType<typeof useEditorStore.getState>["queueProposedChanges"];

interface RuntimeChatApprovalsProps {
  onStatusNote: (note: string) => void;
  queueProposedChanges: QueueProposedChanges;
  workspaceRoot: string | null;
}

const POLL_INTERVAL_MS = 15_000;

function riskClass(riskLevel: string): string {
  switch (riskLevel) {
    case "low":
      return "text-green-400 border-green-400/30 bg-green-400/10";
    case "high":
      return "text-red-400 border-red-400/30 bg-red-400/10";
    default:
      return "text-amber-400 border-amber-400/30 bg-amber-400/10";
  }
}

function TakeoverCard({
  approval,
  busy,
  onApprove,
  onReject
}: {
  approval: ChatTakeoverApproval;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isPending = approval.status === "pending";
  const kindLabel = approval.kind === "patch" ? "Patch" : "Umsetzung";

  return (
    <article className="rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-dbzs-cyan">
            Chat-Freigabe · {kindLabel}
          </div>
          <h4 className="mt-1 truncate text-xs font-medium text-dbzs-text">{approval.title}</h4>
        </div>
        {!isPending ? (
          <span
            className={`shrink-0 rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] ${
              approval.status === "approved"
                ? "border-green-400/40 bg-green-400/10 text-green-400"
                : "border-red-400/40 bg-red-400/10 text-red-400"
            }`}
          >
            {approval.status === "approved" ? "Freigegeben" : "Abgelehnt"}
          </span>
        ) : null}
      </div>

      <p className="whitespace-pre-wrap text-[11px] leading-5 text-dbzs-muted">
        {approval.preview}
        {approval.proposal.length > approval.preview.length ? "…" : ""}
      </p>

      {approval.resultMessage ? (
        <p className="mt-2 text-[11px] text-dbzs-text">{approval.resultMessage}</p>
      ) : null}

      {isPending ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            className="flex-1 rounded border border-green-400/50 bg-green-400/10 px-3 py-1.5 text-xs font-medium text-green-400 disabled:opacity-40 hover:bg-green-400/20"
            disabled={busy}
            onClick={onApprove}
            type="button"
          >
            Freigeben
          </button>
          <button
            className="flex-1 rounded border border-red-400/50 bg-red-400/10 px-3 py-1.5 text-xs font-medium text-red-400 disabled:opacity-40 hover:bg-red-400/20"
            disabled={busy}
            onClick={onReject}
            type="button"
          >
            Ablehnen
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ReviewGateCard({
  gate,
  busy,
  onApprove,
  onReject
}: {
  gate: ReviewGate;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <article className="rounded border border-dbzs-amber/30 bg-dbzs-amber/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-dbzs-amber">
          Job-Review · Step {gate.stepNumber}
        </div>
        <div className="text-[10px] text-dbzs-muted">
          {new Date(gate.createdAt).toLocaleTimeString()}
        </div>
      </div>
      <p className="mb-2 text-[11px] text-dbzs-muted">
        Job {gate.jobId.slice(0, 8)} · {gate.proposedChanges.length} Aenderung(en)
      </p>

      <div className="mb-3 space-y-1">
        {gate.proposedChanges.map((change, index) => (
          <div
            className={`rounded border px-2 py-1 text-[10px] ${riskClass(change.riskLevel)}`}
            key={`${change.filePath}-${index}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono">{change.filePath}</span>
              <span className="shrink-0 uppercase tracking-[0.1em]">{change.riskLevel}</span>
            </div>
            {change.riskFactors && change.riskFactors.length > 0 ? (
              <div className="mt-0.5 text-dbzs-muted">{change.riskFactors.join(", ")}</div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          className="flex-1 rounded border border-green-400/50 bg-green-400/10 px-3 py-1.5 text-xs font-medium text-green-400 disabled:opacity-40 hover:bg-green-400/20"
          disabled={busy}
          onClick={onApprove}
          type="button"
        >
          Freigeben
        </button>
        <button
          className="flex-1 rounded border border-red-400/50 bg-red-400/10 px-3 py-1.5 text-xs font-medium text-red-400 disabled:opacity-40 hover:bg-red-400/20"
          disabled={busy}
          onClick={onReject}
          type="button"
        >
          Ablehnen
        </button>
      </div>
    </article>
  );
}

function StructuredChatActionCard({
  approval,
  onApprove,
  onReject,
  busy
}: {
  approval: ReturnType<typeof approvalHub.getPendingStructuredApprovalItems>[number];
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const isPlanAction = approval.kind === "plan";
  const isPatchAction = approval.kind === "patch";
  const label = isPlanAction
    ? "Plan"
    : isPatchAction
      ? "Patch"
      : approval.kind === "command"
        ? "Befehl"
        : approval.kind === "web"
          ? "Web"
          : approval.kind === "continue"
            ? "Weiter"
            : "Aktion";
  const approveLabel = isPlanAction ? "Plan übernehmen" : isPatchAction ? "Änderungen übernehmen" : "Freigeben";
  const rejectLabel = "Ablehnen";

  return (
    <article className="rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-dbzs-cyan">
        Chat-Freigabe · {label}
      </div>
      <p className="mt-1 text-xs text-dbzs-text">{approval.title}</p>
      {approval.description ? (
        <p className="mt-1 text-[11px] text-dbzs-muted">{approval.description}</p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          className="flex-1 rounded border border-green-400/50 bg-green-400/10 px-2 py-1.5 text-[11px] font-medium text-green-400 disabled:opacity-40"
          disabled={busy}
          onClick={onApprove}
          type="button"
        >
          {approveLabel}
        </button>
        <button
          className="flex-1 rounded border border-red-400/50 bg-red-400/10 px-2 py-1.5 text-[11px] font-medium text-red-400 disabled:opacity-40"
          disabled={busy}
          onClick={onReject}
          type="button"
        >
          {rejectLabel}
        </button>
      </div>
      <p className="mt-1 text-[10px] text-dbzs-muted">Nachricht: {approval.messageId}</p>
    </article>
  );
}

function ToolApprovalCard({
  approval,
  busy,
  onApprove,
  onReject
}: {
  approval: ReturnType<typeof useRuntimeChatApprovalStore.getState>["toolApprovals"][number];
  busy: boolean;
  onApprove: (rememberAllowlist: boolean) => void;
  onReject: () => void;
}) {
  const [rememberAllowlist, setRememberAllowlist] = useState(false);
  const commandPreview =
    approval.toolName === "run_terminal_command" && typeof approval.inputSnapshot?.command === "string"
      ? approval.inputSnapshot.command
      : null;

  return (
    <article className="rounded border border-amber-400/30 bg-amber-400/5 p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-amber-300">
        Tool-Freigabe · {approval.toolName}
      </div>
      <p className="mt-1 text-xs text-dbzs-text">{approval.reason}</p>
      {commandPreview ? (
        <pre className="mt-2 overflow-x-auto rounded border border-dbzs-border bg-dbzs-bg px-2 py-1.5 font-mono text-[11px] text-dbzs-text">
          {commandPreview}
        </pre>
      ) : null}
      <p className="mt-1 text-[10px] text-dbzs-muted">Actor: {approval.actorId}</p>
      {commandPreview ? (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-dbzs-muted">
          <input
            checked={rememberAllowlist}
            className="rounded border-dbzs-border"
            onChange={(event) => setRememberAllowlist(event.target.checked)}
            type="checkbox"
          />
          Befehl für dieses Projekt merken
        </label>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          className="rounded border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-2 py-1 text-[11px] text-dbzs-cyan disabled:opacity-40"
          disabled={busy}
          onClick={() => onApprove(rememberAllowlist)}
          type="button"
        >
          Freigeben
        </button>
        <button
          className="rounded border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-muted"
          onClick={onReject}
          type="button"
        >
          Ablehnen
        </button>
      </div>
    </article>
  );
}

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
