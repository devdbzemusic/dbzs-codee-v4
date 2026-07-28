import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareChatAttachments } from "./chatAttachmentService.js";

describe("chatAttachmentService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a visible error attachment when a local text file is not UTF-8 readable", async () => {
    const tempFile = path.join(os.tmpdir(), `dbzs-chat-attachment-${Date.now()}.txt`);
    await fs.writeFile(tempFile, Buffer.from([0xff, 0xfe, 0xfd, 0xfc]));

    try {
      const attachments = await prepareChatAttachments({
        requestBackend: vi.fn(),
        sources: [
          {
            name: "broken.txt",
            source: "file_dialog",
            extension: "txt",
            mimeType: "text/plain",
            path: tempFile
          }
        ]
      });

      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toMatchObject({
        name: "broken.txt",
        kind: "text",
        error: "Datei ist nicht als UTF-8 lesbar.",
        derivedSummary: "Datei konnte nicht inline gelesen werden"
      });
    } finally {
      await fs.unlink(tempFile).catch(() => undefined);
    }
  });

  it("keeps successful local attachments when another local attachment cannot be read", async () => {
    const requestBackend = vi.fn();
    const attachments = await prepareChatAttachments({
      requestBackend,
      sources: [
        {
          name: "notes.md",
          source: "clipboard",
          extension: "md",
          mimeType: "text/markdown",
          dataBase64: Buffer.from("# Notes", "utf8").toString("base64")
        },
        {
          name: "missing.txt",
          source: "file_dialog",
          extension: "txt",
          mimeType: "text/plain",
          path: path.join(os.tmpdir(), "dbzs-missing-chat-attachment.txt")
        }
      ]
    });

    expect(requestBackend).not.toHaveBeenCalled();
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      name: "notes.md",
      kind: "text",
      textContent: "# Notes"
    });
    expect(attachments[1]).toMatchObject({
      name: "missing.txt",
      kind: "text",
      derivedSummary: "Datei konnte nicht inline gelesen werden"
    });
    expect(attachments[1].error).toContain("ENOENT");
  });
});
