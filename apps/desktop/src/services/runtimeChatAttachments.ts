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

function attachmentIdentity(attachment: RuntimeChatAttachment): string {
  return [
    attachment.source,
    attachment.path?.toLowerCase() ?? "",
    attachment.name.toLowerCase(),
    attachment.kind,
    attachment.extension.toLowerCase(),
    attachment.sizeBytes ?? ""
  ].join("|");
}

export function mergeRuntimeChatAttachments(
  current: RuntimeChatAttachment[],
  incoming: RuntimeChatAttachment[]
): {
  attachments: RuntimeChatAttachment[];
  addedCount: number;
  duplicateCount: number;
  errorCount: number;
} {
  const seen = new Set(current.map((attachment) => attachmentIdentity(attachment)));
  const next = [...current];
  let addedCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;

  for (const attachment of incoming) {
    const identity = attachmentIdentity(attachment);
    if (seen.has(identity)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(identity);
    next.push(attachment);
    addedCount += 1;
    if (attachment.error) {
      errorCount += 1;
    }
  }

  return {
    attachments: next,
    addedCount,
    duplicateCount,
    errorCount
  };
}

export function summarizeAttachmentImport(result: {
  addedCount: number;
  duplicateCount: number;
  errorCount: number;
  sourceLabel: string;
}): string {
  const parts: string[] = [];
  if (result.addedCount > 0) {
    parts.push(`${result.addedCount} Datei${result.addedCount === 1 ? "" : "en"} ${result.sourceLabel}`);
  } else if (result.duplicateCount > 0) {
    parts.push("Keine neuen Dateien hinzugefuegt");
  } else {
    parts.push(`0 Dateien ${result.sourceLabel}`);
  }
  if (result.duplicateCount > 0) {
    parts.push(`${result.duplicateCount} Duplikat${result.duplicateCount === 1 ? "" : "e"} uebersprungen`);
  }
  if (result.errorCount > 0) {
    parts.push(`${result.errorCount} mit Fehlerhinweis`);
  }
  return `${parts.join(" · ")}.`;
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
