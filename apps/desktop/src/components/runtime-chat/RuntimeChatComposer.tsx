import type { ClipboardEvent, KeyboardEvent } from "react";
import type { RuntimeChatAttachment } from "@dbzs/shared";
import { RuntimeChatAttachmentPreview } from "@/components/runtime-chat/RuntimeChatAttachmentPreview";
import { Button } from "@/components/ui/Button";

export function RuntimeChatComposer({
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
  onSubmit: () => void;
  onCancel: () => void;
  onPasteAttachments: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onOpenAttachmentDialog: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  setChatMode: (mode: "auto" | "agent") => void;
  setToolProfile: (profile: "ask" | "agent" | "full") => void;
  setIncludeWorkspaceContext: (value: boolean) => void;
}) {
  const canSubmit = draft.trim().length > 0 || attachments.length > 0;

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (!isSending && runtimeReady && canSubmit) {
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
      <div className="flex gap-2">
        <textarea
          className="min-h-[72px] flex-1 resize-y rounded border border-dbzs-border bg-dbzs-bg px-2 py-2 text-[11px] leading-5 text-dbzs-text outline-none focus:border-dbzs-cyan/60"
          disabled={!runtimeReady || isSending}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          onKeyDown={onComposerKeyDown}
          onPaste={onPasteAttachments}
          placeholder={
            runtimeReady
              ? "Analysiere, plane, debugge oder haenge Dateien an ..."
              : "Backend verbinden ..."
          }
          rows={3}
          value={draft}
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
            Anhaengen
          </Button>
          {isSending || isStreaming ? (
            <Button
              variant="danger"
              onClick={(event) => {
                event.preventDefault();
                onCancel();
              }}
            >
              Stopp
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={!runtimeReady || isSending || !canSubmit}
            type="submit"
          >
            {isSending ? "..." : "Senden"}
          </Button>
        </div>
      </div>
    </form>
  );
}
