import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RuntimeChatComposer } from "./RuntimeChatComposer";
import type { RuntimeChatAttachment } from "@dbzs/shared";

function makeAttachment(): RuntimeChatAttachment {
  return {
    id: "attachment-1",
    kind: "text",
    name: "plan.txt",
    extension: "txt",
    mimeType: "text/plain",
    dataUrl: "",
    source: "clipboard",
    sizeBytes: 12,
    textContent: "Hello world"
  };
}

describe("RuntimeChatComposer", () => {
  it("submits with Enter, toggles controls and shows attachments", () => {
    const onDraftChange = vi.fn();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const onPasteAttachments = vi.fn();
    const onDropAttachments = vi.fn();
    const onOpenAttachmentDialog = vi.fn();
    const onRemoveAttachment = vi.fn();
    const setChatMode = vi.fn();
    const setToolProfile = vi.fn();
    const setIncludeWorkspaceContext = vi.fn();

    render(
      <RuntimeChatComposer
        attachments={[makeAttachment()]}
        chatMode="auto"
        contextNote={null}
        draft="Bitte analysieren"
        includeWorkspaceContext={false}
        isSending={false}
        isStreaming={false}
        onCancel={onCancel}
        onDraftChange={onDraftChange}
        onOpenAttachmentDialog={onOpenAttachmentDialog}
        onPasteAttachments={onPasteAttachments}
        onDropAttachments={onDropAttachments}
        onRemoveAttachment={onRemoveAttachment}
        onSubmit={onSubmit}
        runtimeReady
        setChatMode={setChatMode}
        setIncludeWorkspaceContext={setIncludeWorkspaceContext}
        setToolProfile={setToolProfile}
        toolProfile="ask"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Als Agent" }));
    fireEvent.change(screen.getByLabelText("Werkzeugrechte:"), { target: { value: "full" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Kontext" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Neue Frage" } });
    fireEvent.paste(screen.getByRole("textbox"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /Anhaengen/i }));
    fireEvent.click(screen.getByRole("button", { name: /Entfernen|Loeschen/i }));

    expect(setChatMode).toHaveBeenCalledWith("agent");
    expect(setToolProfile).toHaveBeenCalledWith("full");
    expect(setIncludeWorkspaceContext).toHaveBeenCalledWith(true);
    expect(onDraftChange).toHaveBeenCalledWith("Neue Frage");
    expect(onPasteAttachments).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenAttachmentDialog).toHaveBeenCalledTimes(1);
    expect(onRemoveAttachment).toHaveBeenCalledWith("attachment-1");
  });

  it("shows stop while streaming and prevents submission when runtime is unavailable", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(
      <RuntimeChatComposer
        attachments={[]}
        chatMode="auto"
        contextNote="Notiz"
        draft=""
        includeWorkspaceContext
        isSending={false}
        isStreaming
        onCancel={onCancel}
        onDraftChange={vi.fn()}
        onOpenAttachmentDialog={vi.fn()}
        onPasteAttachments={vi.fn()}
        onDropAttachments={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onSubmit={onSubmit}
        runtimeReady={false}
        setChatMode={vi.fn()}
        setIncludeWorkspaceContext={vi.fn()}
        setToolProfile={vi.fn()}
        toolProfile="agent"
      />
    );

    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Senden/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Stopp/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
