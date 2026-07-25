import type { BootReadinessResponse } from "@dbzs/shared";

/**
 * Thin fetch+AbortSignal wrapper around /health/live and /health/ready.
 * Deliberately does its own single-shot fetch per call — repeated polling
 * is the BootOrchestrator's retry loop's job (soft/hard timeout driven),
 * not a fixed interval baked into the probe itself.
 */
export class BackendReadinessProbe {
  constructor(private readonly backendUrl: string, private readonly fetchFn: typeof fetch = fetch) {}

  async probeLive(signal?: AbortSignal): Promise<{ ok: boolean; pid: number | null }> {
    try {
      const response = await this.fetchFn(`${this.backendUrl}/health/live`, { signal });
      if (!response.ok) return { ok: false, pid: null };
      const body = (await response.json()) as { pid?: number };
      return { ok: true, pid: typeof body.pid === "number" ? body.pid : null };
    } catch {
      return { ok: false, pid: null };
    }
  }

  async probeReady(signal?: AbortSignal): Promise<BootReadinessResponse | null> {
    try {
      const response = await this.fetchFn(`${this.backendUrl}/health/ready`, { signal });
      if (!response.ok) return null;
      return (await response.json()) as BootReadinessResponse;
    } catch {
      return null;
    }
  }
}
