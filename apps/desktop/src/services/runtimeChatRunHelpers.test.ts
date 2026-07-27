import { describe, expect, it } from "vitest";
import { createChatRun, upsertRunTurn } from "./runtimeChatRunHelpers";

describe("runtimeChatRunHelpers", () => {
  it("persistiert einen Turn und aktualisiert ihn ueber turnNumber", () => {
    const run = createChatRun("msg-user", "agent", "agent", true, "C:/workspace");

    const withFirstTurn = upsertRunTurn(run, {
      id: "turn-1",
      turnNumber: 1,
      prompt: "Bitte pruefen",
      response: "Erste Antwort",
      startedAt: run.startedAt
    });
    const withUpdatedTurn = upsertRunTurn(withFirstTurn, {
      id: "turn-1b",
      turnNumber: 1,
      prompt: "Bitte pruefen",
      response: "Aktualisierte Antwort",
      startedAt: run.startedAt,
      finishedAt: run.startedAt
    });

    expect(withUpdatedTurn.turns).toHaveLength(1);
    expect(withUpdatedTurn.turns[0]?.response).toBe("Aktualisierte Antwort");
    expect(withUpdatedTurn.turns[0]?.finishedAt).toBe(run.startedAt);
  });
});
