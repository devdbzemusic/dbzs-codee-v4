/**
 * Live-repro (service-level) for the StringLab binding/workflow case from
 * CURSOR_PROMPT_CODEE_BINDING_MODEL_ROLES_WORKFLOW_GROUNDING.md
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearActiveTaskContract,
  formatActiveTaskContractBlock,
  resetActiveTaskContractMemoryForTests,
  upsertActiveTaskContract
} from "./activeTaskContract";
import { resolveWorkflowContinuation } from "./workflowContinuation";
import { brokerDecision, classifyTaskTypeDetailed } from "./modelSelectionBroker";
import { validatePlanningGrounding, stripUnverifiedPathClaims } from "./planningGrounding";

const WORKSPACE = "C:/Users/ralle/source/repos/dbzssl";

const SETTINGS = {
  defaultModelId: "chat-model",
  defaultChatModelId: "chat-model",
  defaultModelName: "Chat",
  defaultPlannerModelId: "planner-qwen-coder-3b",
  defaultCoderModelId: "coder-qwen-7b",
  defaultReviewerModelId: "reviewer-model",
  defaultDebugModelId: "debug-model"
};

const CATALOG = [
  { id: "planner-qwen-coder-3b", name: "Qwen2.5-Coder-3B-Instruct-Q4_K_M", capabilities: ["chat", "code"] },
  { id: "coder-qwen-7b", name: "Qwen2.5-Coder-7B-Instruct-Q4-K-M-GGUF", capabilities: ["code"] },
  { id: "vision-vl", name: "Qwen2.5-VL-3B-Instruct", capabilities: ["vision"], recommended_use: "vision_candidate" }
];

describe("StringLab live repro (service path)", () => {
  beforeEach(() => {
    resetActiveTaskContractMemoryForTests();
    clearActiveTaskContract(WORKSPACE);
  });

  it("keeps follow-up in planning with bound planner role model (not casual_chat / not vision)", () => {
    const original = "Wir bauen heute eine kleine neue Funktion für StringLab";
    const feature =
      "Eine Smart Practice Session für Gitarre und Bass mit Übungsziel, Dauer, BPM, Start, Pause, Fortsetzen und lokaler Speicherung.";
    const acceptance =
      "Die Funktion ist korrekt, wenn eine Session für Gitarre oder Bass angelegt, gestartet, pausiert, fortgesetzt und beendet werden kann.";
    const followUp = "Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.";

    const firstIntent = classifyTaskTypeDetailed(original, false, false);
    expect(["small_code_change", "large_code_change", "planning"]).toContain(firstIntent.taskType);

    upsertActiveTaskContract(WORKSPACE, {
      originalRequest: original,
      confirmedGoal: feature,
      acceptanceCriteria: [acceptance],
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "planning",
      answeredQuestions: [
        { question: "Welche konkrete Funktion?", answer: feature },
        { question: "Akzeptanzkriterien?", answer: acceptance }
      ]
    });

    const classifiedFollowUp = classifyTaskTypeDetailed(followUp, false, false);
    expect(classifiedFollowUp.taskType).toBe("casual_chat");

    const continuation = resolveWorkflowContinuation({
      message: followUp,
      classifiedTaskType: classifiedFollowUp.taskType,
      contract: upsertActiveTaskContract(WORKSPACE, {
        originalRequest: original,
        confirmedGoal: feature,
        acceptanceCriteria: [acceptance],
        taskType: "planning",
        assignedAgent: "planner",
        currentPhase: "planning"
      })
    });

    expect(continuation.useActiveContract).toBe(true);
    expect(continuation.taskType).toBe("planning");
    expect(continuation.reason).toBe("active_workflow_follow_up");

    const decision = brokerDecision(continuation.taskType, SETTINGS, {
      hasImageInput: false,
      requiresVision: false,
      preferPlannerFirst: true,
      catalog: CATALOG
    });

    expect(decision.resolvedModelId).toBe("planner-qwen-coder-3b");
    expect(decision.resolvedModelName).toBe("Qwen2.5-Coder-3B-Instruct-Q4_K_M");
    expect(decision.resolvedModelId).not.toMatch(/vl/i);
    expect(decision.slotId).toBe("fast_gpu");
    expect(decision.selectionSource).toBe("role_setting");
    expect(decision.fallbackPolicy).toBe("strict");

    const contractBlock = formatActiveTaskContractBlock(continuation.contract!, followUp);
    expect(contractBlock).toContain("Smart Practice Session");
    expect(contractBlock).toContain(followUp);

    const badAnswer = [
      "1. Rig Grid Editor erweitern in src/agents/MuzNavigatorAgent.ts",
      "2. AudioVisualizer und Tuner anbinden",
      "3. Practice Coach Agent in src/agents/PracticeCoachAgent.js starten"
    ].join("\n");

    const grounding = validatePlanningGrounding({
      answer: badAnswer,
      confirmedGoal: feature,
      acceptanceCriteria: [acceptance],
      verifiedPaths: [],
      toolResultCount: 0
    });
    expect(grounding.unrelatedTopicDetected).toBe(true);
    expect(grounding.citedFilesVerified).toBe(false);

    const cleaned = stripUnverifiedPathClaims(badAnswer, grounding.unverifiedPathCitations);
    expect(cleaned).toContain("Pfad noch nicht verifiziert");
    expect(cleaned).toContain("exakten Dateien müssen zuerst");
  });
});
