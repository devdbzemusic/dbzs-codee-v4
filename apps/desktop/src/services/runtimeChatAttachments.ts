import type { RuntimeChatAttachment } from "@dbzs/shared";

const ATTACHMENT_FENCE_LANGUAGE: Record<string, string> = {
  md: "markdown",
  json: "json",
  js: "javascript",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  txt: "text"
};

export function attachmentRequiresVision(attachments: RuntimeChatAttachment[]): boolean {
  return attachments.some((attachment) => attachment.kind === "image");
}

export function defaultPromptForAttachments(attachments: RuntimeChatAttachment[]): string {
  return attachmentRequiresVision(attachments)
    ? "Bitte analysiere die angehaengten Dateien und Bilder."
    : "Bitte analysiere die angehaengten Dateien.";
}

export function buildRuntimeChatAttachmentPrompt(
  attachments: RuntimeChatAttachment[]
): string | null {
  if (attachments.length === 0) {
    return null;
  }

  const sections = attachments.map((attachment) => {
    const header = [
      "[ATTACHMENT]",
      `Name: ${attachment.name}`,
      `Typ: ${attachment.kind}`,
      `Extension: ${attachment.extension || "-"}`,
      `Quelle: ${attachment.source}`,
      typeof attachment.sizeBytes === "number" ? `Groesse: ${attachment.sizeBytes} Bytes` : null,
      attachment.truncated ? "Gekuerzt: ja" : null,
      attachment.derivedSummary ? `Hinweis: ${attachment.derivedSummary}` : null,
      attachment.error ? `Fehler: ${attachment.error}` : null
    ].filter(Boolean).join("\n");

    const bodyParts: string[] = [];
    if (attachment.textContent?.trim()) {
      const language = ATTACHMENT_FENCE_LANGUAGE[attachment.extension] ?? "text";
      bodyParts.push(`Inhalt:\n\`\`\`${language}\n${attachment.textContent}\n\`\`\``);
    }
    if (attachment.archiveEntries?.length) {
      bodyParts.push(
        [
          "Archiv-Inventar:",
          ...attachment.archiveEntries.map((entry) =>
            `- ${entry.path} [${entry.kind}]${typeof entry.sizeBytes === "number" ? ` ${entry.sizeBytes} Bytes` : ""}${entry.includedInline ? " inline" : ""}${entry.truncated ? " gekuerzt" : ""}`
          )
        ].join("\n")
      );
    }
    if (!attachment.textContent?.trim()) {
      bodyParts.push("Kein inline lesbarer Inhalt verfuegbar.");
    }

    return [header, ...bodyParts].join("\n\n");
  });

  return sections.join("\n\n");
}
