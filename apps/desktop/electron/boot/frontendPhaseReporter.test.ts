import { describe, expect, it } from "vitest";
import { reportFrontendPhase, waitForFrontendPhase } from "./frontendPhaseReporter.js";

describe("frontendPhaseReporter", () => {
  it("resolves waitForFrontendPhase once a matching success report arrives", async () => {
    const controller = new AbortController();
    const pending = waitForFrontendPhase("test-phase-a", controller.signal);
    reportFrontendPhase("test-phase-a", "success", "done");

    await expect(pending).resolves.toBe("done");
  });

  it("rejects waitForFrontendPhase when a matching failure report arrives", async () => {
    const controller = new AbortController();
    const pending = waitForFrontendPhase("test-phase-b", controller.signal);
    reportFrontendPhase("test-phase-b", "failed", "boom");

    await expect(pending).rejects.toThrow("boom");
  });

  it("buffers a report that arrives before anyone is waiting (mailbox), delivered on the next wait", async () => {
    reportFrontendPhase("test-phase-c", "success", "early");

    const controller = new AbortController();
    await expect(waitForFrontendPhase("test-phase-c", controller.signal)).resolves.toBe("early");
  });

  it("carries progress and metadata through a buffered report without affecting the resolved message", async () => {
    reportFrontendPhase("test-phase-d", "success", "with-extras", 42, { foo: "bar" });

    const controller = new AbortController();
    await expect(waitForFrontendPhase("test-phase-d", controller.signal)).resolves.toBe("with-extras");
  });

  it("rejects an in-flight wait when its AbortSignal fires", async () => {
    const controller = new AbortController();
    const pending = waitForFrontendPhase("test-phase-e", controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow("aborted");
  });

  it("rejects immediately if the signal is already aborted before waiting starts", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(waitForFrontendPhase("test-phase-f", controller.signal)).rejects.toThrow("aborted");
  });
});
