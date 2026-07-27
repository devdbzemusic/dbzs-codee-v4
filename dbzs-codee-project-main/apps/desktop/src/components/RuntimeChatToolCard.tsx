import type { RuntimeChatToolCallRecord } from "@dbzs/shared";

export function RuntimeChatToolCard({
  toolCall,
  compact = false
}: {
  toolCall: RuntimeChatToolCallRecord;
  compact?: boolean;
}) {
  const statusColor =
    toolCall.status === "done"
      ? "border-green-500/40 text-green-400"
      : toolCall.status === "error"
        ? "border-red-400/40 text-red-400"
        : "border-dbzs-cyan/40 text-dbzs-cyan";

  return (
    <div
      className={`rounded border bg-dbzs-bg px-2 py-1 ${statusColor} ${compact ? "text-[9px]" : "text-[10px]"}`}
    >
      <div className="flex items-center justify-between gap-2 font-mono">
        <span>{toolCall.name}</span>
        <span className="uppercase tracking-wide opacity-70">{toolCall.status}</span>
      </div>
      {toolCall.filePath ? (
        <div className="mt-0.5 truncate text-dbzs-muted">{toolCall.filePath}</div>
      ) : null}
      {toolCall.outputSummary ? (
        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[9px] leading-4 text-dbzs-muted">
          {toolCall.outputSummary}
        </pre>
      ) : null}
      {toolCall.diffPreview ? (
        <pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap font-mono text-[9px] leading-4 text-dbzs-muted">
          {toolCall.diffPreview}
        </pre>
      ) : null}
      {toolCall.durationMs !== undefined ? (
        <div className="mt-0.5 text-[9px] text-dbzs-muted">{toolCall.durationMs}ms</div>
      ) : null}
    </div>
  );
}

export function RuntimeChatToolCardList({
  toolCalls,
  compact = false
}: {
  toolCalls: RuntimeChatToolCallRecord[];
  compact?: boolean;
}) {
  if (!toolCalls || toolCalls.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1">
      {toolCalls.map((call) => (
        <RuntimeChatToolCard compact={compact} key={call.id} toolCall={call} />
      ))}
    </div>
  );
}
