import { describe, expect, it } from "vitest";
import { formatBytes, modelLabStatusTone } from "./ModelLabTab.primitives";

describe("formatBytes", () => {
  it("formats zero and small byte counts", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats larger values with the closest unit", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });
});

describe("modelLabStatusTone", () => {
  it("maps each status to the expected tone", () => {
    expect(modelLabStatusTone("IDENTIFIED")).toBe("ok");
    expect(modelLabStatusTone("DISCOVERED")).toBe("info");
    expect(modelLabStatusTone("INCOMPLETE")).toBe("warn");
    expect(modelLabStatusTone("UNSUPPORTED")).toBe("warn");
    expect(modelLabStatusTone("BROKEN")).toBe("error");
  });
});
