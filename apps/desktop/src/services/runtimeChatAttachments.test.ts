import { describe, expect, it } from "vitest";
import type { RuntimeChatAttachment } from "@dbzs/shared";
import {
  attachmentRequiresVision,
  buildRuntimeChatAttachmentPrompt,
  defaultPromptForAttachments,
  mergeRuntimeChatAttachments,
  summarizeAttachmentImport
} from "@/services/runtimeChatAttachments";

describe("runtimeChatAttachments", () => {
  it("requires vision only when an image attachment is present", () => {
    expect(
      attachmentRequiresVision([
        {
          id: "att-1",
          name: "notes.md",
          kind: "text",
          extension: "md",
          mimeType: "text/markdown",
          dataUrl: "",
          source: "file_dialog"
        }
      ] satisfies RuntimeChatAttachment[])
    ).toBe(false);

    expect(
      attachmentRequiresVision([
        {
          id: "att-2",
          name: "screen.png",
          kind: "image",
          extension: "png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          source: "clipboard"
        }
      ] satisfies RuntimeChatAttachment[])
    ).toBe(true);
  });

  it("uses an image-aware default prompt only when needed", () => {
    expect(
      defaultPromptForAttachments([
        {
          id: "att-1",
          name: "notes.md",
          kind: "text",
          extension: "md",
          mimeType: "text/markdown",
          dataUrl: "",
          source: "file_dialog"
        }
      ] satisfies RuntimeChatAttachment[])
    ).toBe("Bitte analysiere die angehaengten Dateien.");

    expect(
      defaultPromptForAttachments([
        {
          id: "att-2",
          name: "screen.png",
          kind: "image",
          extension: "png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          source: "clipboard"
        }
      ] satisfies RuntimeChatAttachment[])
    ).toBe("Bitte analysiere die angehaengten Dateien und Bilder.");
  });

  it("builds a deterministic attachment prompt with truncation, errors and archive inventory", () => {
    const prompt = buildRuntimeChatAttachmentPrompt([
      {
        id: "att-archive",
        name: "bundle.zip",
        kind: "archive",
        extension: "zip",
        mimeType: "application/zip",
        dataUrl: "",
        source: "file_dialog",
        sizeBytes: 4096,
        truncated: true,
        derivedSummary: "ZIP mit 2 Eintraegen (gekuerzt)",
        error: "Eine Datei war nicht UTF-8 lesbar.",
        archiveEntries: [
          {
            path: "src/app.ts",
            kind: "code",
            sizeBytes: 128,
            includedInline: true
          },
          {
            path: "assets/logo.png",
            kind: "binary",
            sizeBytes: 256,
            truncated: true
          }
        ]
      },
      {
        id: "att-text",
        name: "notes.md",
        kind: "text",
        extension: "md",
        mimeType: "text/markdown",
        dataUrl: "",
        source: "clipboard",
        textContent: "# Hello"
      }
    ]);

    expect(prompt).toContain("Name: bundle.zip");
    expect(prompt).toContain("Gekuerzt: ja");
    expect(prompt).toContain("Fehler: Eine Datei war nicht UTF-8 lesbar.");
    expect(prompt).toContain("- src/app.ts [code] 128 Bytes inline");
    expect(prompt).toContain("- assets/logo.png [binary] 256 Bytes gekuerzt");
    expect(prompt).toContain("Kein inline lesbarer Inhalt verfuegbar.");
    expect(prompt).toContain("```markdown\n# Hello\n```");
    expect(prompt?.indexOf("Name: bundle.zip")).toBeLessThan(prompt?.indexOf("Name: notes.md") ?? 0);
  });

  it("merges attachments without duplicating the same source payload", () => {
    const existing: RuntimeChatAttachment[] = [
      {
        id: "att-1",
        name: "notes.md",
        kind: "text",
        extension: "md",
        mimeType: "text/markdown",
        dataUrl: "",
        source: "file_dialog",
        path: "C:/repo/notes.md",
        sizeBytes: 7
      }
    ];
    const incoming: RuntimeChatAttachment[] = [
      {
        id: "att-2",
        name: "notes.md",
        kind: "text",
        extension: "md",
        mimeType: "text/markdown",
        dataUrl: "",
        source: "file_dialog",
        path: "C:/repo/notes.md",
        sizeBytes: 7
      },
      {
        id: "att-3",
        name: "broken.pdf",
        kind: "document",
        extension: "pdf",
        mimeType: "application/pdf",
        dataUrl: "",
        source: "clipboard",
        sizeBytes: 12,
        error: "PDF defekt"
      }
    ];

    const result = mergeRuntimeChatAttachments(existing, incoming);
    expect(result.attachments).toHaveLength(2);
    expect(result.addedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.errorCount).toBe(1);
  });

  it("summarizes attachment import results for the composer note", () => {
    expect(
      summarizeAttachmentImport({
        addedCount: 2,
        duplicateCount: 1,
        errorCount: 1,
        sourceLabel: "hinzugefuegt"
      })
    ).toBe("2 Dateien hinzugefuegt · 1 Duplikat uebersprungen · 1 mit Fehlerhinweis.");

    expect(
      summarizeAttachmentImport({
        addedCount: 0,
        duplicateCount: 1,
        errorCount: 0,
        sourceLabel: "hinzugefuegt"
      })
    ).toBe("Keine neuen Dateien hinzugefuegt · 1 Duplikat uebersprungen.");
  });
});
