import { describe, expect, it } from "vitest";
import { add, divide, subtract } from "./calculator";

describe("calculator", () => {
  it("adds numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("subtracts numbers (currently fails due to known bug)", () => {
    expect(subtract(5, 3)).toBe(2);
  });

  it("divides numbers", () => {
    expect(divide(10, 2)).toBe(5);
  });
});
