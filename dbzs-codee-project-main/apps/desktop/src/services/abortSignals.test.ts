import { afterEach, describe, expect, it, vi } from "vitest";
import { combineAbortSignals } from "./abortSignals";

const nativeAny = AbortSignal.any;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(AbortSignal, "any", {
    configurable: true,
    writable: true,
    value: nativeAny
  });
});

describe("combineAbortSignals", () => {
  it("returns an already-aborted signal when one input is already aborted", () => {
    const controller = new AbortController();
    controller.abort("user-stop");

    const combined = combineAbortSignals([controller.signal]);

    expect(combined.signal.aborted).toBe(true);
    expect(combined.signal.reason).toBe("user-stop");
  });

  it("aborts when any input aborts", () => {
    const first = new AbortController();
    const second = new AbortController();
    const combined = combineAbortSignals([first.signal, second.signal]);

    second.abort("timeout");

    expect(combined.signal.aborted).toBe(true);
    expect(combined.signal.reason).toBe("timeout");
  });

  it("cleans fallback listeners", () => {
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      writable: true,
      value: undefined
    });

    const first = new AbortController();
    const second = new AbortController();
    const removeFirst = vi.spyOn(first.signal, "removeEventListener");
    const removeSecond = vi.spyOn(second.signal, "removeEventListener");

    const combined = combineAbortSignals([first.signal, second.signal]);
    combined.cleanup();

    expect(removeFirst).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(removeSecond).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("cleans fallback listeners after abort", () => {
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      writable: true,
      value: undefined
    });

    const first = new AbortController();
    const second = new AbortController();
    const removeFirst = vi.spyOn(first.signal, "removeEventListener");
    const removeSecond = vi.spyOn(second.signal, "removeEventListener");

    const combined = combineAbortSignals([first.signal, second.signal]);
    first.abort("cancelled");

    expect(combined.signal.aborted).toBe(true);
    expect(removeFirst).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(removeSecond).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
