/*
 * DBZS – Division By Zeros
 * Datei: runtimeProcessSupervisor.ts
 * Bereich: Desktop Services / Runtime Process Supervisor
 *
 * Zweck:
 *   Erkennt einen unerwarteten Absturz eines Runtime-Slots (state: "error",
 *   nachdem er zuvor lief) und startet das zuletzt bekannte Modell automatisch
 *   neu — begrenzt durch ein Restart-Budget, um Neustart-Stuerme zu vermeiden.
 *
 * Warum:
 *   Bisher gab es nur On-Demand-Start/Stop und eine Idle-Eviction-Schleife
 *   (lazyRuntimePolicy.ts), aber keine Ueberwachung auf echte Abstuerze —
 *   `restartSlot()` existierte bereits, hatte aber keinen einzigen Aufrufer.
 */

import type { RuntimeSlotId } from "@dbzs/shared";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";

const SUPERVISED_SLOTS: RuntimeSlotId[] = ["fast_gpu", "quality_cpu", "utility", "orchestrator_cpu", "vision_gpu"];
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_BUDGET_WINDOW_MS = 5 * 60_000;

interface RestartBudgetEntry {
  attempts: number;
  windowStartedAt: number;
}

export interface SlotHealthState {
  slotId: RuntimeSlotId;
  lastKnownModelId: string | null;
  restartAttempts: number;
  budgetExhausted: boolean;
  lastRestartAt: number | null;
}

const lastKnownModelBySlot = new Map<RuntimeSlotId, string>();
const restartBudgetBySlot = new Map<RuntimeSlotId, RestartBudgetEntry>();
const lastRestartAtBySlot = new Map<RuntimeSlotId, number>();

let supervisorTimer: ReturnType<typeof setInterval> | null = null;
let supervisorStarted = false;

/** True (and records the attempt) if a restart may proceed; false if the budget is exhausted. */
function consumeRestartBudget(slotId: RuntimeSlotId, nowMs: number): boolean {
  const entry = restartBudgetBySlot.get(slotId);
  if (!entry || nowMs - entry.windowStartedAt > RESTART_BUDGET_WINDOW_MS) {
    restartBudgetBySlot.set(slotId, { attempts: 1, windowStartedAt: nowMs });
    return true;
  }
  if (entry.attempts >= MAX_RESTART_ATTEMPTS) {
    return false;
  }
  entry.attempts += 1;
  return true;
}

/** Clears the restart budget for a slot — e.g. after a deliberate manual restart. */
export function resetRestartBudget(slotId: RuntimeSlotId): void {
  restartBudgetBySlot.delete(slotId);
}

export function getSlotHealthState(slotId: RuntimeSlotId): SlotHealthState {
  const entry = restartBudgetBySlot.get(slotId);
  const nowMs = Date.now();
  const windowActive = Boolean(entry && nowMs - entry.windowStartedAt <= RESTART_BUDGET_WINDOW_MS);
  return {
    slotId,
    lastKnownModelId: lastKnownModelBySlot.get(slotId) ?? null,
    restartAttempts: windowActive ? entry!.attempts : 0,
    budgetExhausted: windowActive ? entry!.attempts >= MAX_RESTART_ATTEMPTS : false,
    lastRestartAt: lastRestartAtBySlot.get(slotId) ?? null
  };
}

export function getAllSlotHealthStates(): SlotHealthState[] {
  return SUPERVISED_SLOTS.map(getSlotHealthState);
}

/**
 * One supervision tick: fetches current slot statuses and restarts any slot
 * that crashed (state "error") from a previously-running state, respecting
 * the per-slot restart budget. A deliberate stop (idle-eviction, manual stop —
 * both produce state "stopped", never "error") is not touched here.
 */
export async function checkAndRecoverSlots(nowMs: number = Date.now()): Promise<void> {
  const statuses = await runtimeSlotManager.getAllSlotsStatus();
  const statusBySlot = new Map(statuses.map((status) => [status.slot_id, status] as const));

  for (const slotId of SUPERVISED_SLOTS) {
    const status = statusBySlot.get(slotId);
    if (!status) continue;

    if (status.state === "running" && status.model_id) {
      lastKnownModelBySlot.set(slotId, status.model_id);
      continue;
    }

    if (status.state === "stopped") {
      lastKnownModelBySlot.delete(slotId);
      continue;
    }

    if (status.state === "error") {
      const lastKnownModelId = lastKnownModelBySlot.get(slotId);
      if (!lastKnownModelId) continue;

      if (!consumeRestartBudget(slotId, nowMs)) {
        console.warn(
          `[RuntimeSupervisor] Restart-Budget fuer ${slotId} erschoepft (${MAX_RESTART_ATTEMPTS} Versuche in ` +
            `${RESTART_BUDGET_WINDOW_MS / 60_000} Minuten) — manuelle Intervention noetig.`
        );
        void runtimeSlotManager
          .recordSlotHealthEvent(slotId, "budget_exhausted", {
            modelId: lastKnownModelId,
            detail: `${MAX_RESTART_ATTEMPTS} Neustart-Versuche in ${RESTART_BUDGET_WINDOW_MS / 60_000} Minuten erschoepft.`
          })
          .catch(() => {});
        continue;
      }

      console.warn(`[RuntimeSupervisor] Slot ${slotId} abgestuerzt, versuche Neustart mit ${lastKnownModelId}.`);
      lastRestartAtBySlot.set(slotId, nowMs);
      void runtimeSlotManager.recordSlotHealthEvent(slotId, "crash", { modelId: lastKnownModelId }).catch(() => {});
      try {
        await runtimeSlotManager.restartSlot(slotId, lastKnownModelId);
        void runtimeSlotManager
          .recordSlotHealthEvent(slotId, "restart_attempt", {
            modelId: lastKnownModelId,
            detail: `Versuch ${getSlotHealthState(slotId).restartAttempts}/${MAX_RESTART_ATTEMPTS}`
          })
          .catch(() => {});
      } catch (error) {
        console.warn(`[RuntimeSupervisor] Neustart fuer ${slotId} fehlgeschlagen:`, error);
        void runtimeSlotManager
          .recordSlotHealthEvent(slotId, "restart_attempt", {
            modelId: lastKnownModelId,
            detail: `Fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`
          })
          .catch(() => {});
      }
    }
  }
}

export function isRuntimeProcessSupervisorActive(): boolean {
  return supervisorStarted && supervisorTimer !== null;
}

export function startRuntimeProcessSupervisor(intervalMs: number = 60_000): void {
  if (supervisorStarted || typeof window === "undefined") {
    return;
  }
  supervisorStarted = true;
  supervisorTimer = setInterval(() => {
    void checkAndRecoverSlots();
  }, intervalMs);
}

export function stopRuntimeProcessSupervisorForTests(): void {
  if (supervisorTimer) {
    clearInterval(supervisorTimer);
    supervisorTimer = null;
  }
  supervisorStarted = false;
  lastKnownModelBySlot.clear();
  restartBudgetBySlot.clear();
  lastRestartAtBySlot.clear();
}
