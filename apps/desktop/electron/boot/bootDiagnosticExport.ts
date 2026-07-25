import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dialog, type BrowserWindow } from "electron";
import type { BootDiagnosticExport, BootLogEntry, BootState } from "@dbzs/shared";

export interface BuildBootDiagnosticExportOptions {
  bootState: BootState;
  appVersion: string;
}

export function buildBootDiagnosticExport(options: BuildBootDiagnosticExportOptions): BootDiagnosticExport {
  const { bootState, appVersion } = options;
  const logs: BootLogEntry[] = bootState.phases.flatMap((phase) => phase.details);
  const warnings = bootState.phases.filter((p) => p.state === "warning").map((p) => `${p.id}: ${p.message}`);
  const errors = bootState.phases
    .filter((p) => p.state === "failed" || p.state === "blocked")
    .map((p) => `${p.id}: ${p.error?.message ?? p.message}`);

  const retryAttempts: Record<string, number> = {};
  const exitCodes: Record<string, number | null> = {};
  const stderr: Record<string, string> = {};
  for (const phase of bootState.phases) {
    retryAttempts[phase.id] = phase.retryCount;
    if (phase.error?.exitCode !== undefined) exitCodes[phase.id] = phase.error.exitCode ?? null;
    if (phase.error?.stderrTail) stderr[phase.id] = phase.error.stderrTail;
  }

  const residentModelPhase = bootState.phases.find((p) => p.id === "resident-model");

  return {
    runId: bootState.runId,
    appVersion,
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    startedAt: bootState.startedAt,
    finishedAt: bootState.finishedAt ?? null,
    phases: bootState.phases,
    logs,
    warnings,
    errors,
    backendPid: bootState.backendPid,
    backendPort: bootState.backendPort,
    runtime: bootState.activeRuntimeSlot,
    residentModelId: bootState.residentModelId,
    residentModelSlot: bootState.activeRuntimeSlot,
    retryAttempts,
    exitCodes,
    stderr,
    readinessResponses: residentModelPhase ? [] : []
  };
}

export async function exportBootDiagnosticsToFile(
  parentWindow: BrowserWindow | null,
  bootState: BootState,
  appVersion: string
): Promise<string> {
  const payload = buildBootDiagnosticExport({ bootState, appVersion });
  const defaultPath = path.join(os.tmpdir(), `dbzs-boot-diagnostics-${bootState.runId}.json`);

  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, { defaultPath, filters: [{ name: "JSON", extensions: ["json"] }] })
    : await dialog.showSaveDialog({ defaultPath, filters: [{ name: "JSON", extensions: ["json"] }] });

  const targetPath = result.canceled || !result.filePath ? defaultPath : result.filePath;
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), "utf-8");
  return targetPath;
}
