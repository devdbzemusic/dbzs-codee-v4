/*
 * DBZS - Division By Zeros
 * Datei: runtimeProbe.ts
 * Bereich: runtime-chat tuning lab / runtime
 *
 * Zweck:
 *   Absichtlich unvollstaendige Runtime-Diagnostik fuer Debug-/Recovery-Tests.
 */

import fs from "node:fs";
import path from "node:path";

export interface RuntimeProbeConfig {
  runtimeExecutable: string;
  primaryModelPath: string;
  fallbackModelPath?: string;
}

export interface RuntimeProbeResult {
  status: "ready" | "failed" | "degraded";
  message: string;
  diagnostics: string[];
}

export function probeRuntime(workspaceRoot: string, config: RuntimeProbeConfig): RuntimeProbeResult {
  const runtimePath = path.resolve(workspaceRoot, config.runtimeExecutable);
  const modelPath = path.resolve(workspaceRoot, config.primaryModelPath);

  if (!fs.existsSync(runtimePath) || !fs.existsSync(modelPath)) {
    return {
      status: "failed",
      message: "Runtime probe failed.",
      diagnostics: []
    };
  }

  if (config.fallbackModelPath && !fs.existsSync(path.resolve(workspaceRoot, config.fallbackModelPath))) {
    return {
      status: "degraded",
      message: "Fallback missing.",
      diagnostics: ["fallback_model_missing"]
    };
  }

  return {
    status: "ready",
    message: "Runtime ready.",
    diagnostics: ["warmup_not_checked"]
  };
}
