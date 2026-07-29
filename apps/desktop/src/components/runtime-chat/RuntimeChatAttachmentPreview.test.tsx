import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it } from "vitest";
import type { RuntimeChatAttachment } from "@dbzs/shared";
import { RuntimeChatAttachmentPreview } from "@/components/runtime-chat/RuntimeChatAttachmentPreview";

describe("RuntimeChatAttachmentPreview", () => {
  it("shows truncation, archive details and errors for non-image attachments", () => {
    const attachment: RuntimeChatAttachment = {
      id: "att-1",
      name: "sources.zip",
      kind: "archive",
      extension: "zip",
      mimeType: "application/zip",
      dataUrl: "",
      source: "file_dialog",
      sizeBytes: 2_048_000,
      textContent: "x".repeat(520),
      derivedSummary: "ZIP mit 3 Eintraegen (gekuerzt)",
      truncated: true,
      error: "Eine Datei im Archiv war nicht lesbar.",
      archiveEntries: [
        { path: "src/a.ts", kind: "code", includedInline: true },
        { path: "src/b.ts", kind: "code", includedInline: true, truncated: true },
        { path: "assets/logo.png", kind: "binary" }
      ]
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<RuntimeChatAttachmentPreview attachment={attachment} maxPreviewChars={120} />);
    });

    expect(container.textContent).toContain("Gekuerzt");
    expect(container.textContent).toContain("Fehler");
    expect(container.textContent).toContain("3 Eintraege");
    expect(container.textContent).toContain("2 inline");
    expect(container.textContent).toContain("1 binaer");
    expect(container.textContent).toContain("1 gekuerzt");
    expect(container.textContent).toContain("Vorschau gekuerzt fuer die Kartenansicht.");
    expect(container.textContent).toContain("Eine Datei im Archiv war nicht lesbar.");
    expect(container.textContent).toContain("2.0 MB");

    root.unmount();
    container.remove();
  });
});
