/*
 * DBZS – Division By Zeros
 * Datei: lazyRuntimePolicy.ts
 * Bereich: Desktop Services / Lazy Runtime
 *
 * Zweck:
 *   Hilfen für On-Demand-Arbeitsmodelle und Idle-Eviction.
 */

import type { RuntimeSlotId, RuntimeStatus } from "@dbzs/shared";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";
import { useSettingsStore } from "@/stores/settingsStore";

const WORK_SLOTS: RuntimeSlotId[] = ["fast_gpu", "quality_cpu", "utility"];

let lastWorkModelActivityAt = Date.now();
let idleWatcherStarted = false;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let activeRunGuard: (() => boolean) | null = null;

export function looksLikeOrchestratorModel(status: Pick<RuntimeStatus, "model_id" | "model_name"> | null | undefined): boolean {
  if (!status) return false;
  const key = `${status.model_id ?? ""} ${status.model_name ?? ""}`.toLowerCase();
  return key.includes("functiongemma") || key.includes("orchestrator");
}

/** True when a non-orchestrator work model is currently running. */
export function isWorkModelLoaded(status: RuntimeStatus | null | undefined): boolean {
  if (!status || status.state !== "running") return false;
  return !looksLikeOrchestratorModel(status);
}

export function touchWorkModelActivity(): void {
  lastWorkModelActivityAt = Date.now();
}

export function getLastWorkModelActivityAt(): number {
  return lastWorkModelActivityAt;
}

export function isIdleUnloadWatcherActive(): boolean {
  return idleWatcherStarted && idleTimer !== null;
}

export function isIdleUnloadBlockedByActiveRun(): boolean {
  return Boolean(activeRunGuard?.());
}

export interface IdleUnloadDiagnostics {
  enabled: boolean;
  configuredMinutes: number;
  watcherActive: boolean;
  lastActivityAt: number;
  lastActivityIso: string;
  idleMs: number;
  nextUnloadAt: number | null;
  nextUnloadIso: string | null;
  msUntilUnload: number | null;
  blockedByActiveRun: boolean;
  effectiveStatus: "disabled" | "blocked" | "waiting" | "due";
}

export function getIdleUnloadDiagnostics(
  nowMs: number = Date.now(),
): IdleUnloadDiagnostics {
  const configuredMinutes =
    useSettingsStore.getState().settings.idleUnloadWorkModelsMinutes ?? 10;
  const enabled = configuredMinutes > 0;
  const lastActivityAt = lastWorkModelActivityAt;
  const idleMs = Math.max(0, nowMs - lastActivityAt);
  const blockedByActiveRun = isIdleUnloadBlockedByActiveRun();
  const watcherActive = isIdleUnloadWatcherActive();

  if (!enabled) {
    return {
      enabled: false,
      configuredMinutes,
      watcherActive,
      lastActivityAt,
      lastActivityIso: new Date(lastActivityAt).toISOString(),
      idleMs,
      nextUnloadAt: null,
      nextUnloadIso: null,
      msUntilUnload: null,
      blockedByActiveRun,
      effectiveStatus: "disabled",
    };
  }

  const nextUnloadAt = lastActivityAt + configuredMinutes * 60_000;
  const msUntilUnload = nextUnloadAt - nowMs;
  const due = msUntilUnload <= 0;

  let effectiveStatus: IdleUnloadDiagnostics["effectiveStatus"] = "waiting";
  if (blockedByActiveRun) {
    effectiveStatus = "blocked";
  } else if (due) {
    effectiveStatus = "due";
  }

  return {
    enabled: true,
    configuredMinutes,
    watcherActive,
    lastActivityAt,
    lastActivityIso: new Date(lastActivityAt).toISOString(),
    idleMs,
    nextUnloadAt,
    nextUnloadIso: new Date(nextUnloadAt).toISOString(),
    msUntilUnload,
    blockedByActiveRun,
    effectiveStatus,
  };
}

export function registerIdleEvictionActiveRunGuard(guard: () => boolean): void {
  activeRunGuard = guard;
}

export function startWorkModelIdleWatcher(): void {
  if (idleWatcherStarted || typeof window === "undefined") {
    return;
  }
  idleWatcherStarted = true;
  idleTimer = setInterval(() => {
    void maybeEvictIdleWorkModels();
  }, 60_000);
}

export function stopWorkModelIdleWatcherForTests(): void {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  idleWatcherStarted = false;
  activeRunGuard = null;
}

async function maybeEvictIdleWorkModels(): Promise<void> {
  const minutes = useSettingsStore.getState().settings.idleUnloadWorkModelsMinutes ?? 10;
  if (minutes <= 0) {
    return;
  }
  if (activeRunGuard?.()) {
    return;
  }
  const idleMs = minutes * 60_000;
  if (Date.now() - lastWorkModelActivityAt < idleMs) {
    return;
  }

  for (const slotId of WORK_SLOTS) {
    try {
      const status = await runtimeSlotManager.getSlotStatus(slotId);
      if (!status || status.state !== "running") continue;
      if (looksLikeOrchestratorModel(status)) continue;
      console.info(`[LazyRuntime] Idle-Unload: stoppe ${slotId} (${status.model_id ?? "unknown"})`);
      await runtimeSlotManager.stopSlot(slotId);
    } catch (error) {
      console.warn(`[LazyRuntime] Idle-Unload fehlgeschlagen für ${slotId}:`, error);
    }
  }
}

export function formatLazyRuntimeStatusLabel(input: {
  backendReachable: boolean;
  workModelLoaded: boolean;
  lastRoutingModelName?: string | null;
  lastRoutingModelId?: string | null;
  lastRoutingAgentLabel?: string | null;
  lastRoutingReasons?: string[] | null;
  activeRunLoading?: boolean;
  loadingRoleHint?: string | null;
}): string {
  if (!input.backendReachable) {
    return "Runtime offline";
  }
  if (input.activeRunLoading) {
    return input.loadingRoleHint ?? "Arbeitsmodell wird bei Bedarf geladen …";
  }
  if (input.workModelLoaded && (input.lastRoutingModelName || input.lastRoutingModelId)) {
    const reason = input.lastRoutingReasons?.[0];
    const model = input.lastRoutingModelName ?? input.lastRoutingModelId;
    const agent = input.lastRoutingAgentLabel ? `${input.lastRoutingAgentLabel} · ` : "";
    return reason ? `${agent}Run-Modell: ${model} · ${reason}` : `${agent}Run-Modell: ${model}`;
  }
  return "Router: bereit · Arbeitsmodell: nicht geladen";
}
