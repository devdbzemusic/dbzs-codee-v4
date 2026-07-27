/**
 * DBZS – Division By Zeros
 * Datei: workspaceLockService.ts
 * Bereich: Desktop Services / Workspace Lock Service
 *
 * Zweck:
 *   Stellt sicher, dass nur ein schreibender Implementierungsjob pro Workspace
 *   gleichzeitig läuft. Verhindert Race Conditions und Konflikte.
 *
 * Warum:
 *   Parallele Jobs im gleichen Workspace können zu:
 *   - Git-Konflikten
 *   - Überschreibenden Dateiänderungen
 *   - Nicht nachvollziehbaren Zuständen führen
 *
 * Wozu:
 *   Ermöglicht sichere, isolierte Job-Ausführung mit klarem Locking.
 */

import type { JobRecord } from "@dbzs/shared";

/**
 * Lock-Informationen für einen Workspace.
 */
export interface WorkspaceLock {
  /** Workspace-Pfad (canonical) */
  workspaceRoot: string;
  /** ID des Jobs, der den Lock hält */
  jobId: string;
  /** ID des Workers, der den Job ausführt */
  workerId: string;
  /** Zeitpunkt der Lock-Erstellung (ISO-8601) */
  lockedAt: string;
  /** Optionaler Timeout für den Lock (ISO-8601) */
  expiresAt?: string | null;
  /** Job-Titel für Anzeige */
  jobTitle: string;
}

/**
 * Lock-Ergebnis nach einem Claim-Versuch.
 */
export interface LockAcquisitionResult {
  /** Ob der Lock erfolgreich erworben wurde */
  acquired: boolean;
  /** Der Lock falls erworben */
  lock?: WorkspaceLock;
  /** Grund falls nicht erworben */
  reason?: "already_locked" | "expired" | "error";
  /** Existierender Lock falls bereits gesperrt */
  existingLock?: WorkspaceLock;
}

/**
 * Lock-Fehler.
 */
export class WorkspaceLockError extends Error {
  constructor(
    message: string,
    public readonly workspaceRoot?: string,
    public readonly jobId?: string
  ) {
    super(message);
    this.name = "WorkspaceLockError";
  }
}

/**
 * In-Memory Lock-Registry.
 *
 * HINWEIS: Für Production sollte dies persistent (Redis, DB) gespeichert werden.
 * Für die Desktop-App reicht zunächst In-Memory.
 */
class WorkspaceLockRegistry {
  private readonly locks = new Map<string, WorkspaceLock>();

  /**
   * Erwirbt einen Lock für einen Workspace.
   *
   * @param workspaceRoot - Der Workspace-Pfad
   * @param jobId - Die Job-ID
   * @param workerId - Die Worker-ID
   * @param ttlSeconds - Optionaler Timeout in Sekunden
   * @returns Ergebnis des Lock-Versuchs
   */
  acquire(
    workspaceRoot: string,
    jobId: string,
    workerId: string,
    ttlSeconds: number = 3600
  ): LockAcquisitionResult {
    const now = new Date();
    const canonicalPath = this.canonicalizePath(workspaceRoot);

    const existingLock = this.locks.get(canonicalPath);

    // Prüfen ob bereits gesperrt
    if (existingLock) {
      // Prüfen ob Lock abgelaufen ist
      if (existingLock.expiresAt && new Date(existingLock.expiresAt) < now) {
        // Lock ist abgelaufen – kann übernommen werden
        console.log(`[WorkspaceLock] Lock für ${canonicalPath} ist abgelaufen, wird übernommen`);
      } else {
        // Lock ist noch aktiv
        if (existingLock.jobId === jobId && existingLock.workerId === workerId) {
          // Gleicher Job/Worker – Lock verlängern
          existingLock.expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
          return {
            acquired: true,
            lock: existingLock
          };
        }

        return {
          acquired: false,
          reason: "already_locked",
          existingLock
        };
      }
    }

    // Neuen Lock erstellen
    const newLock: WorkspaceLock = {
      workspaceRoot: canonicalPath,
      jobId,
      workerId,
      lockedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      jobTitle: `Job ${jobId}`
    };

    this.locks.set(canonicalPath, newLock);

    console.log(`[WorkspaceLock] Lock erworben für ${canonicalPath} (Job: ${jobId}, Worker: ${workerId})`);

    return {
      acquired: true,
      lock: newLock
    };
  }

  /**
   * Gibt einen Lock frei.
   *
   * @param workspaceRoot - Der Workspace-Pfad
   * @param jobId - Die Job-ID (zur Validierung)
   * @param workerId - Die Worker-ID (zur Validierung)
   * @returns true wenn erfolgreich freigegeben
   */
  release(
    workspaceRoot: string,
    jobId: string,
    workerId: string
  ): boolean {
    const canonicalPath = this.canonicalizePath(workspaceRoot);
    const existingLock = this.locks.get(canonicalPath);

    if (!existingLock) {
      console.warn(`[WorkspaceLock] Kein Lock gefunden für ${canonicalPath}`);
      return false;
    }

    if (existingLock.jobId !== jobId || existingLock.workerId !== workerId) {
      console.warn(
        `[WorkspaceLock] Lock kann nicht freigegeben werden: Job/Worker mismatch für ${canonicalPath}`
      );
      return false;
    }

    this.locks.delete(canonicalPath);
    console.log(`[WorkspaceLock] Lock freigegeben für ${canonicalPath}`);

    return true;
  }

