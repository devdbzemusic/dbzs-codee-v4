import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./index";

describe("DEFAULT_SETTINGS", () => {
  it("keeps telemetry disabled and safe command confirmation enabled", () => {
    expect(DEFAULT_SETTINGS.telemetryEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.safeCommandConfirmation).toBe(true);
    expect(DEFAULT_SETTINGS.runtimeChatUseBroker).toBe(true);
    expect(DEFAULT_SETTINGS.runtimeChatEnableSlotValidation).toBe(true);
    expect(DEFAULT_SETTINGS.runtimeChatEnableStrictFallback).toBe(true);
  });
});
