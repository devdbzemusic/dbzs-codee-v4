import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BootLogEntry } from "@dbzs/shared";
import type { BootOrchestrator } from "./bootOrchestrator.js";
import { startBootLogPersistence } from "./bootLogPersistence.js";

function fakeOrchestrator(): { orchestrator: BootOrchestrator; emit: (entry: BootLogEntry) => void } {
  let listener: ((entry: BootLogEntry) => void) | null = null;
  const orchestrator = {
    onLogEntry: vi.fn((cb: (entry: BootLogEntry) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    })
  } as unknown as BootOrchestrator;
  return { orchestrator, emit: (entry) => listener?.(entry) };
}

function waitForQueueDrain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

describe("startBootLogPersistence", () => {
  it("writes each log entry as a JSONL line under <userData>/logs/boot/<runId>.jsonl", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-boot-log-"));
    const { orchestrator, emit } = fakeOrchestrator();

    startBootLogPersistence({ orchestrator, userDataDir: root, runId: "run-123" });
    emit({ timestamp: 1000, level: "info", source: "desktop", phaseId: "desktop-process", event: "phase-success", message: "ok" });
    emit({ timestamp: 1001, level: "warn", source: "backend", phaseId: "database-init", event: "phase-warning", message: "slow" });

    await waitForQueueDrain();

    const filePath = path.join(root, "logs", "boot", "run-123.jsonl");
    const content = await readFile(filePath, "utf8");
    const lines = content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines).toHaveLength(2);
    expect(lines[0].message).toBe("ok");
    expect(lines[1].phaseId).toBe("database-init");
  });

  it("redacts secrets in the message and metadata before writing", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-boot-log-"));
    const { orchestrator, emit } = fakeOrchestrator();

    startBootLogPersistence({ orchestrator, userDataDir: root, runId: "run-456" });
    emit({
      timestamp: 1000,
      level: "error",
      source: "backend",
      phaseId: "backend-live",
      event: "phase-failed",
      message: "auth failed with sk-abcdefghijklmnop",
      metadata: { technicalDetail: "Bearer abcdef123456" }
    });

    await waitForQueueDrain();

    const filePath = path.join(root, "logs", "boot", "run-456.jsonl");
    const content = await readFile(filePath, "utf8");
    expect(content).not.toContain("sk-abcdefghijklmnop");
    expect(content).not.toContain("abcdef123456");
    expect(content).toContain("[REDACTED]");
  });
});
