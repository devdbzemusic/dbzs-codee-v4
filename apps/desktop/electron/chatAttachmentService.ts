import { promises as fs } from "node:fs";
import path from "node:path";
import type { RuntimeChatAttachment } from "@dbzs/shared";

export interface ChatAttachmentPreparationSource {
  name: string;
  source: "clipboard" | "file_dialog";
  extension?: string;
  mimeType?: string;
  sizeBytes?: number;
  path?: string;
  dataBase64?: string;
}

interface BackendPreparedArchiveEntry {
  path: string;
  kind: RuntimeChatAttachment["kind"] | "binary";
  size_bytes?: number;
  included_inline?: boolean;
  truncated?: boolean;
}

interface BackendPreparedAttachment {
  id: string;
  name: string;
  kind: RuntimeChatAttachment["kind"];
  extension: string;
  mime_type: string;
  source: RuntimeChatAttachment["source"];
  size_bytes?: number;
  path?: string;
  data_url?: string | null;
  text_content?: string | null;
  derived_summary?: string | null;
  archive_entries?: BackendPreparedArchiveEntry[];
  truncated?: boolean;
  error?: string | null;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const TEXT_EXTENSIONS = new Set(["md", "json", "js", "ts", "tsx", "py", "txt"]);
const CODE_EXTENSIONS = new Set(["js", "ts", "tsx", "py"]);
const PREVIEW_TEXT_LIMIT = 12_000;

function attachmentId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeExtension(source: ChatAttachmentPreparationSource): string {
  const fromSource = source.extension?.replace(/^\./, "");
  const fromName = path.extname(source.name).replace(/^\./, "");
  return (fromSource || fromName).toLowerCase();
}

function mimeTypeForExtension(extension: string): string {
  const mapping: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    md: "text/markdown",
    json: "application/json",
    js: "text/javascript",
    ts: "text/typescript",
    tsx: "text/tsx",
    py: "text/x-python",
    txt: "text/plain",
    pdf: "application/pdf",
    zip: "application/zip"
  };
  return mapping[extension] ?? "application/octet-stream";
}

function decodeBase64(input: string): Buffer {
  return Buffer.from(input, "base64");
}

function toDataUrl(mimeType: string, buffer: Buffer): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function dataBase64FromDataUrl(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("attachment_preparation_failed:ungueltige_data_url");
  }
  return dataUrl.slice(commaIndex + 1);
}

function attachmentFromBackend(response: BackendPreparedAttachment): RuntimeChatAttachment {
  return {
    id: response.id,
    name: response.name,
    kind: response.kind,
    extension: response.extension,
    mimeType: response.mime_type,
    source: response.source,
    sizeBytes: response.size_bytes,
    path: response.path,
    dataUrl: response.data_url ?? "",
    textContent: response.text_content ?? undefined,
    derivedSummary: response.derived_summary ?? undefined,
    archiveEntries: response.archive_entries?.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      sizeBytes: entry.size_bytes,
      includedInline: entry.included_inline,
      truncated: entry.truncated
    })),
    truncated: response.truncated,
    error: response.error ?? undefined
  };
}

async function readSourceBuffer(source: ChatAttachmentPreparationSource): Promise<Buffer> {
  if (source.path) {
    return fs.readFile(source.path);
  }
  if (source.dataBase64) {
    return decodeBase64(source.dataBase64);
  }
  throw new Error(`attachment_preparation_failed:kein_inhalt:${source.name}`);
}

function buildLocalAttachmentError(
  source: ChatAttachmentPreparationSource,
  extension: string,
  mimeType: string,
  sizeBytes?: number,
  errorMessage?: string
): RuntimeChatAttachment {
  const kind = CODE_EXTENSIONS.has(extension) ? "code" : "text";
  return {
    id: attachmentId(),
    name: source.name,
    kind,
    extension,
    mimeType,
    source: source.source,
    sizeBytes,
    path: source.path,
    dataUrl: "",
    textContent: undefined,
    derivedSummary: "Datei konnte nicht inline gelesen werden",
    truncated: false,
    error: errorMessage ?? "Datei konnte nicht gelesen werden."
  };
}

