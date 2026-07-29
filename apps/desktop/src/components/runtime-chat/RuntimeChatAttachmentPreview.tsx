import type { RuntimeChatAttachment } from "@dbzs/shared";

function formatAttachmentSize(sizeBytes?: number): string | null {
  if (typeof sizeBytes !== "number" || Number.isNaN(sizeBytes) || sizeBytes <= 0) {
    return null;
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildArchiveSummary(attachment: RuntimeChatAttachment): string | null {
  if (!attachment.archiveEntries?.length) {
    return null;
  }

  const inlineCount = attachment.archiveEntries.filter((entry) => entry.includedInline).length;
  const binaryCount = attachment.archiveEntries.filter((entry) => entry.kind === "binary").length;
  const truncatedCount = attachment.archiveEntries.filter((entry) => entry.truncated).length;

  return [
    `${attachment.archiveEntries.length} Eintraege`,
    inlineCount > 0 ? `${inlineCount} inline` : null,
    binaryCount > 0 ? `${binaryCount} binaer` : null,
    truncatedCount > 0 ? `${truncatedCount} gekuerzt` : null
  ]
    .filter(Boolean)
    .join(" - ");
}

function previewTextForAttachment(attachment: RuntimeChatAttachment, maxChars: number): string | null {
  if (!attachment.textContent?.trim()) {
    return null;
  }
  return attachment.textContent.length > maxChars
    ? `${attachment.textContent.slice(0, maxChars)}...`
    : attachment.textContent;
}

export function RuntimeChatAttachmentPreview({
  attachment,
  maxPreviewChars = 400,
  removeLabel,
  onRemove
}: {
  attachment: RuntimeChatAttachment;
  maxPreviewChars?: number;
  removeLabel?: string;
  onRemove?: () => void;
}) {
  const textContent = attachment.textContent ?? "";
  const previewText = previewTextForAttachment(attachment, maxPreviewChars);
  const archiveSummary = buildArchiveSummary(attachment);
  const sizeLabel = formatAttachmentSize(attachment.sizeBytes);
  const hasPreviewClipHint = textContent.length > maxPreviewChars;

  return (
    <div className="rounded border border-dbzs-border bg-dbzs-bg/70 p-2">
      {attachment.kind === "image" && attachment.dataUrl ? (
        <div className="mb-2 aspect-video overflow-hidden rounded border border-dbzs-border bg-black/20">
          <img
            alt={attachment.name}
            className="h-full w-full object-cover"
            src={attachment.dataUrl}
          />
        </div>
      ) : (
        <div className="mb-2 rounded border border-dbzs-border bg-dbzs-panelSoft p-2 text-[10px] text-dbzs-textSoft">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium text-dbzs-text">
              {attachment.kind.toUpperCase()} - .{attachment.extension || "-"}
            </span>
            {attachment.truncated ? (
              <span className="rounded border border-dbzs-warning/40 bg-dbzs-warning/10 px-1 py-0.5 text-[9px] text-dbzs-warning">
                Gekuerzt
              </span>
            ) : null}
            {attachment.error ? (
              <span className="rounded border border-dbzs-red/40 bg-dbzs-red/10 px-1 py-0.5 text-[9px] text-dbzs-red">
                Fehler
              </span>
            ) : null}
          </div>
          {attachment.derivedSummary ? (
            <div className="mt-1 text-[9px] text-dbzs-muted">{attachment.derivedSummary}</div>
          ) : null}
          {archiveSummary ? (
            <div className="mt-1 text-[9px] text-dbzs-muted">{archiveSummary}</div>
          ) : null}
          {attachment.error ? (
            <div className="mt-2 rounded border border-dbzs-red/30 bg-dbzs-red/5 px-2 py-1 text-[9px] text-dbzs-red">
              {attachment.error}
            </div>
          ) : null}
          {previewText ? (
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[9px] leading-4 text-dbzs-muted">
              {previewText}
            </pre>
          ) : null}
          {hasPreviewClipHint ? (
            <div className="mt-1 text-[9px] text-dbzs-muted">
              Vorschau gekuerzt fuer die Kartenansicht.
            </div>
          ) : null}
        </div>
      )}
      <div className="flex items-start justify-between gap-2 text-[10px]">
        <div className="min-w-0">
          <div className="truncate text-dbzs-text">{attachment.name}</div>
          <div className="text-dbzs-muted">
            {attachment.source === "clipboard" ? "Zwischenablage" : "Datei"}
            {sizeLabel ? ` - ${sizeLabel}` : ""}
          </div>
        </div>
        {onRemove ? (
          <button
            className="rounded border border-dbzs-border px-1.5 py-0.5 text-dbzs-muted hover:border-dbzs-red/40 hover:text-dbzs-red"
            onClick={onRemove}
            type="button"
          >
            {removeLabel ?? "Entfernen"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
