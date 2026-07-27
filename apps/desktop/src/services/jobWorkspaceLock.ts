/**
 * DBZS – Division By Zeros
 * Datei: jobWorkspaceLock.ts
 * Bereich: Desktop Services / Job Workspace Lock Integration
 *
 * Zweck:
 *   Integriert Workspace-Locking in den Job-Claim-Prozess.
 *   Stellt sicher, dass nur ein Job pro Workspace gleichzeitig läuft.
 *
 * Warum:
 *   Der bestehende Job-Spooler hat kein Workspace-aware Locking.
 *   Diese Schicht verhindert parallele Jobs im gleichen Workspace.
 *
 * Wozu:
 *   Ermöglicht sichere Job-Ausführung ohne Dateikonflikte.
 */

import type { JobRecord, JobClaimRequest, JobClaimResponse } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { workspaceLockService } from "@/services/workspaceLockService";

/**
 * Ergebnis eines Claim-Versuchs mit Lock-Prüfung.
 */
export interface ClaimWithLockResult {
  /** Ob ein Job erfolgreich geclaimed wurde */
  claimed: boolean;
  /** Der geclaimed Job oder null */
  job: JobRecord | null;
  /** Grund falls nicht geclaimed */
  reason?: "no_jobs_available" | "workspace_locked" | "error";
  /** Lock-Informationen falls Workspace gesperrt */
  lockInfo?: {
    workspaceRoot: string;
    lockedByJobId: string;
    lockedByWorkerId: string;
    lockedAt: string;
  };
}

/**
 * Claimt den nächsten verfügbaren Job mit Workspace-Lock-Prüfung.
 *
 * Ablauf:
 * 1. Nächsten Job vom Spooler anfordern
 * 2. Workspace aus Job-Metadaten extrahieren
 * 3. Prüfen ob Workspace bereits gesperrt ist
 * 4. Falls frei: Lock erwerben und Job claimen
 * 5. Falls gesperrt: Job nicht claimen, zurück zur Queue
 *
 * @param workerId - Die ID des Workers der claimen möchte
 * @param supportedRoles - Optionale Liste unterstützter Rollen
 * @param leaseSeconds - Lease-Dauer für den Job
 * @returns Ergebnis des Claim-Versuchs
 */
export async function claimNextJobWithLock(
  workerId: string,
  supportedRoles?: string[],
  leaseSeconds: number = 1800
): Promise<ClaimWithLockResult> {
  try {
    // Schritt 1: Nächsten Job vom Spooler anfordern
    const claimRequest: JobClaimRequest = {
      worker_id: workerId,
      supported_roles: supportedRoles,
      lease_seconds: leaseSeconds
    };

    const claimResponse: JobClaimResponse = await backendClient.claimNextJob(claimRequest);

    if (!claimResponse.job) {
      return {
        claimed: false,
        reason: "no_jobs_available",
        job: null
      };
    }

    const job = claimResponse.job;

    // Schritt 2: Workspace aus Job-Metadaten extrahieren
    const workspaceRoot = extractWorkspaceFromJob(job);

    if (!workspaceRoot) {
      // Kein Workspace bekannt – Job kann direkt geclaimed werden
      return {
        claimed: true,
        job
      };
    }

    // Schritt 3: Prüfen ob Workspace bereits gesperrt ist
    const existingLock = workspaceLockService.getLock(workspaceRoot);

    if (existingLock) {
      // Workspace ist gesperrt
      // Job zurückgeben (nicht als "claimed" markieren, damit er in der Queue bleibt)
      // Hinweis: Der Job wurde bereits vom Spooler als "claimed" markiert
      // Wir müssen ihn ggf. zurück zur Queue geben

      console.log(
        `[JobWorkspaceLock] Workspace "${workspaceRoot}" ist bereits gesperrt durch Job ${existingLock.jobId}`
      );

      // Job zurück zur Queue geben (requeue)
      await requeueJob(job.id, workerId, "Workspace locked by another job");

      return {
        claimed: false,
        reason: "workspace_locked",
        job: null,
        lockInfo: {
          workspaceRoot: existingLock.workspaceRoot,
          lockedByJobId: existingLock.jobId,
          lockedByWorkerId: existingLock.workerId,
          lockedAt: existingLock.lockedAt
        }
      };
    }

    // Schritt 4: Lock erwerben
    const lockResult = workspaceLockService.acquireLock(
      workspaceRoot,
      job,
      workerId,
      leaseSeconds
    );

    if (!lockResult.acquired) {
      // Lock konnte nicht erworben werden (Race Condition)
      await requeueJob(job.id, workerId, "Failed to acquire workspace lock");

      return {
        claimed: false,
        reason: "workspace_locked",
        job: null,
        lockInfo: lockResult.existingLock
          ? {
              workspaceRoot: lockResult.existingLock.workspaceRoot,
              lockedByJobId: lockResult.existingLock.jobId,
              lockedByWorkerId: lockResult.existingLock.workerId,
              lockedAt: lockResult.existingLock.lockedAt
            }
          : undefined
      };
    }

    // Schritt 5: Job erfolgreich geclaimed mit Lock
    console.log(
      `[JobWorkspaceLock] Job ${job.id} geclaimed mit Lock für Workspace "${workspaceRoot}"`
    );

    return {
      claimed: true,
      job
    };
  } catch (error) {
    console.error("[JobWorkspaceLock] Fehler beim Claimen mit Lock:", error);
    return {
      claimed: false,
      reason: "error",
      job: null
    };
  }
}

