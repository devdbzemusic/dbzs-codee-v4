import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { BootLogEntry } from "@dbzs/shared";
import type { BootOrchestrator } from "./bootOrchestrator.js";
import { redactSecrets, redactSecretsDeep } from "./secretRedaction.js";

export interface BootLogPersistenceDeps {
  orchestrator: BootOrchestrator;
  userDataDir: string;
  runId: string;
}

/**
 * Persists every boot log entry to `<userData>/logs/boot/<runId>.jsonl` as
 * an external subscriber (BootOrchestrator.onLogEntry) -- kept outside the
 * orchestrator itself, which is deliberately I/O-free by design (see its
 * own docstring: "Contains no I/O of its own", which keeps its scheduling/
 * timeout/retry logic unit-testable with fakes, no real filesystem needed).
 * Writes are serialized through a simple promise queue so bursty log volume
 * (e.g. the backend's /boot/stream SSE feed) can never interleave lines or
 * race on the same file handle. Every entry is redacted before it touches
 * disk (repair spec §18) -- this file is meant to be shareable for
 * troubleshooting.
 */
export function startBootLogPersistence(deps: BootLogPersistenceDeps): () => void {
  const filePath = path.join(deps.userDataDir, "logs", "boot", `${deps.runId}.jsonl`);
  let writeQueue: Promise<void> = mkdir(path.dirname(filePath), { recursive: true })
    .then(() => undefined)
    .catch(() => undefined);

  const unsubscribe = deps.orchestrator.onLogEntry((entry: BootLogEntry) => {
    const redactedEntry: BootLogEntry = {
      ...entry,
      message: redactSecrets(entry.message),
      metadata: entry.metadata ? redactSecretsDeep(entry.metadata) : entry.metadata
    };
    const line = `${JSON.stringify(redactedEntry)}\n`;
    writeQueue = writeQueue.then(() => appendFile(filePath, line, "utf8")).catch(() => undefined);
  });

  return unsubscribe;
}
