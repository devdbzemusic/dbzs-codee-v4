import { beforeEach, describe, expect, it } from "vitest";
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
import { BindingModelError, brokerDecision, isDecisionStillValid } from "./modelSelectionBroker";

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

describe("brokerDecision binding + settings revision + VL text", () => {
  it("uses exact role settings and refuses silent planner→coder swap", () => {
    const decision = brokerDecision(
      "planning",
      {
        defaultModelId: "chat-default",
        defaultChatModelId: "chat-model",
        defaultModelName: "Chat",
        defaultPlannerModelId: "planner-model",
        defaultCoderModelId: "coder-model"
      },
      {
        catalog: [
          { id: "planner-model", name: "Planner Readable" },
          { id: "coder-model", name: "Coder Readable" }
        ],
        settingsRevision: 7
      }
    );

    expect(decision.resolvedModelId).toBe("planner-model");
    expect(decision.resolvedModelName).toBe("Planner Readable");
    expect(decision.configuredModelId).toBe("planner-model");
    expect(decision.selectionSource).toBe("role_setting");
    expect(decision.fallbackPolicy).toBe("strict");
    expect(decision.decisionSettingsRevision).toBe(7);
    expect(isDecisionStillValid(decision, 60_000, 7)).toBe(true);
    expect(isDecisionStillValid(decision, 60_000, 8)).toBe(false);
  });

  it("errors when the role model setting is missing", () => {
    expect(() =>
      brokerDecision("planning", {
        defaultModelId: "chat-default",
        defaultModelName: "Chat",
        defaultCoderModelId: "coder-model"
      })
    ).toThrow(BindingModelError);
  });

  it("allows VL chat models with supportsTextOnly for text chat", () => {
    const decision = brokerDecision(
      "casual_chat",
      {
        defaultModelId: "text-model",
        defaultChatModelId: "Qwen2.5-VL-3B-Instruct.Q4_K_M",
        defaultModelName: "Chat"
      },
      {
        hasImageInput: false,
        catalog: [
          {
            id: "Qwen2.5-VL-3B-Instruct.Q4_K_M",
            name: "Qwen2.5-VL-3B-Instruct.Q4_K_M",
            capabilities: ["chat", "vision"],
            supportsTextOnly: true,
            supportsVision: true
          }
        ]
      }
    );
    expect(decision.resolvedModelId).toMatch(/vl/i);
    expect(decision.reason).toContain("vision_gate:text_only_supported");
  });

  it("blocks VL models without text-only support instead of silent fallback", () => {
    expect(() =>
      brokerDecision(
        "planning",
        {
          defaultModelId: "text-model",
          defaultChatModelId: "text-model",
          defaultModelName: "Chat",
          defaultPlannerModelId: "Qwen2.5-VL-3B-VisionOnly",
          defaultCoderModelId: "coder-model"
        },
        {
          hasImageInput: false,
          catalog: [
            {
              id: "Qwen2.5-VL-3B-VisionOnly",
              name: "Qwen2.5-VL-3B-VisionOnly",
              capabilities: ["vision"],
              supportsTextOnly: false,
              requiresVisionProjector: true
            }
          ]
        }
      )
    ).toThrow(BindingModelError);
  });
});
