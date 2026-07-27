import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileAtomic } from "./atomicFileWrite";

const roots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-atomic-write-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("writeFileAtomic", () => {
  it("replaces an existing file on disk", async () => {
    const root = tempDir();
    const target = path.join(root, "project-memory.json");
    writeFileSync(target, "{\"old\":true}\n", "utf8");

    await writeFileAtomic(target, "{\"new\":true}\n");

    expect(readFileSync(target, "utf8")).toBe("{\"new\":true}\n");
  });

  it("retries transient Windows rename failures", async () => {
    const root = tempDir();
    const target = path.join(root, "project-memory.json");
    const rename = vi.fn(async (from: string, to: string) => {
      if (rename.mock.calls.length === 1) {
        const error = new Error("locked") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      await import("node:fs/promises").then(({ rename: realRename }) => realRename(from, to));
    });
    const sleep = vi.fn(async () => undefined);

    await writeFileAtomic(target, "{\"ok\":true}\n", {
      fsImpl: {
        ...await import("node:fs/promises"),
        rename
      },
      sleep,
      retries: 2,
      retryDelayMs: 1
    });

    expect(rename).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(readFileSync(target, "utf8")).toBe("{\"ok\":true}\n");
  });
});
