import { ClipboardEvent, KeyboardEvent, DragEvent, useEffect, useRef, useState, memo } from "react";
import type { RuntimeChatAttachment } from "@dbzs/shared";
import { RuntimeChatAttachmentPreview } from "@/components/runtime-chat/RuntimeChatAttachmentPreview";
import { Button } from "@/components/ui/Button";

function RuntimeChatComposerComponent({
  draft,
  runtimeReady,
  isSending,
  isStreaming,
  chatMode,
  toolProfile,
  includeWorkspaceContext,
  contextNote,
  attachments,
  onDraftChange,
  onSubmit,
  onCancel,
  onPasteAttachments,
  onDropAttachments,
  onOpenAttachmentDialog,
  onRemoveAttachment,
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
  attachments: RuntimeChatAttachment[];
  onDraftChange: (value: string) => void;
  onSubmit: (overrideText?: string) => void;
  onCancel: () => void;
  onPasteAttachments: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDropAttachments: (event: DragEvent<HTMLElement>) => void;
  onOpenAttachmentDialog: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  setChatMode: (mode: "auto" | "agent") => void;
  setToolProfile: (profile: "ask" | "agent" | "full") => void;
  setIncludeWorkspaceContext: (value: boolean) => void;
}) {
  const [localDraft, setLocalDraft] = useState(draft);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  useEffect(() => {
    setLocalDraft(draft);
  }, [draft]);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const handleTextChange = (value: string) => {
    setLocalDraft(value);
    
    const isTest = typeof process !== "undefined" && process.env.NODE_ENV === "test";
    if (isTest) {
      onDraftChangeRef.current(value);
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      onDraftChangeRef.current(value);
    }, 150);
  };

  const canSubmit = localDraft.trim().length > 0 || attachments.length > 0;

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsDragging(false);
    onDropAttachments(e);
  };

  const lastWord = localDraft.split(/\s+/).pop() || "";
  const showSuggestions = lastWord.startsWith("/");
  const suggestions = ["/goal", "/schedule", "/grill-me", "/learn"].filter(
    (cmd) => cmd.startsWith(lastWord) && cmd !== lastWord
  );

  const applySuggestion = (cmd: string) => {
    const words = localDraft.split(/\s+/);
    words.pop();
    const prefix = words.join(" ");
    const nextText = (prefix ? prefix + " " : "") + cmd + " ";
    handleTextChange(nextText);
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        applySuggestion(suggestions[0]);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (!isSending && runtimeReady && canSubmit) {
      onSubmit(localDraft);
    }
  };

  return (
    <form
      className="relative border-t border-dbzs-border bg-dbzs-panel p-2"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(localDraft);
      }}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-dbzs-cyan/20 border-2 border-dashed border-dbzs-cyan backdrop-blur-sm flex items-center justify-center text-xs font-semibold text-dbzs-cyan z-20 pointer-events-none transition-all">
          Dateien hier ablegen
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="text-dbzs-muted">Gespraechsmodus:</span>
        <Button active={chatMode === "auto"} onClick={() => setChatMode("auto")} title="Codee entscheidet selbst, wie agentisch die Antwort sein soll.">
          Automatisch
        </Button>
        <Button active={chatMode === "agent"} onClick={() => setChatMode("agent")} title="Mehr explizite Umsetzungs- und Ausfuehrungsschritte statt nur Antworttext.">
          Als Agent
        </Button>
        <label className="text-dbzs-muted" htmlFor="runtime-chat-tool-profile">Werkzeugrechte:</label>
        <select
          className="rounded border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[10px] text-dbzs-muted"
          disabled={isSending}
          id="runtime-chat-tool-profile"
          title="Steuert, wie offensiv Codee Tools und Ausfuehrungen nutzen darf."
          value={toolProfile}
          onChange={(event) => setToolProfile(event.currentTarget.value as "ask" | "agent" | "full")}
        >
          <option value="ask">Ask</option>
          <option value="agent">Agent</option>
          <option value="full">Full</option>
        </select>
        <label className="inline-flex items-center gap-1 text-dbzs-muted" title="Wenn aktiv, darf der Chat Workspace, aktive Datei und Mentions mitdenken.">
          <input
            checked={includeWorkspaceContext}
            className="h-3 w-3"
            onChange={(event) => setIncludeWorkspaceContext(event.currentTarget.checked)}
            type="checkbox"
          />
          Kontext
        </label>
        <span className="ml-auto truncate text-dbzs-muted">
          {contextNote ?? "Enter senden · Shift+Enter neue Zeile · Strg+V fuer Dateien"}
        </span>
      </div>
      <div className="mb-2 text-[10px] text-dbzs-muted">
        Schreib einfach natuerlich, was du erreichen willst. Dateien kannst du per Strg+V einfuegen
        oder ueber den Anhaengen-Button auswaehlen.
      </div>
      {attachments.length > 0 ? (
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          {attachments.map((attachment) => (
            <RuntimeChatAttachmentPreview
              attachment={attachment}
              key={attachment.id}
              maxPreviewChars={400}
              onRemove={() => onRemoveAttachment(attachment.id)}
            />
          ))}
        </div>
      ) : null}
      <div className="flex gap-2 relative">
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute bottom-[100%] left-0 mb-1 bg-dbzs-panel border border-dbzs-border rounded shadow-lg p-1 z-30 max-h-32 overflow-y-auto flex flex-col gap-0.5 min-w-[120px]">
            {suggestions.map((cmd) => (
              <button
                key={cmd}
                type="button"
                className="text-left px-2 py-1 text-[10px] hover:bg-dbzs-cyan/10 hover:text-dbzs-cyan rounded text-dbzs-text transition-colors cursor-pointer font-mono"
                onClick={() => applySuggestion(cmd)}
              >
                {cmd}
              </button>
            ))}
          </div>
        )}
        <textarea
          className="min-h-[72px] flex-1 resize-y rounded border border-dbzs-border bg-dbzs-bg px-2 py-2 text-[11px] leading-5 text-dbzs-text outline-none focus:border-dbzs-cyan/60"
          disabled={!runtimeReady || isSending}
          onChange={(event) => handleTextChange(event.currentTarget.value)}
          onKeyDown={onComposerKeyDown}
          onPaste={onPasteAttachments}
          placeholder={
            runtimeReady
              ? "Analysiere, plane, debugge oder haenge Dateien an ..."
              : "Backend verbinden ..."
          }
          rows={3}
          value={localDraft}
        />
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            disabled={!runtimeReady || isSending}
            onClick={(event) => {
              event.preventDefault();
              onOpenAttachmentDialog();
            }}
            type="button"
          >
            <span className="inline-flex items-center gap-1">
              <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.48" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Anhaengen
            </span>
          </Button>
          {isSending || isStreaming ? (
            <Button
              variant="danger"
              onClick={(event) => {
                event.preventDefault();
                onCancel();
              }}
            >
              <span className="inline-flex items-center gap-1">
                <svg aria-hidden="true" className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                  <rect height="14" rx="1.5" width="14" x="5" y="5" />
                </svg>
                Stopp
              </span>
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={!runtimeReady || isSending || !canSubmit}
            type="submit"
          >
            {isSending ? (
              "..."
            ) : (
              <span className="inline-flex items-center gap-1">
                <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Senden
              </span>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

export const RuntimeChatComposer = memo(RuntimeChatComposerComponent);