async function prepareLocalAttachment(
  source: ChatAttachmentPreparationSource
): Promise<RuntimeChatAttachment> {
  const extension = normalizeExtension(source);
  const mimeType = source.mimeType || mimeTypeForExtension(extension);
  const buffer = await readSourceBuffer(source);

  if (IMAGE_EXTENSIONS.has(extension)) {
    return {
      id: attachmentId(),
      name: source.name,
      kind: "image",
      extension,
      mimeType,
      source: source.source,
      sizeBytes: source.sizeBytes ?? buffer.byteLength,
      path: source.path,
      dataUrl: toDataUrl(mimeType, buffer)
    };
  }

  const text = buffer.toString("utf-8");
  if (text.includes("\uFFFD")) {
    return buildLocalAttachmentError(
      source,
      extension,
      mimeType,
      source.sizeBytes ?? buffer.byteLength,
      "Datei ist nicht als UTF-8 lesbar."
    );
  }
  const truncated = text.length > PREVIEW_TEXT_LIMIT;
  const clipped = truncated ? text.slice(0, PREVIEW_TEXT_LIMIT) : text;
  return {
    id: attachmentId(),
    name: source.name,
    kind: CODE_EXTENSIONS.has(extension) ? "code" : "text",
    extension,
    mimeType,
    source: source.source,
    sizeBytes: source.sizeBytes ?? buffer.byteLength,
    path: source.path,
    dataUrl: "",
    textContent: clipped,
    derivedSummary: `${clipped.length} Zeichen eingebunden${truncated ? " (gekuerzt)" : ""}`,
    truncated
  };
}

export async function prepareChatAttachments(input: {
  requestBackend: <T>(pathname: string, init?: RequestInit) => Promise<T>;
  sources: ChatAttachmentPreparationSource[];
}): Promise<RuntimeChatAttachment[]> {
  const localSources: ChatAttachmentPreparationSource[] = [];
  const backendSources: ChatAttachmentPreparationSource[] = [];

  for (const source of input.sources) {
    const extension = normalizeExtension(source);
    if (IMAGE_EXTENSIONS.has(extension) || TEXT_EXTENSIONS.has(extension)) {
      localSources.push(source);
    } else {
      backendSources.push(source);
    }
  }

  const localAttachments = await Promise.all(
    localSources.map(async (source) => {
      try {
        return await prepareLocalAttachment(source);
      } catch (error) {
        const extension = normalizeExtension(source);
        return buildLocalAttachmentError(
          source,
          extension,
          source.mimeType || mimeTypeForExtension(extension),
          source.sizeBytes,
          error instanceof Error ? error.message : "Datei konnte nicht gelesen werden."
        );
      }
    })
  );
  if (backendSources.length === 0) {
    return localAttachments;
  }

  const backendPayload = backendSources.map((source) => ({
    name: source.name,
    source: source.source,
    extension: normalizeExtension(source),
    mime_type: source.mimeType || mimeTypeForExtension(normalizeExtension(source)),
    size_bytes: source.sizeBytes,
    path: source.path,
    data_base64: source.dataBase64
  }));
  const response = await input.requestBackend<{ attachments: BackendPreparedAttachment[] }>(
    "/runtime/prepare-chat-attachments",
    {
      method: "POST",
      body: JSON.stringify({ attachments: backendPayload })
    }
  );

  return [...localAttachments, ...response.attachments.map((attachment) => attachmentFromBackend(attachment))];
}

export function clipboardSourceFromDataUrl(input: {
  name: string;
  mimeType: string;
  sizeBytes?: number;
  dataUrl: string;
}): ChatAttachmentPreparationSource {
  return {
    name: input.name,
    source: "clipboard",
    extension: path.extname(input.name).replace(/^\./, "").toLowerCase(),
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    dataBase64: dataBase64FromDataUrl(input.dataUrl)
  };
}
