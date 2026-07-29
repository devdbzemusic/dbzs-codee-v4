import React, { useMemo } from "react";
import type { RuntimeChatMessage, RuntimeChatRun } from "@dbzs/shared";
import { CodeeRunLiveBlock } from "@/components/chat/CodeeRunLiveBlock";
import { RuntimeChatMessageCard } from "@/components/runtime-chat/RuntimeChatMessageCard";
import { findLastAssistantMessageIndex } from "@/services/runtimeChatActionSelectors";

function shouldRenderInlineRun(run: RuntimeChatRun, activeRunId: string | null): boolean {
  if (run.id === activeRunId) return true;
  if (run.status !== "completed") return true;
  if (run.outcome && run.outcome !== "success") return true;
  if (run.degraded || run.repositoryReview) return true;
  return false;
}

export function RuntimeChatConversationFeed({
  messages,
  historicalRuns,
  activeRun,
  compact,
  isSending,
  isStreaming,
  workspaceRoot,
  onApplyAssistantProposal,
  onCancelRun,
  onFixFindings,
  onRerunReview,
  onSelectExample
}: {
  messages: RuntimeChatMessage[];
  historicalRuns: Record<string, RuntimeChatRun>;
  activeRun: RuntimeChatRun | null;
  compact: boolean;
  isSending: boolean;
  isStreaming: boolean;
  workspaceRoot: string | null;
  onApplyAssistantProposal: (proposal: string) => void;
  onCancelRun: (runId?: string) => void;
  onFixFindings: (reviewId: string) => void;
  onRerunReview: () => void;
  onSelectExample: (example: string) => void;
}) {
  const activeRunId = activeRun?.id ?? null;
  const lastAssistantIndex = useMemo(() => findLastAssistantMessageIndex(messages), [messages]);

  const renderRunBlock = (run: RuntimeChatRun) => (
    <CodeeRunLiveBlock
      run={run}
      onCancel={() => onCancelRun(run.id)}
      isSending={isSending && activeRun?.id === run.id}
      workspaceRoot={workspaceRoot}
      onFixFindings={onFixFindings}
      onRerunReview={onRerunReview}
    />
  );

  return (
    <div className="bg-dbzs-bg px-2 py-2">
      {messages.length === 0 ? (
        <div className="space-y-3 rounded border border-dbzs-border/60 bg-dbzs-panelSoft/70 px-3 py-4">
          <p className="text-[11px] leading-5 text-dbzs-textSoft">
            Beschreibe einfach natürlich dein Ziel. Der Chat soll möglichst direkt loslegen,
            den aktuellen Workspace mitdenken und nur bei echten Blockern kurz nachfragen.
          </p>
          <div className="flex flex-wrap gap-2 text-[10px] text-dbzs-muted">
            {[
              "Prüfe die Ursache für den Fehler im Review-Controller.",
              "Mach weiter mit dem laufenden Fix.",
              "Wie weit bist du gerade?",
              "Zähle alle gguf Modelle im Workspace."
            ].map((example) => (
              <button
                className="rounded border border-dbzs-border/70 bg-dbzs-bg/70 px-2 py-1 text-left transition-colors hover:border-dbzs-cyan/40 hover:text-dbzs-cyan"
                key={example}
                onClick={() => onSelectExample(example)}
                type="button"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((message, index) => {
            const userRun =
              message.role === "user" && message.id
                ? Object.values(historicalRuns).find((run) => run.userMessageId === message.id) ||
                  (activeRun?.userMessageId === message.id ? activeRun : null)
                : null;
            const renderRun = userRun && shouldRenderInlineRun(userRun, activeRunId);

            return (
              <React.Fragment key={`${message.role}-${index}`}>
                <RuntimeChatMessageCard
                  compact={compact}
                  message={message}
                  canApply={!isSending}
                  isStreaming={
                    isStreaming && index === messages.length - 1 && message.role === "assistant"
                  }
                  isSending={isSending}
                  isLatestAssistantMessage={message.role === "assistant" && index === lastAssistantIndex}
                  onApply={onApplyAssistantProposal}
                />
                {renderRun ? renderRunBlock(userRun) : null}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {activeRun &&
      !messages.some((message) => activeRun.userMessageId === message.id) &&
      shouldRenderInlineRun(activeRun, activeRunId)
        ? renderRunBlock(activeRun)
        : null}
    </div>
  );
}
