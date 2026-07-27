import React, { type KeyboardEvent } from "react";

export function RuntimeChatComposer({
  draft,
  runtimeReady,
  isSending,
  isStreaming,
  chatMode,
  toolProfile,
  includeWorkspaceContext,
  contextNote,
  onDraftChange,
  onSubmit,
  onCancel,
  setChatMode,
  setToolProfile,
  setIncludeWorkspaceContext
}: {
  draft: string;
  runtimeReady: boolean;
  isSending: boolean;
  isStreaming: boolean;
  chatMode: "auto" | "agent";
  toolProfile: "ask" | "agent" | "full";
  includeWorkspaceContext: boolean;
  contextNote: string | null;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  setChatMode: (mode: "auto" | "agent") => void;
  setToolProfile: (profile: "ask" | "agent" | "full") => void;
  setIncludeWorkspaceContext: (value: boolean) => void;
}) {
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (!isSending && runtimeReady && draft.trim().length > 0) {
      onSubmit();
    }
  };

  return (
    <form
      className="border-t border-dbzs-border bg-dbzs-panel p-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px]">
        <button
          className={`rounded border px-1.5 py-0.5 ${
            chatMode === "auto"
              ? "border-dbzs-cyan/60 bg-dbzs-cyan/10 text-dbzs-cyan"
              : "border-dbzs-border text-dbzs-muted"
          }`}
          onClick={() => setChatMode("auto")}
          type="button"
        >
          Auto
        </button>
        <button
          className={`rounded border px-1.5 py-0.5 ${
            chatMode === "agent"
              ? "border-dbzs-cyan/60 bg-dbzs-cyan/10 text-dbzs-cyan"
              : "border-dbzs-border text-dbzs-muted"
          }`}
          onClick={() => setChatMode("agent")}
          type="button"
        >
          Agent
        </button>
        <select
          className="rounded border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[10px] text-dbzs-muted"
          disabled={isSending}
          value={toolProfile}
          onChange={(event) => setToolProfile(event.currentTarget.value as "ask" | "agent" | "full")}
        >
          <option value="ask">Ask</option>
          <option value="agent">Agent</option>
          <option value="full">Full</option>
        </select>
        <label className="inline-flex items-center gap-1 text-dbzs-muted">
          <input
            checked={includeWorkspaceContext}
            className="h-3 w-3"
            onChange={(event) => setIncludeWorkspaceContext(event.currentTarget.checked)}
            type="checkbox"
          />
          Kontext
        </label>
        <span className="ml-auto truncate text-dbzs-muted">
          {contextNote ?? "Enter senden · Shift+Enter Zeile"}
        </span>
      </div>
      <div className="mb-2 text-[10px] text-dbzs-muted">
        Schreib einfach natürlich, was du erreichen willst. Kurze Antworten wie
        &quot;mach weiter&quot; oder &quot;genau so&quot; werden als Fortsetzung behandelt.
      </div>
      <div className="flex gap-2">
        <textarea
          className="min-h-[72px] flex-1 resize-y rounded border border-dbzs-border bg-dbzs-bg px-2 py-2 text-[11px] leading-5 text-dbzs-text outline-none focus:border-dbzs-cyan/60"
          disabled={!runtimeReady || isSending}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={
            runtimeReady
              ? "Analysiere, plane, debugge oder frag nach dem Status …"
              : "Backend verbinden …"
          }
          rows={3}
          value={draft}
        />
        <div className="flex shrink-0 flex-col gap-1">
          {isSending || isStreaming ? (
            <button
              className="rounded border border-red-400/50 bg-red-400/10 px-2 py-1 text-[10px] text-red-400"
              onClick={(event) => {
                event.preventDefault();
                onCancel();
              }}
              type="button"
            >
              Stopp
            </button>
          ) : null}
          <button
            className="rounded border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[10px] font-medium text-dbzs-cyan disabled:opacity-40"
            disabled={!runtimeReady || isSending || draft.trim().length === 0}
            type="submit"
          >
            {isSending ? "…" : "Senden"}
          </button>
        </div>
      </div>
    </form>
  );
}
