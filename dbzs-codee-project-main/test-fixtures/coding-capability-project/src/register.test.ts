import { describe, expect, it } from "vitest";
import { registerUser, type UserRecord } from "./register";

describe("registerUser", () => {
  it("normalizes and stores a valid user", () => {
    const result = registerUser([], {
      email: "  PERSON@Example.COM ",
      displayName: " Ada "
    });

    expect(result).toEqual([
      {
        id: "user-1",
        email: "person@example.com",
        displayName: "Ada"
      }
    ]);
  });

  it("rejects invalid email addresses", () => {
    expect(() => registerUser([], { email: "not-valid", displayName: "Ada" })).toThrow("Invalid email");
  });

  it("keeps the public API shape", () => {
    const existing: UserRecord[] = [];
    const result: UserRecord[] = registerUser(existing, {
      email: "ada@example.com",
      displayName: "Ada"
    });
    expect(result[0].id).toBe("user-1");
  });
});
