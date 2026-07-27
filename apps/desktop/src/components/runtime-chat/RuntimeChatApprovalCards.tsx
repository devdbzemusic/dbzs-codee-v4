import type { ReviewGate } from "@dbzs/shared";
import { useState } from "react";
import { approvalHub } from "@/services/approvalHub";
import { useRuntimeChatApprovalStore, type ChatTakeoverApproval } from "@/stores/runtimeChatApprovalStore";
import { approvalRiskClass } from "@/components/runtime-chat/runtimeChatApprovalsHelpers";

export type StructuredApprovalItem = ReturnType<
  typeof approvalHub.getPendingStructuredApprovalItems
>[number];

export type ToolApprovalItem = ReturnType<
  typeof useRuntimeChatApprovalStore.getState
>["toolApprovals"][number];

export function TakeoverCard({
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

export function ReviewGateCard({
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
            className={`rounded border px-2 py-1 text-[10px] ${approvalRiskClass(change.riskLevel)}`}
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

export function StructuredChatActionCard({
  approval,
  onApprove,
  onReject,
  busy
}: {
  approval: StructuredApprovalItem;
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
  const approveLabel =
    isPlanAction ? "Plan übernehmen" : isPatchAction ? "Änderungen übernehmen" : "Freigeben";

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
          Ablehnen
        </button>
      </div>
      <p className="mt-1 text-[10px] text-dbzs-muted">Nachricht: {approval.messageId}</p>
    </article>
  );
}

export function ToolApprovalCard({
  approval,
  busy,
  onApprove,
  onReject
}: {
  approval: ToolApprovalItem;
  busy: boolean;
  onApprove: (rememberAllowlist: boolean) => void;
  onReject: () => void;
}) {
  const [rememberAllowlist, setRememberAllowlist] = useState(false);
  const commandPreview =
    approval.toolName === "run_terminal_command" &&
    typeof approval.inputSnapshot?.command === "string"
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
