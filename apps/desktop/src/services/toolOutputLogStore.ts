/**
 * DBZS – Division By Zeros
 * Datei: toolOutputLogStore.ts
 * Bereich: Desktop Services / Tool Output Log Store
 *
 * Zweck:
 *   Hält vollständige, ungekürzte Tool-Outputs (fullLogRef-Ziel) im Speicher,
 *   damit nur eine Referenz in den Prompt wandert statt des vollen Textes.
 *
 * Bekannte Einschränkung:
 *   In-Memory, nicht auf Platte persistiert (kein verifizierter IPC-Pfad
 *   für Datei-Writes aus diesem Modul heraus). Begrenzt auf die letzten
 *   MAX_ENTRIES Einträge, damit der Speicherverbrauch nicht unbegrenzt wächst.
 */

const MAX_ENTRIES = 200;

const store = new Map<string, string>();

function createLogId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `tool-log-${crypto.randomUUID()}`;
  }
  return `tool-log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function storeFullToolLog(content: string): string {
  const id = createLogId();
  store.set(id, content);
  if (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) {
      store.delete(oldestKey);
    }
  }
  return id;
}

export function getFullToolLog(id: string): string | null {
  return store.get(id) ?? null;
}

export function clearToolLogStore(): void {
  store.clear();
}
