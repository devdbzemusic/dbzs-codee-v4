import { describe, expect, it } from "vitest";
import type { ActiveTaskContract } from "@/services/activeTaskContract";
import {
  buildDeterministicActiveTaskSummary,
  detectConversationMetaIntent
} from "@/services/conversationMetaIntent";

describe("detectConversationMetaIntent", () => {
  it("erkennt Summary-Formulierungen und Summ-Preset-Text", () => {
    expect(
      detectConversationMetaIntent(
        "Fasse den aktuellen Stand knapp zusammen: Fortschritt, offene Punkte, naechster Schritt."
      )
    ).toBe("summarize_active_task");
    expect(detectConversationMetaIntent("Bitte kurz zusammenfassen")).toBe("summarize_active_task");
    expect(detectConversationMetaIntent("status recap")).toBe("summarize_active_task");
    expect(detectConversationMetaIntent("Wie weit bist du?")).toBe("summarize_active_task");
    expect(detectConversationMetaIntent("Wo stehen wir gerade?")).toBe("summarize_active_task");
  });

  it("erkennt Plan/Next nicht als Summary", () => {
    expect(
      detectConversationMetaIntent(
        "Erstelle einen klaren Implementierungsplan mit konkreten Schritten, Risiken und Tests."
      )
    ).toBeNull();
    expect(
      detectConversationMetaIntent("Gib die naechsten 3 priorisierten Schritte inklusive kurzer Begruendung an.")
    ).toBeNull();
  });
});

describe("buildDeterministicActiveTaskSummary", () => {
  it("erwähnt offene Constraints ohne Clarification zu erzwingen und mutiert den Contract nicht", () => {
    const contract: ActiveTaskContract = {
      workspaceId: "ws",
      workspaceRoot: "C:/tmp/ws",
      workflowId: "wf",
      runId: "run-1",
      originalRequest: "Plane StringLab",
      confirmedGoal: "Plane StringLab",
      acceptanceCriteria: ["Demo läuft"],
      currentPhase: "planning",
      assignedAgent: "planner",
      taskType: "planning",
      answeredQuestions: [],
      answeredFields: {
        success_criteria: {
          field: "success_criteria",
          questionId: "q1",
          question: "Erfolg?",
          answer: "Tests grün",
          answeredAt: new Date().toISOString()
        }
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const before = JSON.stringify(contract);

    const summary = buildDeterministicActiveTaskSummary({
      contract,
      lastRouting: {
        targetAgent: "planner",
        modelId: "planner-model",
        modelName: "Planner",
        providerId: "llama-cpp",
        slotId: "fast_gpu",
        routingPath: "broker",
        selectionSource: "role_setting",
        warmupStatus: "failed"
      },
      warmupDetail: "warmup_http_failed"
    });

    expect(summary).toContain("Fortschritt:");
    expect(summary).toContain("Erfolgskriterium beantwortet");
    expect(summary).toContain("technische Einschränkungen / Vorgaben noch nicht beantwortet");
    expect(summary).toContain("Warm-up fehlgeschlagen");
    expect(summary).not.toMatch(/Gib(t)? es technische Einschränkungen/);
    expect(JSON.stringify(contract)).toBe(before);
  });
});
