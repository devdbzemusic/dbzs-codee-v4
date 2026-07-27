import { describe, expect, it } from "vitest";
import { formatModelSizeBadge, formatRuntimeModelLabel } from "./modelLabel";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe("formatModelSizeBadge", () => {
  it("formats gigabytes with one decimal when needed", () => {
    expect(formatModelSizeBadge(2.5 * GB)).toBe("[2.5GB]");
    expect(formatModelSizeBadge(8 * GB)).toBe("[8GB]");
  });

  it("formats megabytes below one gigabyte", () => {
    expect(formatModelSizeBadge(800 * MB)).toBe("[800MB]");
    expect(formatModelSizeBadge(512 * MB)).toBe("[512MB]");
  });

  it("returns empty string for unknown size", () => {
    expect(formatModelSizeBadge(0)).toBe("");
    expect(formatModelSizeBadge(-1)).toBe("");
  });
});

describe("formatRuntimeModelLabel", () => {
  it("includes size badge in the runtime label", () => {
    expect(
      formatRuntimeModelLabel({
        name: "qwen2.5-coder",
        runtime_launcher: "ollama",
        size_bytes: 2.5 * GB
      })
    ).toBe("qwen2.5-coder [2.5GB] · ollama");
  });
});
