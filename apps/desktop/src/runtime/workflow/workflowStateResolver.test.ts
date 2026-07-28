import { describe, expect, it } from "vitest";
import { assertValidPhaseAgentPair } from "@/services/phaseAgentInvariant";
import type { ActiveTaskContract } from "@/services/activeTaskContract";
import {
  resolveCanonicalWorkflowAssignment
} from "@/runtime/workflow/workflowStateResolver";
import {
  WORKFLOW_POLICY_REGISTRY,
  WORKFLOW_POLICY_VERSION
} from "@/runtime/workflow/workflowPolicyRegistry";
import type { WorkflowAgentRole, WorkflowKind } from "@/runtime/workflow/workflowContracts";

function contract(partial: Partial<ActiveTaskContract> = {}): ActiveTaskContract {
  return {
    workspaceId: "ws-1",
    workspaceRoot: "C:/tmp/ws",
    workflowId: "wf-1",
    runId: "run-1",
    workflowKind: "code_change",
    originalRequest: "baue feature",
    confirmedGoal: "feature",
    acceptanceCriteria: [],
    currentPhase: "planning",
    assignedAgent: "planner",
    effectiveAgent: "planner",
    taskType: "large_code_change",
    policyVersion: WORKFLOW_POLICY_VERSION,
    modelRole: "planner",
    toolProfile: "ask",
    transitionVersion: 1,
    answeredQuestions: [],
    answeredFields: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial
  };
}

describe("workflow policy registry", () => {
  it("keeps every default and allowed agent valid for the invariant", () => {
    for (const workflow of Object.values(WORKFLOW_POLICY_REGISTRY)) {
      expect(workflow.phases[workflow.initialPhase]).toBeTruthy();
      for (const phasePolicy of Object.values(workflow.phases)) {
        if (!phasePolicy) continue;
        expect(phasePolicy.allowedAgents.length).toBeGreaterThan(0);
        expect(phasePolicy.allowedAgents).toContain(phasePolicy.defaultAgent);
        expect(phasePolicy.modelRole).toBeTruthy();
        expect(phasePolicy.toolProfile).toBeTruthy();
        expect(assertValidPhaseAgentPair(phasePolicy.phase, phasePolicy.defaultAgent).ok).toBe(true);
        for (const agent of phasePolicy.allowedAgents) {
          expect(assertValidPhaseAgentPair(phasePolicy.phase, agent).ok).toBe(true);
        }
      }
      for (const transition of workflow.transitions) {
        expect(workflow.phases[transition.from]).toBeTruthy();
        expect(workflow.phases[transition.to]).toBeTruthy();
      }
    }
  });
});

