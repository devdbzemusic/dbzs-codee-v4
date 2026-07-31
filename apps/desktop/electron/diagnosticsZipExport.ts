/*
 * DBZS – Division By Zeros
 * Datei: diagnosticsZipExport.ts
 * Bereich: Electron Main / Diagnostics
 *
 * Zweck:
 *   Buendelt crash.log, redigierte Settings, Modellindex-Snapshot und die
 *   letzten Trace-Events in ein einzelnes ZIP fuer den Nutzer-Export.
 *
 * Warum:
 *   Der bestehende Boot-Diagnose-Export (bootDiagnosticExport.ts) deckt nur
 *   den Boot-Vorgang als einzelne JSON-Datei ab. Ein Support-taugliches
 *   Rundum-Diagnosepaket braucht mehrere Quellen gebuendelt.
 *
 * Bewusst ohne neues npm-Package: ein minimaler ZIP-Writer (STORE-Methode,
 * unkomprimiert) ueber Node's eingebautes `zlib.crc32` reicht fuer eine
 * Handvoll kleiner Text-/JSON-Dateien, ohne eine neue Abhaengigkeit
 * einzufuehren.
 */

import zlib from "node:zlib";
import { redactSecretsDeep } from "./boot/secretRedaction.js";

export interface ZipEntryInput {
  name: string;
  content: string | Buffer;
}

export interface FullDiagnosticsZipInput {
  /** Raw crash.log content, or null if the file doesn't exist yet. */
  crashLog: string | null;
  /** Current app settings — deep-redacted before being written. */
  settings: unknown;
  /** Model index snapshot as returned by the backend. */
  modelIndex: unknown;
  /**
   * Runtime-process-supervisor health state per slot (runtimeProcessSupervisor.ts's
   * getAllSlotHealthStates()) — lives in the renderer, so the caller must fetch it
   * there and pass it through the IPC call; the main process can't reach into
   * renderer-side in-memory state directly.
   */
  slotHealthStates?: unknown;
}

/**
 * Assembles the diagnostic sources into ZIP entries. Per-run trace events are
 * deliberately not included here — they need a specific run id to select,
 * which this global export has no context for; a future per-run export can
 * add them alongside this bundle.
 */
export function buildFullDiagnosticsZip(input: FullDiagnosticsZipInput): Buffer {
  const entries: ZipEntryInput[] = [
    { name: "crash.log", content: input.crashLog ?? "(crash.log existiert noch nicht)" },
    { name: "settings.json", content: JSON.stringify(redactSecretsDeep(input.settings), null, 2) },
    { name: "model-index.json", content: JSON.stringify(input.modelIndex, null, 2) }
  ];
  if (input.slotHealthStates !== undefined) {
    entries.push({ name: "slot-health.json", content: JSON.stringify(input.slotHealthStates, null, 2) });
  }
  return buildZipArchive(entries);
}

interface DosDateTime {
  time: number;
  dateValue: number;
}

function toDosDateTime(date: Date): DosDateTime {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dateValue = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, dateValue };
}

/**
 * Builds a minimal, valid ZIP archive (STORE method — no compression) from
 * in-memory entries. Sufficient for a handful of small diagnostic text/JSON
 * files; not intended as a general-purpose archiver.
 */
export function buildZipArchive(entries: ZipEntryInput[], now: Date = new Date()): Buffer {
  const { time, dateValue } = toDosDateTime(now);
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf-8");
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const crc = zlib.crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(0, 8); // compression method: store
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(dateValue, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18); // compressed size
    localHeader.writeUInt32LE(data.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length
    localChunks.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central directory file header signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed to extract
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(dateValue, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header
    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const centralDirectoryOffset = offset;

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  endRecord.writeUInt16LE(0, 4); // number of this disk
  endRecord.writeUInt16LE(0, 6); // disk where central directory starts
  endRecord.writeUInt16LE(entries.length, 8); // records on this disk
  endRecord.writeUInt16LE(entries.length, 10); // total records
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(centralDirectoryOffset, 16);
  endRecord.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, centralDirectory, endRecord]);
}
