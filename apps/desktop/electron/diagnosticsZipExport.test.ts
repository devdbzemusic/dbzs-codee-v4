import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildFullDiagnosticsZip, buildZipArchive } from "./diagnosticsZipExport";

/**
 * Minimal STORE-method ZIP reader, just enough to verify buildZipArchive()'s
 * output round-trips correctly. No general-purpose (no DEFLATE support) —
 * deliberately mirrors the writer's own scope.
 */
function readStoredZipEntries(zip: Buffer): Array<{ name: string; content: Buffer }> {
  const entries: Array<{ name: string; content: Buffer }> = [];
  let cursor = 0;
  while (cursor < zip.length) {
    const signature = zip.readUInt32LE(cursor);
    if (signature !== 0x04034b50) break;
    const compressionMethod = zip.readUInt16LE(cursor + 8);
    const crc = zip.readUInt32LE(cursor + 14);
    const compressedSize = zip.readUInt32LE(cursor + 18);
    const nameLength = zip.readUInt16LE(cursor + 26);
    const extraLength = zip.readUInt16LE(cursor + 28);
    const nameStart = cursor + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf-8");
    const content = zip.subarray(dataStart, dataStart + compressedSize);

    expect(compressionMethod).toBe(0);
    expect(zlib.crc32(content)).toBe(crc);

    entries.push({ name, content });
    cursor = dataStart + compressedSize;
  }
  return entries;
}

describe("buildZipArchive", () => {
  it("round-trips a single text entry", () => {
    const zip = buildZipArchive([{ name: "crash.log", content: "2026-07-31T00:00:00Z [test] hello\n" }]);
    const entries = readStoredZipEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("crash.log");
    expect(entries[0]?.content.toString("utf-8")).toBe("2026-07-31T00:00:00Z [test] hello\n");
  });

  it("round-trips multiple entries of mixed content types", () => {
    const settingsJson = JSON.stringify({ backendUrl: "http://127.0.0.1:8876" }, null, 2);
    const zip = buildZipArchive([
      { name: "crash.log", content: "line1\nline2\n" },
      { name: "settings.json", content: settingsJson },
      { name: "model-index.json", content: JSON.stringify({ models: [] }) },
      { name: "trace-events.json", content: JSON.stringify([{ type: "context_gap" }]) }
    ]);

    const entries = readStoredZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual([
      "crash.log",
      "settings.json",
      "model-index.json",
      "trace-events.json"
    ]);
    expect(entries[1]?.content.toString("utf-8")).toBe(settingsJson);
  });

  it("produces a valid end-of-central-directory record", () => {
    const zip = buildZipArchive([
      { name: "a.txt", content: "a" },
      { name: "b.txt", content: "b" }
    ]);
    const eocdSignature = zip.readUInt32LE(zip.length - 22);
    const totalRecords = zip.readUInt16LE(zip.length - 22 + 10);
    expect(eocdSignature).toBe(0x06054b50);
    expect(totalRecords).toBe(2);
  });

  it("handles binary (non-UTF-8-safe) content correctly via CRC", () => {
    const binaryContent = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f]);
    const zip = buildZipArchive([{ name: "binary.bin", content: binaryContent }]);
    const entries = readStoredZipEntries(zip);
    expect(entries[0]?.content.equals(binaryContent)).toBe(true);
  });

  it("handles an empty entry list without throwing", () => {
    const zip = buildZipArchive([]);
    expect(readStoredZipEntries(zip)).toEqual([]);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });
});

describe("buildFullDiagnosticsZip", () => {
  it("bundles crash.log, redacted settings, and the model index", () => {
    const zip = buildFullDiagnosticsZip({
      crashLog: "2026-07-31T00:00:00Z [uncaughtException] activeRuns=run-1 boom\n",
      settings: { backendUrl: "http://127.0.0.1:8876", apiKey: "sk-abcdefghijklmnop" },
      modelIndex: { models: [{ id: "coder.gguf" }] }
    });

    const entries = readStoredZipEntries(zip);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.content.toString("utf-8")]));

    expect(Object.keys(byName)).toEqual(["crash.log", "settings.json", "model-index.json"]);
    expect(byName["crash.log"]).toContain("activeRuns=run-1");
    expect(byName["settings.json"]).not.toContain("sk-abcdefghijklmnop");
    expect(byName["settings.json"]).toContain("[REDACTED]");
    expect(JSON.parse(byName["model-index.json"]!)).toEqual({ models: [{ id: "coder.gguf" }] });
  });

  it("substitutes a placeholder when crash.log doesn't exist yet", () => {
    const zip = buildFullDiagnosticsZip({ crashLog: null, settings: {}, modelIndex: {} });
    const entries = readStoredZipEntries(zip);
    const crashLogEntry = entries.find((e) => e.name === "crash.log");
    expect(crashLogEntry?.content.toString("utf-8")).toContain("existiert noch nicht");
  });

  it("includes slot-health.json when slotHealthStates is provided", () => {
    const zip = buildFullDiagnosticsZip({
      crashLog: null,
      settings: {},
      modelIndex: {},
      slotHealthStates: [{ slotId: "fast_gpu", restartAttempts: 1, budgetExhausted: false }]
    });

    const entries = readStoredZipEntries(zip);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.content.toString("utf-8")]));
    expect(Object.keys(byName)).toContain("slot-health.json");
    expect(JSON.parse(byName["slot-health.json"]!)).toEqual([
      { slotId: "fast_gpu", restartAttempts: 1, budgetExhausted: false }
    ]);
  });

  it("omits slot-health.json when slotHealthStates is not provided", () => {
    const zip = buildFullDiagnosticsZip({ crashLog: null, settings: {}, modelIndex: {} });
    const entries = readStoredZipEntries(zip);
    expect(entries.map((e) => e.name)).not.toContain("slot-health.json");
  });
});