describe("resolveCanonicalWorkflowAssignment", () => {
  it("routes source backup to workspace_backup planning and never debugger", () => {
    const assignment = resolveCanonicalWorkflowAssignment({
      userMessage: 'Erstelle ein "only source Backup" vom Projekt Ordner',
      classifiedIntent: "implement",
      classifiedTaskType: "large_code_change"
    });

    expect(assignment.workflowKind).toBe("workspace_backup");
    expect(assignment.phase).toBe("planning");
    expect(assignment.effectiveAgent).toBe("planner");
  });

  it("routes debugging to diagnosis/debugger by default", () => {
    const assignment = resolveCanonicalWorkflowAssignment({
      userMessage: "Analysiere, warum npm run build fehlschlägt.",
      classifiedIntent: "fix",
      classifiedTaskType: "debugging"
    });

    expect(assignment.workflowKind).toBe("debug_fix");
    expect(assignment.phase).toBe("diagnosis");
    expect(assignment.effectiveAgent).toBe("debugger");
  });

  it("routes fix findings into review_remediation planning", () => {
    const assignment = resolveCanonicalWorkflowAssignment({
      userMessage: "fix findings",
      classifiedIntent: "fix_review_findings",
      classifiedTaskType: "planning"
    });

    expect(assignment.workflowKind).toBe("review_remediation");
    expect(assignment.phase).toBe("planning");
    expect(assignment.effectiveAgent).toBe("planner");
  });

  it("normalizes legacy implementation+debugger mismatch to a valid assignment", () => {
    const assignment = resolveCanonicalWorkflowAssignment({
      userMessage: "Behebe den Fehler",
      classifiedIntent: "fix",
      classifiedTaskType: "debugging",
      explicitWorkflowKind: "debug_fix",
      requestedPhase: "implementation",
      requestedAgent: "debugger"
    });

    expect(assignment.phase).toBe("implementation");
    expect(assignment.effectiveAgent).toBe("coder");
    expect(assignment.normalized).toBe(true);
    expect(assignment.normalizationReasons).toContain("requested_agent_not_allowed_for_phase");
  });

  it("does not inherit a stale finished contract for a new backup task", () => {
    const assignment = resolveCanonicalWorkflowAssignment({
      userMessage: 'Erstelle ein "only source Backup" vom Projekt Ordner',
      classifiedIntent: "implement",
      classifiedTaskType: "large_code_change",
      activeContract: contract({
        workflowKind: "debug_fix",
        currentPhase: "failed",
        assignedAgent: "debugger",
        effectiveAgent: "debugger",
        taskType: "debugging"
      })
    });

    expect(assignment.workflowKind).toBe("workspace_backup");
    expect(assignment.source).toBe("deterministic_operation");
  });

  it("routes an explicit review request to reviewer even with a stale non-review contract open", () => {
    // Regression: a real interactive golden-path run found that
    // "Mache einen vollständigen Repository Review." never triggered the
    // review orchestrator when a prior casual-chat active task contract was
    // still open. classifiedTaskType correctly said "review", but
    // inferWorkflowKind reused the stale contract's workflowKind ("chat")
    // because the message isn't an explicit "Neue Aufgabe:"-style new-task
    // trigger, so effectiveAgent stayed "runtime_chat" instead of "reviewer".
    const assignment = resolveCanonicalWorkflowAssignment({
      userMessage: "Mache einen vollständigen Repository Review.",
      classifiedIntent: "review",
      classifiedTaskType: "review",
      activeContract: contract({
        workflowKind: "chat",
        currentPhase: "clarification",
        assignedAgent: "runtime_chat",
        effectiveAgent: "runtime_chat",
        taskType: "casual_chat"
      })
    });

    expect(assignment.workflowKind).toBe("review");
    expect(assignment.phase).toBe("review");
    expect(assignment.effectiveAgent).toBe("reviewer");
  });

  it("keeps every sampled combination on a valid phase-agent pair", () => {
    const taskTypes = [
      "casual_chat",
      "normal_chat",
      "planning",
      "architecture",
      "small_code_change",
      "large_code_change",
      "debugging",
      "review",
      "test_analysis",
      "refactoring"
    ] as const;
    const intents = [
      "explain_only",
      "plan_only",
      "inspect",
      "implement",
      "fix_review_findings",
      "fix",
      "refactor",
      "review",
      "test",
      "build"
    ] as const;
    const phases = [
      null,
      "clarification",
      "diagnosis",
      "planning",
      "implementation",
      "testing",
      "verification",
      "review"
    ] as const;
    const agents = [
      null,
      "runtime_chat",
      "planner",
      "debugger",
      "coder",
      "tester",
      "reviewer"
    ] as const satisfies readonly (WorkflowAgentRole | null)[];

    let checked = 0;
    for (const taskType of taskTypes) {
      for (const intent of intents) {
        for (const requestedPhase of phases) {
          for (const requestedAgent of agents) {
            const assignment = resolveCanonicalWorkflowAssignment({
              userMessage: `${intent} ${taskType}`,
              classifiedIntent: intent,
              classifiedTaskType: taskType,
              requestedPhase,
              requestedAgent
            });
            expect(assertValidPhaseAgentPair(assignment.phase, assignment.effectiveAgent).ok).toBe(true);
            checked += 1;
          }
        }
      }
    }

    expect(checked).toBeGreaterThanOrEqual(500);
  });
});