/**
 * Extrahiert den Workspace-Pfad aus einem Job.
 *
 * @param job - Der Job
 * @returns Der Workspace-Pfad oder null wenn nicht verfügbar
 */
function extractWorkspaceFromJob(job: JobRecord): string | null {
  // Versuch 1: Direkt aus input_payload.workspaceRoot
  const payload = job.input_payload as Record<string, unknown> | null;
  if (payload && typeof payload === "object" && "workspaceRoot" in payload) {
    const ws = payload.workspaceRoot;
    if (typeof ws === "string" && ws.trim()) {
      return ws.trim();
    }
  }

  // Versuch 2: Aus input_payload.planId (ImplementationPlan-Kontext)
  // In diesem Fall müsste der Workspace aus dem Plan-Kontext kommen
  // Das wird vom Executor gesetzt

  // Versuch 3: assigned_worker als Proxy (wenn Worker workspace-spezifisch ist)
  // Nicht ideal, aber als Fallback möglich

  return null;
}

/**
 * Gibt einen Job zurück zur Queue.
 *
 * @param jobId - Die Job-ID
 * @param workerId - Die Worker-ID die den Job geclaimed hat
 * @param reason - Grund für die Rückgabe
 */
async function requeueJob(
  jobId: string,
  workerId: string,
  reason: string
): Promise<void> {
  try {
    // Job als "requeued" markieren über Waypoint
    await backendClient.addJobWaypoint(jobId, {
      worker_id: workerId,
      waypoint: "requeued",
      message: reason,
      metadata: {
        reason: "workspace_locked",
        requeued_at: new Date().toISOString()
      }
    });

    console.log(`[JobWorkspaceLock] Job ${jobId} zurück zur Queue: ${reason}`);
  } catch (error) {
    console.error(`[JobWorkspaceLock] Fehler beim Requeue von Job ${jobId}:`, error);
    throw error;
  }
}

/**
 * Gibt den Lock für einen Job frei.
 *
 * Sollte nach Job-Abschluss (done/failed/cancelled) aufgerufen werden.
 *
 * @param workspaceRoot - Der Workspace-Pfad
 * @param jobId - Die Job-ID
 * @param workerId - Die Worker-ID
 * @returns true wenn erfolgreich freigegeben
 */
export function releaseJobLock(
  workspaceRoot: string,
  jobId: string,
  workerId: string
): boolean {
  const released = workspaceLockService.releaseLock(workspaceRoot, jobId, workerId);

  if (released) {
    console.log(
      `[JobWorkspaceLock] Lock freigegeben für Workspace "${workspaceRoot}" (Job: ${jobId})`
    );
  }

  return released;
}

/**
 * Verlängert den Lock für einen laufenden Job.
 *
 * Sollte periodisch während der Job-Ausführung aufgerufen werden.
 *
 * @param workspaceRoot - Der Workspace-Pfad
 * @param jobId - Die Job-ID
 * @param workerId - Die Worker-ID
 * @param ttlSeconds - Neue TTL in Sekunden
 * @returns true wenn erfolgreich verlängert
 */
export function renewJobLock(
  workspaceRoot: string,
  jobId: string,
  workerId: string,
  ttlSeconds: number = 1800
): boolean {
  const lock = workspaceLockService.getLock(workspaceRoot);

  if (!lock || lock.jobId !== jobId || lock.workerId !== workerId) {
    console.warn(
      `[JobWorkspaceLock] Kann Lock nicht verlängern: Kein gültiger Lock für Workspace "${workspaceRoot}"`
    );
    return false;
  }

  const updated = workspaceLockService.updateLock(workspaceRoot, {
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
  });

  if (updated) {
    console.log(
      `[JobWorkspaceLock] Lock verlängert für Workspace "${workspaceRoot}" um ${ttlSeconds}s`
    );
  }

  return updated;
}

/**
 * Wrapper für den bestehenden backendClient.claimNextJob mit Lock-Prüfung.
 *
 * Diese Funktion kann als Drop-In-Replacement verwendet werden.
 */
export const jobClaimerWithLock = {
  async claimNextJob(
    workerId: string,
    supportedRoles?: string[],
    leaseSeconds?: number
  ): Promise<JobRecord | null> {
    const result = await claimNextJobWithLock(workerId, supportedRoles, leaseSeconds);
    return result.job;
  }
};
