import { describe, expect, it, vi } from "vitest";
import { BackendReadinessProbe } from "./backendReadinessProbe.js";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

describe("BackendReadinessProbe", () => {
  it("probeLive returns ok:false when the fetch rejects (backend not up yet)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    const result = await probe.probeLive();
    expect(result).toEqual({ ok: false, pid: null });
  });

  it("probeLive returns the reported pid once /health/live answers", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: "ok", pid: 4321 }));
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    const result = await probe.probeLive();
    expect(result).toEqual({ ok: true, pid: 4321 });
    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:8876/health/live", { signal: undefined });
  });

  it("probeReady returns null on a non-ok response instead of throwing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false));
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    const result = await probe.probeReady();
    expect(result).toBeNull();
  });

  it("probeReady returns the parsed readiness payload", async () => {
    const payload = { status: "starting", ready: false, progress: 50, components: {} };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    const result = await probe.probeReady();
    expect(result).toEqual(payload);
  });
});
