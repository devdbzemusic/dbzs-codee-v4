import { describe, expect, it } from "vitest";
import { redactSecrets, redactSecretsDeep } from "./secretRedaction.js";

describe("redactSecrets", () => {
  it("redacts KEY: value / KEY=value patterns for known secret keywords", () => {
    expect(redactSecrets("API_KEY: abc123xyz")).toBe("API_KEY: [REDACTED]");
    expect(redactSecrets("token=super-secret-value")).toBe("token= [REDACTED]");
    expect(redactSecrets("PASSWORD=hunter2")).toBe("PASSWORD= [REDACTED]");
  });

  it("redacts sk-... style API keys wherever they appear", () => {
    const input = "Authenticated with sk-abcdefghijklmnop, retrying...";
    expect(redactSecrets(input)).toBe("Authenticated with [REDACTED], retrying...");
  });

  it("redacts GitHub personal access tokens (ghp_... and github_pat_...)", () => {
    expect(redactSecrets("using ghp_1234567890abcdefghij for auth")).toBe("using [REDACTED] for auth");
    expect(redactSecrets("token github_pat_11ABCDEFGHIJKLMNOPQRSTUV")).not.toContain("github_pat_11ABCDEFGHIJKLMNOPQRSTUV");
  });

  it("redacts Bearer tokens", () => {
    expect(redactSecrets("Authorization header: Bearer abcdef123456")).toContain("[REDACTED]");
    expect(redactSecrets("Authorization header: Bearer abcdef123456")).not.toContain("abcdef123456");
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("Backend-Health-Endpunkt erreichbar.")).toBe("Backend-Health-Endpunkt erreichbar.");
  });
});

describe("redactSecretsDeep", () => {
  it("redacts string values nested in objects and arrays, leaving keys and other types alone", () => {
    const input = {
      message: "sk-abcdefghijklmnop leaked here",
      count: 42,
      nested: { technicalDetail: "Bearer abcdef123456" },
      list: ["clean text", "ghp_1234567890abcdefghij"]
    };

    const result = redactSecretsDeep(input);

    expect(result.message).toBe("[REDACTED] leaked here");
    expect(result.count).toBe(42);
    expect(result.nested.technicalDetail).toContain("[REDACTED]");
    expect(result.list[0]).toBe("clean text");
    expect(result.list[1]).toBe("[REDACTED]");
  });

  it("passes through null/undefined without throwing", () => {
    expect(redactSecretsDeep(null)).toBeNull();
    expect(redactSecretsDeep(undefined)).toBeUndefined();
  });
});
