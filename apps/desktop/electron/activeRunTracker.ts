/*
 * DBZS – Division By Zeros
 * Datei: activeRunTracker.ts
 * Bereich: Electron Main / Diagnostics
 *
 * Zweck:
 *   Verfolgt, welche RuntimeChatRun-IDs gerade eine laufende Chat-Anfrage haben.
 *
 * Warum:
 *   Ein harter Absturz mitten in einem Lauf soll im crash.log nachvollziehbar
 *   sein — ein Set statt eines einzelnen Skalars, weil mehrere Fenster
 *   (Hauptfenster, Runtime-Chat-Fenster) gleichzeitig Anfragen laufen haben
 *   koennen.
 */

const activeRunIds = new Set<string>();

export function markRunActive(runId: string | null | undefined): void {
  const trimmed = runId?.trim();
  if (trimmed) {
    activeRunIds.add(trimmed);
  }
}

export function markRunInactive(runId: string | null | undefined): void {
  const trimmed = runId?.trim();
  if (trimmed) {
    activeRunIds.delete(trimmed);
  }
}

export function getActiveRunIdsSnapshot(): string[] {
  return Array.from(activeRunIds);
}
