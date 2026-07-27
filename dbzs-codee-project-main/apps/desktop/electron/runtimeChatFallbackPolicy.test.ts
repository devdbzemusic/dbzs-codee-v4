import { describe, expect, it } from "vitest";
import {
  classifyRuntimeStreamError,
  shouldAttemptNonStreamFallback,
} from "./runtimeChatFallbackPolicy";

describe("runtimeChatFallbackPolicy", () => {
  it("unterbindet Non-Stream-Fallback nach strukturiertem Provider-Streamfehler", () => {
    const error = new Error("llama-server request failed: invalid request");
    error.name = "RuntimeStreamProviderError";

    const meta = classifyRuntimeStreamError(error);

    expect(meta.isProviderStreamError).toBe(true);
    expect(meta.isToolError).toBe(true);
    expect(shouldAttemptNonStreamFallback(meta)).toBe(false);
  });

  it("erlaubt Fallback nur fuer echte Transportfehler", () => {
    const meta = classifyRuntimeStreamError(new Error("fetch failed ECONNRESET"));

    expect(meta.isTransport).toBe(true);
    expect(shouldAttemptNonStreamFallback(meta)).toBe(true);
  });
});
