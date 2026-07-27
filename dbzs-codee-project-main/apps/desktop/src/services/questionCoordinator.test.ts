import { describe, expect, it } from "vitest";
import { questionCoordinator } from "@/services/questionCoordinator";

function answer(questionId: string, overrides: Partial<import("@dbzs/shared").AssistantAnswer> = {}) {
  return { questionId, answeredAt: new Date().toISOString(), ...overrides };
}

describe("questionCoordinator", () => {
  it("resolves a waiter with the given answer", async () => {
    const requestId = `req-${Math.random()}`;
    questionCoordinator.register(requestId);
    const givenAnswer = answer("q1", { freeText: "src/foo.ts" });

    const promise = questionCoordinator.waitForAnswer(requestId);
    questionCoordinator.resolve(requestId, givenAnswer);

    await expect(promise).resolves.toEqual(givenAnswer);
  });

  it("resolves immediately if the answer already arrived before waiting", async () => {
    const requestId = `req-${Math.random()}`;
    const givenAnswer = answer("q1", { optionIds: ["a"] });
    questionCoordinator.register(requestId);
    questionCoordinator.resolve(requestId, givenAnswer);

    await expect(questionCoordinator.waitForAnswer(requestId)).resolves.toEqual(givenAnswer);
  });

  it("rejects the wait when the signal aborts", async () => {
    const requestId = `req-${Math.random()}`;
    const controller = new AbortController();
    questionCoordinator.register(requestId);

    const promise = questionCoordinator.waitForAnswer(requestId, controller.signal);
    controller.abort(new Error("Question wait aborted."));

    await expect(promise).rejects.toThrow("Question wait aborted.");
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const requestId = `req-${Math.random()}`;
    const controller = new AbortController();
    controller.abort();
    questionCoordinator.register(requestId);

    await expect(questionCoordinator.waitForAnswer(requestId, controller.signal)).rejects.toThrow();
  });

  it("cancel() resolves the request with a skipped answer", async () => {
    const requestId = `req-${Math.random()}`;
    questionCoordinator.register(requestId);

    const promise = questionCoordinator.waitForAnswer(requestId);
    questionCoordinator.cancel(requestId, "q1");

    const resolved = await promise;
    expect(resolved.skipped).toBe(true);
    expect(resolved.questionId).toBe("q1");
  });

  it("reset() rejects all pending waiters", async () => {
    const requestId = `req-${Math.random()}`;
    questionCoordinator.register(requestId);
    const promise = questionCoordinator.waitForAnswer(requestId);

    questionCoordinator.reset();

    await expect(promise).rejects.toThrow();
  });
});
