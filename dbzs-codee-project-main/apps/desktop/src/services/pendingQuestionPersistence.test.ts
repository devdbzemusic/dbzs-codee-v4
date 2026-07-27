import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPendingQuestion } from "@/services/pendingQuestionPersistence";

const { readProjectFileMock } = vi.hoisted(() => ({
  readProjectFileMock: vi.fn()
}));

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    readProjectFile: (...args: unknown[]) => readProjectFileMock(...args)
  }
}));

function pendingQuestion(workspaceRoot: string) {
  return {
    runId: "run-1",
    goal: "Build feature",
    targetAgent: "coder",
    profile: "ask",
    workspaceRoot,
    systemMessages: [],
    historyMessages: [],
    question: {
      id: "question-1",
      questionType: "free_text",
      prompt: "Welche Funktion?",
      toolCallId: "ask-user-1"
    },
    toolCallRequestId: "ask-user-1",
    askedAt: "2026-07-22T00:00:00.000Z"
  };
}

describe("pendingQuestionPersistence", () => {
  beforeEach(() => {
    readProjectFileMock.mockReset();
  });

  it("loads a pending question only for the requested workspace", async () => {
    readProjectFileMock.mockResolvedValue({
      content: JSON.stringify(pendingQuestion("C:\\Repos\\StringLab"))
    });

    await expect(readPendingQuestion("c:/repos/stringlab")).resolves.toEqual(
      expect.objectContaining({ runId: "run-1" })
    );
  });

  it("rejects a persisted question whose embedded workspace differs", async () => {
    readProjectFileMock.mockResolvedValue({
      content: JSON.stringify(pendingQuestion("C:/Repos/Analyzer"))
    });

    await expect(readPendingQuestion("C:/Repos/StringLab")).resolves.toBeNull();
  });
});
