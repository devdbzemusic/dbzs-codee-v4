import { describe, expect, it } from "vitest";
import { syncUsers } from "./syncUsers";

describe("syncUsers", () => {
  it("treats duplicate emails as duplicates even with different display names", async () => {
    const imported: string[] = [];

    const summary = await syncUsers(
      [
        { email: "ada@example.com", displayName: "Ada", active: true },
        { email: "ADA@example.com", displayName: "Ada Lovelace", active: true }
      ],
      async (user) => {
        imported.push(user.email.toLowerCase());
      }
    );

    expect(imported).toEqual(["ada@example.com"]);
    expect(summary.duplicateEmails).toEqual(["ADA@example.com"]);
  });
});
