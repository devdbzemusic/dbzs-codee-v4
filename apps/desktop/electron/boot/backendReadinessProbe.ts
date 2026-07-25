import type { BootReadyResponse, BootStartupResponse } from "@dbzs/shared";

/**
 * Thin fetch+AbortSignal wrapper around /health/live, /health/startup, and
 * /health/ready. Deliberately does its own single-shot fetch per call —
 * repeated polling is the BootOrchestrator's retry loop's job (soft/hard
 * timeout driven), not a fixed interval baked into the probe itself.
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

  /** Per-component boot progress (database/modelRegistry/runtimeManager/residentModel). Always 200 when reachable. */
  async probeStartup(signal?: AbortSignal): Promise<BootStartupResponse | null> {
    try {
      const response = await this.fetchFn(`${this.backendUrl}/health/startup`, { signal });
      if (!response.ok) return null;
      return (await response.json()) as BootStartupResponse;
    } catch {
      return null;
    }
  }

  /**
   * Final readiness gate. Returns null both when the backend is unreachable
   * AND when it deliberately answers 503 "not ready yet" -- both cases mean
   * the same thing to a caller polling this: "not ready".
   */
  async probeReady(signal?: AbortSignal): Promise<BootReadyResponse | null> {
    try {
      const response = await this.fetchFn(`${this.backendUrl}/health/ready`, { signal });
      if (!response.ok) return null;
      return (await response.json()) as BootReadyResponse;
    } catch {
      return null;
    }
  }
}
