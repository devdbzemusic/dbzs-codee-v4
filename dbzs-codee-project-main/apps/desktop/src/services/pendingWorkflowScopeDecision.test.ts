import { beforeEach, describe, expect, it } from "vitest";
import {
  pauseActiveTaskContract,
  readActiveTaskContract,
  resetActiveTaskContractMemoryForTests,
  upsertActiveTaskContract,
  writeActiveTaskContract
} from "@/services/activeTaskContract";
import {
  clearPendingWorkflowScopeDecision,
  readPendingWorkflowScopeDecision,
  resetPendingWorkflowScopeDecisionMemoryForTests,
  writePendingWorkflowScopeDecision
} from "@/services/pendingWorkflowScopeDecision";

const WORKSPACE = "C:/tmp/workflow-scope-a";
const WORKSPACE_B = "C:/tmp/workflow-scope-b";

describe("pauseActiveTaskContract", () => {
  beforeEach(() => {
    resetActiveTaskContractMemoryForTests();
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("archiviert den alten Contract und leert den aktiven Slot", () => {
    const active = upsertActiveTaskContract(WORKSPACE, {
      originalRequest: "StringLab",
      confirmedGoal: "StringLab",
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "planning"
    });
    expect(readActiveTaskContract(WORKSPACE)?.workflowId).toBe(active.workflowId);

    const paused = pauseActiveTaskContract(WORKSPACE);
    expect(paused?.confirmedGoal).toBe("StringLab");
    expect(readActiveTaskContract(WORKSPACE)).toBeNull();

    if (typeof localStorage !== "undefined") {
      const archiveKeys = Object.keys(localStorage).filter((key) =>
        key.includes("active-task-contract.archive")
      );
      expect(archiveKeys.length).toBeGreaterThan(0);
    }
  });
});

describe("pendingWorkflowScopeDecision persistence", () => {
  beforeEach(() => {
    resetPendingWorkflowScopeDecisionMemoryForTests();
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("stellt offene Auswahl wieder her und mischt Workspaces nicht", () => {
    writePendingWorkflowScopeDecision({
      workspaceId: "a",
      workspaceRoot: WORKSPACE,
      activeWorkflowId: "wf-a",
      triggeringMessageId: "msg-1",
      triggeringMessage: "Was ist Quantenphysik?",
      questionId: "q-1",
      actionId: "act-1",
      messageId: "msg-ask",
      createdAt: new Date().toISOString()
    });
    writePendingWorkflowScopeDecision({
      workspaceId: "b",
      workspaceRoot: WORKSPACE_B,
      activeWorkflowId: "wf-b",
      triggeringMessageId: "msg-2",
      triggeringMessage: "Anderer Workspace",
      questionId: "q-2",
      actionId: "act-2",
      messageId: "msg-ask-b",
      createdAt: new Date().toISOString()
    });

    expect(readPendingWorkflowScopeDecision(WORKSPACE)?.triggeringMessage).toBe(
      "Was ist Quantenphysik?"
    );
    expect(readPendingWorkflowScopeDecision(WORKSPACE_B)?.activeWorkflowId).toBe("wf-b");

    clearPendingWorkflowScopeDecision(WORKSPACE);
    expect(readPendingWorkflowScopeDecision(WORKSPACE)).toBeNull();
    expect(readPendingWorkflowScopeDecision(WORKSPACE_B)?.questionId).toBe("q-2");
  });

  it("entfernt veraltete pending-Datei nach Abschluss", () => {
    writePendingWorkflowScopeDecision({
      workspaceId: "a",
      workspaceRoot: WORKSPACE,
      activeWorkflowId: "wf-a",
      triggeringMessageId: "msg-1",
      triggeringMessage: "Hallo",
      questionId: "q-1",
      actionId: "act-1",
      messageId: "msg-ask",
      createdAt: new Date().toISOString()
    });
    clearPendingWorkflowScopeDecision(WORKSPACE);
    expect(readPendingWorkflowScopeDecision(WORKSPACE)).toBeNull();
  });
});

describe("active contract write after pause", () => {
  beforeEach(() => {
    resetActiveTaskContractMemoryForTests();
  });

  it("erlaubt neuen Contract nach Pause ohne den alten aktiv zu lassen", () => {
    writeActiveTaskContract({
      workspaceId: "ws",
      workspaceRoot: WORKSPACE,
      workflowId: "old",
      runId: "run-old",
      originalRequest: "Alt",
      confirmedGoal: "Alt",
      acceptanceCriteria: [],
      currentPhase: "planning",
      assignedAgent: "planner",
      taskType: "planning",
      answeredQuestions: [],
      answeredFields: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    pauseActiveTaskContract(WORKSPACE);
    const next = upsertActiveTaskContract(WORKSPACE, {
      originalRequest: "Neu",
      confirmedGoal: "Neu",
      taskType: "normal_chat",
      assignedAgent: "runtime_chat",
      currentPhase: "clarification"
    });
    expect(next.confirmedGoal).toBe("Neu");
    expect(readActiveTaskContract(WORKSPACE)?.workflowId).not.toBe("old");
  });
});
