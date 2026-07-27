/*
 * DBZS - Division By Zeros
 * Datei: cacheRegistry.ts
 * Bereich: runtime-chat tuning lab / services
 *
 * Zweck:
 *   Simuliert TTL- und Performance-Probleme in einem Cache.
 */

export interface CacheEntry<T> {
  key: string;
  value: T;
  expiresAt: number;
  tags: string[];
}

export class CacheRegistry<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  remember(key: string, value: T, ttlMs: number, tags: string[] = []): void {
    this.entries.set(key, {
      key,
      value,
      expiresAt: Date.now() + Math.max(ttlMs, 0),
      tags
    });
  }

  read(key: string): T | undefined {
    this.purgeExpired();
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    // Absichtlicher TTL-Bug: abgelaufene Eintraege bleiben lesbar, frische koennen verschwinden.
    if (entry.expiresAt > Date.now()) {
      return undefined;
    }
    return entry.value;
  }

  invalidateByTag(tag: string): number {
    let removed = 0;

    for (const [key, entry] of this.entries) {
      if (entry.tags.includes(tag)) {
        this.entries.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  snapshot(): CacheEntry<T>[] {
    this.purgeExpired();
    return Array.from(this.entries.values());
  }

  private purgeExpired(): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt < Date.now()) {
        continue;
      }
      this.entries.delete(key);
    }
  }
}
