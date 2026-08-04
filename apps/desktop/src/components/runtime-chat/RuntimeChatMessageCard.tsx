import type { RuntimeChatMessage } from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import { useMemo } from "react";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";
import { RuntimeChatAttachmentPreview } from "@/components/runtime-chat/RuntimeChatAttachmentPreview";
import { getFollowUpChatActions, getRequiredChatActions, getRuntimeAgentActionsForMessage, getTransportActionTone, hasPendingRuntimeActionKind, isRejectTransportAction } from "@/services/runtimeChatActionSelectors";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useEditorStore } from "@/stores/editorStore";

function TraceStatusIcon({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <svg aria-hidden="true" className="h-3 w-3 text-dbzs-green" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg aria-hidden="true" className="h-3 w-3 text-dbzs-red" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="h-3 w-3 animate-spin text-dbzs-cyan" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
    </svg>
  );
}

export function stripPrivateReasoning(content: string): string {
  return content
    .replace(/<(thought|think|analysis|chain-of-thought|reasoning-summary)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(thought|think|analysis|chain-of-thought|reasoning-summary)\b[^>]*>[\s\S]*$/gi, "")
    .trim();
}

export function RuntimeChatMessageCard({
  message,
  canApply,
  compact = false,
  isStreaming = false,
  isSending = false,
  isLatestAssistantMessage = false,
  onApply
}: {
  message: RuntimeChatMessage;
  canApply: boolean;
  compact?: boolean;
  isStreaming?: boolean;
  isSending?: boolean;
  isLatestAssistantMessage?: boolean;
  onApply: (proposal: string) => void;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";
  const isQuestionPrompt = Boolean(message.actions?.some((action) => action.kind === "answer_question"));
  const isAnalysisProtocol = isSystem && message.content.startsWith("[Analyse-Protokoll]");
  const isCollapsedSystem = isSystem && !isAnalysisProtocol && message.content.length > 280;

  const settings = useSettingsStore((state) => state.settings);
  const reasoningDisplayMode = settings.reasoningDisplayMode ?? "summary";
  const reasoning = message.reasoningSummary;
  const patchProposal = useRuntimeChatStore((state) =>
    message.patchProposalId ? state.patchProposalsById[message.patchProposalId] ?? null : null
  );
  const patchPreview = useRuntimeChatStore((state) =>
    message.patchPreviewId ? state.patchPreviewsById[message.patchPreviewId] ?? null : null
  );
  const patchValidation = useRuntimeChatStore((state) =>
    message.patchProposalId
      ? state.patchValidationResult?.proposalId === message.patchProposalId
        ? state.patchValidationResult
        : null
      : null
  );
  const patchApplyResult = useRuntimeChatStore((state) =>
    message.patchProposalId
      ? state.patchApplyResult?.proposalId === message.patchProposalId
        ? state.patchApplyResult
        : null
      : null
  );
  const handleChatAction = useRuntimeChatStore((state) => state.handleChatAction);
  const agentActionsById = useRuntimeChatStore((state) => state.agentActionsById);
  const requiredChatActions = useMemo(() => getRequiredChatActions(message), [message.actions]);
  const followUpChatActions = useMemo(() => getFollowUpChatActions(message), [message.actions]);
  const runtimeAgentActions = useMemo(
    () => getRuntimeAgentActionsForMessage(message, agentActionsById),
    [agentActionsById, message.actionIds]
  );
  const planProposal = useRuntimeChatStore((state) =>
    message.planProposalId ? state.planProposalsById[message.planProposalId] ?? null : null
  );
  const patchState = useRuntimeChatStore((state) =>
    message.patchProposalId
      ? state.patchState === "APPLYING" || state.patchState === "VALIDATING"
        ? state.patchState
        : null
      : null
  );
  const workspaceRoot = useWorkspaceStore((state) => state.state.projectPath);
  const openSource = (filePath: string, line = 1) => {
    const absolute =
      workspaceRoot && !/^(?:[A-Za-z]:[\\/]|\/)/.test(filePath)
        ? `${workspaceRoot.replace(/[\\/]+$/, "")}/${filePath}`
        : filePath;
    void useEditorStore.getState().openWorkspaceConflictFile(absolute, line);
  };
  const hasPendingCommandApproval = hasPendingRuntimeActionKind(runtimeAgentActions, "command");
  const hasPendingWebApproval = hasPendingRuntimeActionKind(runtimeAgentActions, "web");
  const hasRequiredChatActions = requiredChatActions.length > 0;
  const hasFollowUpChatActions = isLatestAssistantMessage && followUpChatActions.length > 0;

  if (isCollapsedSystem) {
    return (
      <details className="rounded border border-dbzs-border/60 bg-dbzs-panelSoft px-2 py-1 text-[10px] text-dbzs-muted">
        <summary className="cursor-pointer">System-Kontext</summary>
        <pre className="mt-1 whitespace-pre-wrap font-mono text-[9px] leading-4">
          {message.content.slice(0, 1200)}
        </pre>
      </details>
    );
  }

  const cleanContent = isAssistant ? stripPrivateReasoning(message.content) : message.content;
  const cardClass = isUser
    ? "border border-dbzs-border/60 bg-dbzs-panel"
    : isAssistant
      ? "border border-dbzs-cyan/40 bg-dbzs-cyan/5"
      : isQuestionPrompt
        ? "border border-dbzs-border/40 bg-dbzs-bg/50"
        : "border border-dbzs-border/60 bg-dbzs-panelSoft";
  const retrievalDroppedItems = message.retrievalManifest?.droppedItems ?? [];
  const contextSections = message.contextManifest?.sections ?? [];
  const contextDroppedSections = message.contextManifest?.droppedSections ?? [];
  const contextCoverage = message.retrievalManifest
    ? message.retrievalManifest.candidateCount > 0
      ? Math.round(
          (message.retrievalManifest.selectedCount / message.retrievalManifest.candidateCount) * 100
        )
      : 0
    : contextSections.length + contextDroppedSections.length > 0
      ? Math.round(
          (contextSections.length / (contextSections.length + contextDroppedSections.length)) * 100
        )
      : 0;
  const duplicateContextRemoved =
    message.contextManifest?.duplicateContextRemoved ??
    retrievalDroppedItems.filter((item) => item.reason === "duplicate").length;
  const budgetDropCount =
    retrievalDroppedItems.filter((item) => item.reason === "token_budget").length +
    contextDroppedSections.length;

  return (
    <div className={`rounded ${cardClass} px-2 py-1.5`}>
      <div className="mb-0.5 flex items-center gap-2 text-[10px]">
        <span
          className={`rounded px-1 py-0.5 font-medium ${
            isUser
              ? "bg-dbzs-border/40 text-dbzs-text"
              : isAssistant
                ? "bg-dbzs-cyan/20 text-dbzs-cyan"
                : isQuestionPrompt
                  ? "bg-dbzs-border/20 text-dbzs-textSoft"
                  : "bg-dbzs-muted/20 text-dbzs-muted"
          }`}
        >
          {isUser ? "Du" : isAssistant ? "Assistent" : isQuestionPrompt ? "Rueckfrage" : "System"}
        </span>
      </div>

      {message.safeReasoningSummary && reasoningDisplayMode !== "hidden" && (
        <details
          className="mb-1 rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 px-2 py-1 text-[10px]"
          open={reasoningDisplayMode === "expanded"}
        >
          <summary
            className="cursor-pointer select-none font-bold text-dbzs-cyan"
            aria-label="CODEE Ablauf anzeigen/ausblenden"
          >
            CODEE Ablauf · {message.safeReasoningSummary.summary}
          </summary>
          <div className="mt-1 space-y-1 text-dbzs-textSoft">
            {reasoningDisplayMode === "expanded" &&
              message.traceEvents?.map((event) => (
                <div className="flex gap-2" key={event.id}>
                  <span>
                    <TraceStatusIcon status={event.status} />
                  </span>
                  <span>
                    <strong>{event.title}</strong> · {event.summary}
                  </span>
                </div>
              ))}
          </div>
        </details>
      )}

      {message.retrievalManifest || message.contextManifest ? (
        <details className="mb-1 rounded border border-dbzs-border/60 bg-dbzs-bg/40 px-2 py-1 text-[10px]">
          <summary className="cursor-pointer text-dbzs-textSoft">
            Kontext & Quellen ·{" "}
            {message.retrievalManifest
              ? `${message.retrievalManifest.selectedCount} von ${message.retrievalManifest.candidateCount} Treffern · ${message.retrievalManifest.totalTokens} Tokens`
              : `${contextSections.length} Kontextsektionen · ${message.contextManifest?.inputTokens ?? 0} Tokens`}
          </summary>
          <div className="mt-1 grid gap-1">
            {(message.sourceReferences ?? []).map((source) => (
              <button
                className="text-left text-dbzs-cyan hover:underline"
                key={source.id}
                onClick={() => source.filePath && openSource(source.filePath, source.startLine)}
                type="button"
              >
                {source.title}
                {source.filePath ? ` · ${source.filePath}` : ""}
                {source.startLine ? `:${source.startLine}` : ""}
              </button>
            ))}
            <span className="text-dbzs-muted">
              Context Coverage: {contextCoverage}% · Duplicate entfernt: {duplicateContextRemoved} ·
              Tokenersparnis: {message.contextManifest?.duplicateTokenSavings ?? 0} · Budget-Drops:{" "}
              {budgetDropCount}
            </span>
            <span className="text-dbzs-muted">
              Cache: {message.retrievalManifest?.cacheHits ?? message.contextManifest?.cacheHits ?? 0} Hits /{" "}
              {message.retrievalManifest?.cacheMisses ??
                message.contextManifest?.cacheMisses ??
                0}{" "}
              Misses
            </span>
            {message.retrievalManifest?.fallbackReason ? (
              <span className="text-dbzs-warning">
                Kontextlücke: {message.retrievalManifest.fallbackReason}
              </span>
            ) : null}
          </div>
        </details>
      ) : null}

      {!message.safeReasoningSummary && reasoning && reasoningDisplayMode !== "hidden" && (
        <p className="mb-1 text-[10px] text-dbzs-muted">
          Ablaufdaten für diese ältere Nachricht sind nicht verfügbar.
        </p>
      )}

      {cleanContent ? (
        <MessageMarkdown
          className="prose-invert max-w-none text-[11px] leading-5 text-dbzs-text"
          content={cleanContent}
          onApply={canApply && isAssistant ? onApply : undefined}
          isStreaming={isStreaming}
        />
      ) : null}

      {message.attachments?.length ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {message.attachments.map((attachment) => (
            <RuntimeChatAttachmentPreview
              attachment={attachment}
              key={attachment.id}
              maxPreviewChars={500}
            />
          ))}
        </div>
      ) : null}

      {planProposal ? (
        <div className="mt-2 rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-2 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="font-semibold text-dbzs-cyan">Geplanter Ablauf</div>
            <span className="rounded border border-dbzs-border px-1.5 py-0.5 text-[9px] text-dbzs-muted">
              {planProposal.state}
            </span>
          </div>
          <div className="mb-1 font-medium text-dbzs-text">{planProposal.title}</div>
          <div className="mb-2 text-dbzs-textSoft">{planProposal.summary}</div>
          <ol className="mb-2 list-decimal space-y-1 pl-4 text-dbzs-textSoft">
            {planProposal.steps.slice(0, 4).map((step) => (
              <li key={step.id}>
                <span className="font-medium text-dbzs-text">{step.title}</span>
                {step.description ? ` · ${step.description}` : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {patchProposal ? (
        <div className="mt-2 rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-2 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-dbzs-cyan">
                CODEE möchte {patchProposal.changes.length} Datei
                {patchProposal.changes.length === 1 ? "" : "en"} ändern
              </div>
              <div className="text-dbzs-muted">{patchProposal.title}</div>
            </div>
            <span className="rounded border border-dbzs-border px-1.5 py-0.5 text-[9px] text-dbzs-muted">
              {patchPreview?.state ?? "PREVIEW_READY"}
            </span>
          </div>
          <div className="mb-2 text-dbzs-textSoft">{patchProposal.summary}</div>
          <div className="mb-2 space-y-1">
            {patchProposal.changes.slice(0, 3).map((change) => (
              <div
                className="rounded border border-dbzs-border/70 bg-dbzs-bg/60 px-2 py-1"
                key={change.id}
              >
                <div className="font-medium text-dbzs-text">{change.filePath}</div>
                <div className="text-dbzs-muted">
                  {change.changeType} · Risiko: {change.riskLevel}
                </div>
              </div>
            ))}
          </div>
          {patchPreview?.previews?.[0]?.diff ? (
            <details className="mb-2 rounded border border-dbzs-border bg-dbzs-bg/70">
              <summary className="cursor-pointer px-2 py-1 text-dbzs-cyan">Diff anzeigen</summary>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t border-dbzs-border p-2 text-[9px] leading-4 text-dbzs-text">
                {patchPreview.previews[0].diff}
              </pre>
            </details>
          ) : null}
          {workspaceRoot ? (
            <div className="text-[9px] text-dbzs-muted">Workspace: {workspaceRoot}</div>
          ) : null}
        </div>
      ) : null}

      {patchValidation ? (
        <div className="mt-2 rounded border border-dbzs-border/60 bg-dbzs-panelSoft p-2 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="font-semibold text-dbzs-text">Validierung</div>
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] ${
                patchValidation.success
                  ? "border-dbzs-cyan/40 text-dbzs-cyan"
                  : "border-dbzs-red/40 text-dbzs-red"
              }`}
            >
              {patchValidation.success ? "BESTANDEN" : "FEHLER"}
            </span>
          </div>
          <div className="space-y-1">
            {patchValidation.commands.map((command) => (
              <div
                key={command.commandId}
                className="rounded border border-dbzs-border/60 bg-dbzs-bg/60 px-2 py-1"
              >
                <div className="font-medium text-dbzs-text">{command.commandId}</div>
                <div className="text-dbzs-muted">
                  Exit {command.exitCode ?? "?"}
                  {command.stderr ? ` · ${command.stderr}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {hasPendingCommandApproval ? (
        <div className="mt-2 rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-2 text-[10px]">
          <div className="mb-1 font-semibold text-dbzs-cyan">Terminal-Freigabe</div>
          <div className="text-dbzs-textSoft">
            CODEE wartet auf Ihre Freigabe für einen sicheren Terminalbefehl.
          </div>
        </div>
      ) : null}

      {hasPendingWebApproval ? (
        <div className="mt-2 rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-2 text-[10px]">
          <div className="mb-1 font-semibold text-dbzs-cyan">Web-Freigabe</div>
          <div className="text-dbzs-textSoft">
            CODEE wartet auf Ihre Freigabe für eine Websuche oder einen Web-Fetch.
          </div>
        </div>
      ) : null}

      {patchState ? (
        <div className="mt-2 rounded border border-dbzs-border/60 bg-dbzs-panelSoft p-2 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="font-semibold text-dbzs-text">Änderung</div>
            <span className="rounded border border-dbzs-cyan/40 px-1.5 py-0.5 text-[9px] text-dbzs-cyan">
              {patchState === "APPLYING"
                ? "WIRD ANGEWENDET…"
                : patchState === "VALIDATING"
                  ? "WIRD VALIDIERT…"
                  : "WIRD GENEHMIGT…"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-dbzs-textSoft">
            <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-dbzs-cyan" />
            <span>Der Patch wird gerade verarbeitet.</span>
          </div>
        </div>
      ) : null}

      {patchApplyResult ? (
        <div className="mt-2 rounded border border-dbzs-border/60 bg-dbzs-panelSoft p-2 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="font-semibold text-dbzs-text">Änderung</div>
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] ${
                patchApplyResult.applied
                  ? "border-dbzs-cyan/40 text-dbzs-cyan"
                  : "border-dbzs-red/40 text-dbzs-red"
              }`}
            >
              {patchApplyResult.applied ? "ANGEWENDET" : "ROLLBACK"}
            </span>
          </div>
          <div className="text-dbzs-textSoft">
            {patchApplyResult.applied
              ? `Änderungen in ${patchApplyResult.changedFiles.length} Datei(en) angewendet.`
              : `Patch wurde zurückgerollt${
                  patchApplyResult.errors[0] ? `: ${patchApplyResult.errors[0]}` : "."
                }`}
          </div>
          {patchApplyResult.changedFiles.length > 0 ? (
            <div className="mt-1 text-dbzs-muted">
              Geänderte Dateien: {patchApplyResult.changedFiles.join(", ")}
            </div>
          ) : null}
        </div>
      ) : null}

      {hasRequiredChatActions && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded border border-dbzs-border/60 bg-dbzs-panelSoft p-2"
          aria-label="Erforderliche Freigabe oder Aktion"
        >
          {requiredChatActions.map((act) => {
            const isPending = act.state === "pending";
            const isApproved = act.state === "approved";
            const isCompleted = act.state === "completed";
            const isRejected = act.state === "rejected";
            const isFailed = act.state === "failed";
            let { colorClass, statusBadgeClass } = getTransportActionTone(act);

            if (isApproved || isCompleted) {
              colorClass =
                "border-dbzs-cyan text-dbzs-cyan bg-dbzs-cyan/15 shadow-[0_0_0_1px_rgba(34,211,238,0.25)]";
              statusBadgeClass = "text-dbzs-cyan";
            } else if (isRejected || isFailed) {
              colorClass =
                "border-dbzs-red text-dbzs-red bg-dbzs-red/10 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]";
              statusBadgeClass = "text-dbzs-red";
            }

            return (
              <div key={act.id} className="flex flex-col gap-1">
                <button
                  onClick={() =>
                    isPending &&
                    workspaceRoot &&
                    handleChatAction(
                      act.id,
                      message.id,
                      !isRejectTransportAction(act),
                      workspaceScopeId(workspaceRoot)
                    )
                  }
                  disabled={!isPending}
                  className={`flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-bold transition-colors duration-150 ${colorClass} disabled:cursor-not-allowed disabled:opacity-50`}
                  aria-label={`${act.title} - Risiko: ${act.riskLevel ?? "niedrig"}`}
                >
                  {isApproved && (
                    <span
                      className={`h-2.5 w-2.5 rounded-full bg-current ${
                        isApproved ? "animate-ping" : ""
                      }`}
                    />
                  )}
                  {isRejected && (
                    <span className={`h-2.5 w-2.5 rounded-full border border-current ${statusBadgeClass}`} />
                  )}
                  {isCompleted && <span className="h-2.5 w-2.5 rounded-full bg-current" />}
                  <span className={isPending ? "" : statusBadgeClass}>{act.title}</span>
                  {isCompleted && (
                    <svg aria-hidden="true" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {isRejected && (
                    <svg aria-hidden="true" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
                {isFailed && act.description && (
                  <span className="mt-0.5 text-[9px] text-dbzs-red">{act.description}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasFollowUpChatActions && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded border border-dbzs-border/40 bg-dbzs-bg/40 p-2"
          aria-label="Vorgeschlagene Folgeaktionen"
        >
          {followUpChatActions.map((act) => (
            <button
              key={act.id}
              type="button"
              disabled={isSending || act.state !== "pending"}
              onClick={() =>
                workspaceRoot &&
                handleChatAction(act.id, message.id, true, workspaceScopeId(workspaceRoot))
              }
              className="rounded border border-dbzs-border/60 px-2.5 py-1 text-[11px] text-dbzs-textSoft transition-colors hover:border-dbzs-cyan/40 hover:text-dbzs-cyan disabled:cursor-not-allowed disabled:opacity-50"
            >
              {act.title}
              {act.state === "completed" ? (
                <svg aria-hidden="true" className="ml-1 inline-block h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                ""
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
