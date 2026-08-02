import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearActiveTaskContract,
  detachActiveTaskContract,
  formatActiveTaskContractBlock,
  readActiveTaskContract,
  resetActiveTaskContractMemoryForTests,
  restoreActiveTaskContract,
  upsertActiveTaskContract
} from "./activeTaskContract";
import {
  isWorkflowFollowUpMessage,
  resolveWorkflowContinuation
} from "./workflowContinuation";
import {
  extractCitedWorkspacePaths,
  validatePlanningGrounding
} from "./planningGrounding";
import {
  addVerifiedPath,
  collectEvidenceFromToolResult,
  createVerifiedWorkspaceEvidence,
  normalizeWorkspacePath,
  verifiedPathsList
} from "./verifiedWorkspaceEvidence";

import { brokerDecision, isDecisionStillValid } from "./modelSelectionBroker";

const resolveRuntimeRouteMock = vi.fn();
vi.mock("@/services/backendClient", () => ({
  backendClient: {
    resolveRuntimeRoute: (...args: unknown[]) => resolveRuntimeRouteMock(...args)
  }
}));

describe("workflowContinuation", () => {
  const contract = {
    workspaceId: "ws",
    workspaceRoot: "C:/repo",
    workflowId: "wf-1",
    runId: "run-1",
    originalRequest: "Wir bauen heute eine kleine neue Funktion für StringLab",
    confirmedGoal: "Smart Practice Session",
    acceptanceCriteria: ["Lifecycle"],
    currentPhase: "planning" as const,
    assignedAgent: "planner" as const,
    taskType: "planning" as const,
    answeredQuestions: [],
    answeredFields: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  it("keeps follow-up questions inside the active planning workflow", () => {
    expect(isWorkflowFollowUpMessage("Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.")).toBe(
      true
    );

    const result = resolveWorkflowContinuation({
      message: "Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.",
      classifiedTaskType: "casual_chat",
      contract
    });

    expect(result.useActiveContract).toBe(true);
    expect(result.taskType).toBe("planning");
    expect(result.reason).toBe("active_workflow_follow_up");
    expect(result.needsAmbiguityAsk).toBe(false);
  });

  it("keeps continue / which files follow-ups in the contract", () => {
    expect(resolveWorkflowContinuation({
      message: "Mach weiter",
      classifiedTaskType: "casual_chat",
      contract
    }).useActiveContract).toBe(true);

    expect(resolveWorkflowContinuation({
      message: "Welche Dateien sind betroffen?",
      classifiedTaskType: "normal_chat",
      contract
    }).useActiveContract).toBe(true);
  });

  it("does not silently stick independent chat into the old workflow", () => {
    const result = resolveWorkflowContinuation({
      message: "Erkläre mir Quantencomputer.",
      classifiedTaskType: "casual_chat",
      contract
    });
    expect(result.useActiveContract).toBe(false);
    expect(result.needsAmbiguityAsk).toBe(true);
    expect(result.reason).toBe("workflow_ambiguity");
  });

  it("treats explicit Neue Aufgabe as leaving the contract", () => {
    const result = resolveWorkflowContinuation({
      message: "Neue Aufgabe: Baue einen Tuner",
      classifiedTaskType: "small_code_change",
      contract
    });
    expect(result.useActiveContract).toBe(false);
    expect(result.reason).toBe("explicit_new_task");
    expect(result.needsAmbiguityAsk).toBe(false);
  });
});

describe("activeTaskContract workspace switch", () => {
  beforeEach(() => {
    resetActiveTaskContractMemoryForTests();
    clearActiveTaskContract("C:/repo-a");
    clearActiveTaskContract("C:/repo-b");
  });

  it("restores destination contract instead of clearing it", () => {
    upsertActiveTaskContract("C:/repo-a", {
      originalRequest: "A",
      confirmedGoal: "Contract A",
      acceptanceCriteria: [],
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "planning"
    });
    upsertActiveTaskContract("C:/repo-b", {
      originalRequest: "B",
      confirmedGoal: "Contract B",
      acceptanceCriteria: [],
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "planning"
    });

    detachActiveTaskContract("C:/repo-a");
    const restoredB = restoreActiveTaskContract("C:/repo-b");
    expect(restoredB?.confirmedGoal).toBe("Contract B");

    detachActiveTaskContract("C:/repo-b");
    const restoredA = restoreActiveTaskContract("C:/repo-a");
    expect(restoredA?.confirmedGoal).toBe("Contract A");
  });

  it("persists and formats a task contract block", () => {
    const contract = upsertActiveTaskContract("C:/repo-a", {
      originalRequest: "Feature",
      confirmedGoal: "Smart Practice Session",
      acceptanceCriteria: ["Start/Pause"],
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "planning"
    });

    expect(readActiveTaskContract("C:/repo-a")?.workflowId).toBe(contract.workflowId);
    expect(formatActiveTaskContractBlock(contract, "Nächste Schritte")).toContain("[ACTIVE TASK CONTRACT]");
    expect(formatActiveTaskContractBlock(contract, "Nächste Schritte")).toContain("Smart Practice Session");
  });
});

describe("planningGrounding + verified evidence", () => {
  it("flags unverified path citations when no tools ran", () => {
    const answer =
      "1. Ändere src/agents/PracticeCoachAgent.js\n2. Nutze src/agents/MuzNavigatorAgent.ts";
    expect(extractCitedWorkspacePaths(answer)).toEqual([
      "src/agents/PracticeCoachAgent.js",
      "src/agents/MuzNavigatorAgent.ts"
    ]);
    const grounding = validatePlanningGrounding({
      answer,
      confirmedGoal: "Smart Practice Session für Gitarre und Bass",
      acceptanceCriteria: ["lokale Speicherung"],
      verifiedPaths: [],
      toolResultCount: 0
    });
    expect(grounding.citedFilesVerified).toBe(false);
    expect(grounding.unverifiedPathCitations.length).toBe(2);
  });

  it("detects unrelated Rig Grid / Tuner topics", () => {
    const grounding = validatePlanningGrounding({
      answer: "Wir bauen zuerst das Rig Grid und den Tuner um.",
      confirmedGoal: "Smart Practice Session für Gitarre und Bass",
      acceptanceCriteria: ["lokale Speicherung"],
      verifiedPaths: [],
      toolResultCount: 0
    });
    expect(grounding.unrelatedTopicDetected).toBe(true);
  });

  it("keeps verified paths and rejects cross-workspace / .codee paths", () => {
    const evidence = createVerifiedWorkspaceEvidence();
    const root = "C:/Users/ralle/source/repos/dbzssl";
    expect(addVerifiedPath(evidence, `${root}/src/practice/Session.ts`, "list_files", root)).toBe(true);
    expect(addVerifiedPath(evidence, "src/practice/Session.ts", "read_file", root)).toBe(true);
    expect(addVerifiedPath(evidence, "C:/other/repo/secret.ts", "search_code", root)).toBe(false);
    expect(addVerifiedPath(evidence, ".codee/resources/x.json", "context_source", root)).toBe(false);
    expect(normalizeWorkspacePath("src\\practice\\Session.ts", root)?.toLowerCase()).toBe(
      "src/practice/session.ts"
    );

    collectEvidenceFromToolResult(
      evidence,
      "list_files",
      { entries: [{ path: "src/domain/Practice.ts" }] },
      root
    );

    const paths = verifiedPathsList(evidence);
    expect(paths).toContain("src/practice/session.ts");
    expect(paths).toContain("src/domain/practice.ts");

    const grounding = validatePlanningGrounding({
      answer: "Nutze src/practice/Session.ts und erfinde src/fake/No.ts",
      confirmedGoal: "Smart Practice Session",
      acceptanceCriteria: [],
      verifiedPaths: paths,
      toolResultCount: paths.length
    });
    expect(grounding.unverifiedPathCitations.some((p) => /fake/i.test(p))).toBe(true);
  });
});

// brokerDecision() is a thin client over backendClient.resolveRuntimeRoute() —
// FleetRoutingResolver (backend/app/runtime/routing_resolver.py) is now the
// sole authority for role-setting resolution, the vision gate, and fallback
// tiers (Workflow-Bruch WF-01). These tests only verify the desktop-side
// plumbing (request shape sent, response mapped 1:1 onto ModelSelectionDecision);
// the actual routing/vision-gate/fallback *behavior* is covered by the backend's
// own tests against FleetRoutingResolver.
describe("brokerDecision — backend-authoritative plumbing", () => {
  beforeEach(() => {
    resolveRuntimeRouteMock.mockReset();
  });

  const baseSettings = {
    defaultModelId: "chat-default",
    defaultChatModelId: "chat-model",
    defaultModelName: "Chat",
    defaultPlannerModelId: "planner-model",
    defaultCoderModelId: "coder-model"
  };

  const baseResponse = {
    decision_id: "decision-1",
    task_type: "planning",
    target_agent: "planner",
    slot_id: "quality_cpu",
    model_id: "planner-model",
    model_name: "Planner Readable",
    configured_model_id: "planner-model",
    resolved_model_id: "planner-model",
    resolved_model_name: "Planner Readable",
    selection_source: "role_setting",
    capabilities: [],
    has_image_input: false,
    requires_vision: false,
    provider_id: "llama-cpp",
    reason: ["role_setting:planner-model"],
    fallback_policy: "strict",
    decision_settings_revision: 7
  };

  it("maps the backend RuntimeRouteResponse 1:1 onto ModelSelectionDecision", async () => {
    resolveRuntimeRouteMock.mockResolvedValueOnce(baseResponse);

    const decision = await brokerDecision("planning", baseSettings, { settingsRevision: 7 });

    expect(decision.resolvedModelId).toBe("planner-model");
    expect(decision.resolvedModelName).toBe("Planner Readable");
    expect(decision.configuredModelId).toBe("planner-model");
    expect(decision.selectionSource).toBe("role_setting");
    expect(decision.fallbackPolicy).toBe("strict");
    expect(decision.decisionSettingsRevision).toBe(7);
    expect(isDecisionStillValid(decision, 60_000, 7)).toBe(true);
    expect(isDecisionStillValid(decision, 60_000, 8)).toBe(false);
  });

  it("sends task type, vision flags and manual override in the route request", async () => {
    resolveRuntimeRouteMock.mockResolvedValueOnce(baseResponse);

    await brokerDecision("planning", baseSettings, {
      hasImageInput: true,
      requiresVision: true,
      manualModelId: "manual-model",
      userMessage: "explain this"
    });

    expect(resolveRuntimeRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: "planning",
        has_image_input: true,
        requires_vision: true,
        manual_model_id: "manual-model",
        user_message: "explain this"
      })
    );
  });

  it("propagates a rejected route resolution instead of silently falling back", async () => {
    resolveRuntimeRouteMock.mockRejectedValueOnce(
      new Error("Backend request failed: 409 | vision_pairing_required")
    );

    await expect(brokerDecision("planning", baseSettings)).rejects.toThrow(
      "vision_pairing_required"
    );
  });
});
