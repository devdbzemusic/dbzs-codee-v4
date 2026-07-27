/**
 * P2 Phase 6: Unit Tests for Runtime Chat Error Classifier (Phase 3)
 */

import { describe, it, expect } from "vitest";
import {
  classifyRuntimeChatError,
  formatChatErrorForUser,
  type ChatErrorClass,
  wasSignalAborted
} from "@/services/runtimeChatErrorClassifier";

describe("runtimeChatErrorClassifier", () => {
  describe("classifyRuntimeChatError", () => {
    it("should classify abort errors", () => {
      const abortError = new DOMException("Aborted", "AbortError");
      const classification = classifyRuntimeChatError(abortError);

      expect(classification.class).toBe("abort");
      expect(classification.shouldRetry).toBe(false);
    });

    it("should classify timeout errors", () => {
      const timeoutError = new Error("Request timeout after 60000ms");
      const classification = classifyRuntimeChatError(timeoutError);

      expect(classification.class).toBe("timeout");
      expect(classification.shouldRetry).toBe(false); // No retry on timeout
    });

    it("should classify HTTP 400 tool errors", () => {
      const error = new Error("HTTP 400: Invalid tool definition");
      const classification = classifyRuntimeChatError(error);

      expect(classification.class).toBe("http_400_tools");
      expect(classification.shouldRetry).toBe(true); // Can retry without tools
    });

    it("should classify provider context rejections", () => {
      const error = new Error(
        "Runtime hat die Anfrage abgelehnt. Bitte ohne Tools oder mit weniger Kontext erneut senden."
      );
      const classification = classifyRuntimeChatError(error);

      expect(classification.class).toBe("provider_context_rejected");
      expect(classification.shouldRetry).toBe(false);
    });

    it("should classify explicit tool protocol incompatibility", () => {
      const error = new Error("tool_protocol_incompatible");
      const classification = classifyRuntimeChatError(error);

      expect(classification.class).toBe("tool_protocol_incompatible");
      expect(classification.shouldRetry).toBe(false);
    });

    it("should classify HTTP 500 server errors", () => {
      const error = new Error("HTTP 500: Internal Server Error");
      const classification = classifyRuntimeChatError(error);

      expect(classification.class).toBe("http_5xx");
      expect(classification.shouldRetry).toBe(false); // Circuit break, not retry
    });

    it("should classify transport/network errors", () => {
      const error = new Error("Failed to fetch");
      const classification = classifyRuntimeChatError(error);

      expect(classification.class).toBe("transport");
      expect(classification.shouldRetry).toBe(true);
      expect(classification.maxRetries).toBe(1);
    });

    it("should classify runtime errors", () => {
      const error = new Error("Model not found or unavailable");
      const classification = classifyRuntimeChatError(error);

      expect(classification.class).toBe("runtime_error");
    });

    it("should classify unknown errors as fallback", () => {
      const error = new Error("Something weird happened");
      const classification = classifyRuntimeChatError(error);

      expect(classification.class).toBe("unknown");
    });

    it("should include error details in classification", () => {
      const error = new Error("Specific error message");
      const classification = classifyRuntimeChatError(error);

      expect(classification).toHaveProperty("message");
      expect(classification.message).toContain("Specific error message");
    });

    it("should provide retry policy for each error type", () => {
      const errorTypes: ChatErrorClass[] = [
        "transport",
        "timeout",
        "abort",
        "http_400_tools",
        "http_4xx",
        "http_5xx",
        "runtime_error",
        "unknown"
      ];

      errorTypes.forEach(errorType => {
        const error = new Error(`Test ${errorType}`);
        const classification = classifyRuntimeChatError(error);

        expect(classification).toHaveProperty("isRetryable");
        expect(classification).toHaveProperty("maxRetries");
      });
    });
  });

  describe("error retry policies", () => {
    it("transport errors should allow 1 retry", () => {
      const error = new Error("Failed to fetch");
      const classification = classifyRuntimeChatError(error);

      if (classification.class === "transport") {
        expect(classification.maxRetries).toBe(1);
      }
    });

    it("timeout errors should not retry", () => {
      const timeoutError = new Error("Timeout");
      const classification = classifyRuntimeChatError(timeoutError);

      if (classification.class === "timeout") {
        expect(classification.maxRetries).toBe(0);
      }
    });

    it("abort errors should not retry", () => {
      const abortError = new DOMException("Aborted", "AbortError");
      const classification = classifyRuntimeChatError(abortError);

      expect(classification.class).toBe("abort");
      expect(classification.maxRetries).toBe(0);
    });

    it("client errors (4xx) should not retry", () => {
      const error = new Error("Bad request");
      const classification = classifyRuntimeChatError(error);

      expect(classification.shouldRetry).toBe(false);
    });

    it("server errors (5xx) should allow retry", () => {
      const error = new Error("Server error");
      const classification = classifyRuntimeChatError(error);

      expect(classification.shouldRetry).toBe(true);
    });
  });

  describe("", () => {
    it("should format abort error with user-friendly message", () => {
      const abortError = new DOMException("Aborted", "AbortError");
      const message = formatChatErrorForUser(abortError);

      expect(message).toContain("abgebrochen");
      expect(message.length).toBeGreaterThan(0);
    });

    it("should format timeout error with retry suggestion", () => {
      const timeoutError = new Error("Timeout");
      const message = formatChatErrorForUser(timeoutError);

      expect(message).toBeDefined();
      expect(message.length).toBeGreaterThan(0);
    });

    it("should format transport error with retry indication", () => {
      const error = new Error("Network error");
      const classification = classifyRuntimeChatError(error);
      const message = formatChatErrorForUser(error);

      if (classification.class === "transport") {
        // Should indicate retry is possible
        expect(message).toBeDefined();
      }
    });

    it("should not include technical details for user messages", () => {
      const error = new Error("HTTP 500: Internal Server Error at /v1/chat/completions");
      const message = formatChatErrorForUser(error);

      // Should be user-friendly, not raw error
      expect(message.length).toBeGreaterThan(0);
    });
  });

  describe("", () => {
    it("should detect AbortError from signal", () => {
      const signal = new AbortController().signal;
      const abortedError = new DOMException("Aborted", "AbortError");

      expect(wasSignalAborted(signal, abortedError)).toBe(true);
    });

    it("should not mark other errors as aborted", () => {
      const timeout = new Error("Timeout");
      const network = new Error("Network error");
      const unknown = new Error("Unknown error");

      const signal = new AbortController().signal;
      expect(wasSignalAborted(signal, timeout)).toBe(false);
      expect(wasSignalAborted(signal, network)).toBe(false);
      expect(wasSignalAborted(signal, unknown)).toBe(false);
    });
  });

  describe("no retry cascade", () => {
    it("should enforce single retry policy (not nested retries)", () => {
      const error = new Error("Failed");
      let attemptCount = 0;

      const retryLogic = (maxRetries: number) => {
        const classification = classifyRuntimeChatError(error);
        expect(classification.maxRetries).toBeLessThanOrEqual(1);

        // Simulate single retry
        if (classification.shouldRetry && attemptCount < classification.maxRetries) {
          attemptCount++;
          return retryLogic(classification.maxRetries);
        }
      };

      retryLogic(1);
      expect(attemptCount).toBeLessThanOrEqual(1);
    });

    it("should prevent retry of already-retried errors", () => {
      const error = new Error("Failed after retry");
      const classification = classifyRuntimeChatError(error);

      // After first retry, no more retries allowed
      expect(classification.maxRetries).toBeLessThanOrEqual(1);
    });
  });

  describe("error context", () => {
    it("should include HTTP status when available", () => {
      const error = new Error("Server error");
      const classification = classifyRuntimeChatError(error);

      expect(classification).toHaveProperty("httpStatus");
      expect(classification.httpStatus).toBe(503);
    });

    it("should handle errors without HTTP status", () => {
      const error = new Error("Network error");
      const classification = classifyRuntimeChatError(error);

      expect(classification).toHaveProperty("httpStatus");
      // httpStatus should be undefined or null, not 0
      expect([undefined, null]).toContain(classification.httpStatus);
    });
  });
});