  /**
   * Prüft ob ein Workspace gesperrt ist.
   *
   * @param workspaceRoot - Der Workspace-Pfad
   * @returns Der aktuelle Lock oder null wenn frei
   */
  getLock(workspaceRoot: string): WorkspaceLock | null {
    const canonicalPath = this.canonicalizePath(workspaceRoot);
    const lock = this.locks.get(canonicalPath);

    if (!lock) {
      return null;
    }

    // Prüfen ob Lock abgelaufen ist
    if (lock.expiresAt && new Date(lock.expiresAt) < new Date()) {
      console.log(`[WorkspaceLock] Lock für ${canonicalPath} ist abgelaufen`);
      this.locks.delete(canonicalPath);
      return null;
    }

    return lock;
  }

  /**
   * Aktualisiert die Lock-Informationen (z.B. nach Job-Abschluss).
   */
  updateLock(workspaceRoot: string, updates: Partial<WorkspaceLock>): boolean {
    const canonicalPath = this.canonicalizePath(workspaceRoot);
    const lock = this.locks.get(canonicalPath);

    if (!lock) {
      return false;
    }

    Object.assign(lock, updates);
    return true;
  }

  /**
   * Bereinigt abgelaufene Locks.
   *
   * @returns Anzahl der bereinigten Locks
   */
  cleanupExpired(): number {
    const now = new Date();
    let removed = 0;

    for (const [path, lock] of this.locks.entries()) {
      if (lock.expiresAt && new Date(lock.expiresAt) < now) {
        this.locks.delete(path);
        removed++;
        console.log(`[WorkspaceLock] Abgelaufenen Lock entfernt: ${path}`);
      }
    }

    return removed;
  }

  clear(): void {
    this.locks.clear();
  }

  /**
   * Pfad kanonisch normalisieren (für konsistente Keys).
   */
  private canonicalizePath(path: string): string {
    // Windows: Groß-/Kleinschreibung normalisieren, Backslashes konsistent
    // UNC-Pfade behandeln
    let normalized = path.replace(/\//g, "\\");
    // Trailing Backslash entfernen (außer bei Laufwerksroot)
    if (normalized.length > 3 && normalized.endsWith("\\")) {
      normalized = normalized.slice(0, -1);
    }
    // Kleinschreibung für konsistenten Vergleich (Windows ist case-insensitive)
    return normalized.toLowerCase();
  }
}

/**
 * Singleton-Instanz der Lock-Registry.
 */
const registry = new WorkspaceLockRegistry();

/**
 * Service für Workspace-Locks.
 */
export const workspaceLockService = {
  /**
   * Erwirbt einen Lock für einen Job.
   *
   * @param workspaceRoot - Der Workspace-Pfad
   * @param job - Der Job der den Lock erwerben möchte
   * @param workerId - Die Worker-ID
   * @param ttlSeconds - Optionaler Timeout (Default: 1 Stunde)
   * @returns Ergebnis des Lock-Versuchs
   */
  acquireLock(
    workspaceRoot: string,
    job: Pick<JobRecord, "id" | "title">,
    workerId: string,
    ttlSeconds: number = 3600
  ): LockAcquisitionResult {
    return registry.acquire(workspaceRoot, job.id, workerId, ttlSeconds);
  },

  /**
   * Gibt einen Lock frei.
   *
   * @param workspaceRoot - Der Workspace-Pfad
   * @param jobId - Die Job-ID
   * @param workerId - Die Worker-ID
   * @returns true wenn erfolgreich
   */
  releaseLock(
    workspaceRoot: string,
    jobId: string,
    workerId: string
  ): boolean {
    return registry.release(workspaceRoot, jobId, workerId);
  },

  /**
   * Prüft ob ein Workspace gesperrt ist.
   *
   * @param workspaceRoot - Der Workspace-Pfad
   * @returns Der Lock oder null
   */
  getLock(workspaceRoot: string): WorkspaceLock | null {
    return registry.getLock(workspaceRoot);
  },

  /**
   * Prüft ob ein Job einen Lock halten darf.
   *
   * @param workspaceRoot - Der Workspace-Pfad
   * @param jobId - Die Job-ID
   * @param workerId - Die Worker-ID
   * @returns true wenn der Job den Lock hält oder erwerben kann
   */
  canAcquireLock(
    workspaceRoot: string,
    jobId: string,
    workerId: string
  ): boolean {
    const lock = registry.getLock(workspaceRoot);

    if (!lock) {
      // Kein Lock vorhanden – kann erworben werden
      return true;
    }

    // Gleicher Job/Worker?
    return lock.jobId === jobId && lock.workerId === workerId;
  },

  /**
   * Aktualisiert die Lock-Informationen.
   */
  updateLock(workspaceRoot: string, updates: Partial<WorkspaceLock>): boolean {
    return registry.updateLock(workspaceRoot, updates);
  },

  /**
   * Bereinigt abgelaufene Locks.
   */
  cleanupExpired(): number {
    return registry.cleanupExpired();
  },

  clearAllLocksForTests(): void {
    registry.clear();
  }
};

/**
 * Helper: Lock-Status für UI.
 */
export function formatLockStatus(lock: WorkspaceLock | null): string {
  if (!lock) {
    return "frei";
  }

  const lockedAgo = timeAgo(new Date(lock.lockedAt));
  const expiresSoon = lock.expiresAt
    ? new Date(lock.expiresAt).getTime() - Date.now() < 300_000 // 5 Minuten
    : false;

  return `${lock.jobTitle} · seit ${lockedAgo}${expiresSoon ? " · läuft bald ab" : ""}`;
}

/**
 * Helper: Zeitangabe als "vor X Minuten".
 */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "gerade";
  if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} Min`;
  if (seconds < 86400) return `vor ${Math.floor(seconds / 3600)} Std`;
  return `vor ${Math.floor(seconds / 86400)} Tagen`;
}
