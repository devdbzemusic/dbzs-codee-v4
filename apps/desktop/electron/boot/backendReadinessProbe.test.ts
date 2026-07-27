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

  it("probeStartup returns null on a non-ok response instead of throwing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false));
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    const result = await probe.probeStartup();
    expect(result).toBeNull();
  });

  it("probeStartup returns the parsed per-component startup payload", async () => {
    const component = { state: "pending" as const };
    const payload = {
      status: "starting",
      ready: false,
      progress: 50,
      instanceId: "abc",
      components: { database: component, modelRegistry: component, runtimeManager: component, residentModel: component }
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    const result = await probe.probeStartup();
    expect(result).toEqual(payload);
    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:8876/health/startup", { signal: undefined });
  });

  it("probeStartup accepts nullable error detail fields", async () => {
    const payload = {
      status: "degraded",
      ready: true,
      progress: 100,
      instanceId: "abc",
      components: {
        database: { state: "success" as const, message: "ok" },
        modelRegistry: {
          state: "failed" as const,
          message: "catalog broken",
          error: { code: "model-index-failed", technicalDetail: "catalog broken", stderrTail: null }
        },
        runtimeManager: { state: "success" as const, message: "ok" },
        residentModel: {
          state: "failed" as const,
          message: "resident failed",
          error: { code: "resident-model-start-failed", technicalDetail: null, stderrTail: null }
        }
      }
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    const result = await probe.probeStartup();
    expect(result).toEqual(payload);
  });

  it("probeStartup throws BootProtocolError when the backend payload doesn't match the schema", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: "starting" })); // missing required fields
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    await expect(probe.probeStartup()).rejects.toThrow("Ungültige Backend-Startup-Antwort");
  });

  it("probeReady returns null on a 503 'not ready' response instead of throwing", async () => {
    // GET /health/ready answers 503 while not ready -- fetch's `.ok` is
    // false for any non-2xx status, so this is indistinguishable here from
    // an unreachable backend, which is the correct behavior for a poller.
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: "starting", ready: false, instanceId: "abc" }, false));
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    const result = await probe.probeReady();
    expect(result).toBeNull();
  });

  it("probeReady returns the reduced terminal readiness payload once ready", async () => {
    const payload = {
      status: "ready",
      ready: true,
      instanceId: "abc",
      requiredComponents: { database: "success", modelRegistry: "success", runtimeManager: "success" },
      optionalComponents: { residentModel: "success" }
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    const result = await probe.probeReady();
    expect(result).toEqual(payload);
    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:8876/health/ready", { signal: undefined });
  });

  it("probeReady throws BootProtocolError when the backend payload doesn't match the schema", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: "ready", ready: "yes" })); // ready must be boolean
    const probe = new BackendReadinessProbe("http://127.0.0.1:8876", fetchFn);
    await expect(probe.probeReady()).rejects.toThrow("Ungültige Backend-Readiness-Antwort");
  });
});
