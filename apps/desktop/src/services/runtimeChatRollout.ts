export type CanaryStage = "legacy-0" | "canary-5" | "canary-25" | "canary-50" | "canary-100";

export function isRunInCanary(runId: string, canaryPercent: number): boolean {
  const bounded = Math.max(0, Math.min(100, canaryPercent));
  if (bounded <= 0) return false;
  if (bounded >= 100) return true;

  let hash = 0;
  for (let i = 0; i < runId.length; i += 1) {
    hash = (hash * 31 + runId.charCodeAt(i)) >>> 0;
  }
  return (hash % 100) < bounded;
}

export function canaryStageLabel(canaryPercent: number): CanaryStage {
  if (canaryPercent <= 0) return "legacy-0";
  if (canaryPercent <= 5) return "canary-5";
  if (canaryPercent <= 25) return "canary-25";
  if (canaryPercent <= 50) return "canary-50";
  return "canary-100";
}

export function shouldStopForShadowMismatch(options: {
  shadowMode: boolean;
  stopOnShadowMismatch: boolean;
  shadowMatch: boolean | null;
}): boolean {
  if (!options.shadowMode || !options.stopOnShadowMismatch) {
    return false;
  }
  return options.shadowMatch === false;
}
