/**
 * Hard phase ↔ agent pairing rules for workflow continuity.
 */

import type { ActiveTaskPhase } from "@/services/activeTaskContract";

export type PhaseAgentRole =
  | "planner"
  | "coder"
  | "tester"
  | "test_agent"
  | "reviewer"
  | "debugger"
  | "docs"
  | "runtime_chat"
  | "default"
  | string;

export type PhaseAgentPairResult =
  | { ok: true }
  | { ok: false; reason: string; expected: string[] };

const PLANNER_PHASES: ReadonlySet<ActiveTaskPhase> = new Set([
  "clarification",
  "planning",
  "awaiting_plan_approval",
  "awaiting_dependency_approval"
]);

/** Chat broker role `default` is the runtime_chat path for phase pairing. */
function normalizePhaseAgent(agent: PhaseAgentRole | null | undefined): string {
  const normalized = String(agent ?? "").toLowerCase();
  if (normalized === "default") {
    return "runtime_chat";
  }
  return normalized;
}

export function assertValidPhaseAgentPair(
  phase: ActiveTaskPhase | string | null | undefined,
  agent: PhaseAgentRole | null | undefined
): PhaseAgentPairResult {
  if (!phase || !agent) {
    return { ok: true };
  }

  const normalizedAgent = normalizePhaseAgent(agent);

  if (phase === "implementation" || phase === "executing" || phase === "awaiting_patch_approval") {
    if (normalizedAgent === "coder") {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `invalid_phase_agent_pair phase=${phase} agent=${agent}`,
      expected: ["coder"]
    };
  }

  if (phase === "planning" || phase === "awaiting_plan_approval" || phase === "clarification") {
    // planner = structured workflows; runtime_chat/default = chat clarification path
    if (normalizedAgent === "planner" || normalizedAgent === "runtime_chat") {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `invalid_phase_agent_pair phase=${phase} agent=${agent}`,
      expected: ["planner", "runtime_chat", "default"]
    };
  }

  if (phase === "testing") {
    if (
      normalizedAgent === "coder" ||
      normalizedAgent === "tester" ||
      normalizedAgent === "test_agent"
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `invalid_phase_agent_pair phase=${phase} agent=${agent}`,
      expected: ["coder", "tester", "test_agent"]
    };
  }

  if (phase === "diagnosis") {
    if (normalizedAgent === "debugger") {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `invalid_phase_agent_pair phase=${phase} agent=${agent}`,
      expected: ["debugger"]
    };
  }

  if (phase === "verification") {
    if (normalizedAgent === "reviewer") {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `invalid_phase_agent_pair phase=${phase} agent=${agent}`,
      expected: ["reviewer"]
    };
  }

  if (phase === "review") {
    if (normalizedAgent === "reviewer") {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `invalid_phase_agent_pair phase=${phase} agent=${agent}`,
      expected: ["reviewer"]
    };
  }

  if (PLANNER_PHASES.has(phase as ActiveTaskPhase)) {
    return { ok: true };
  }

  return { ok: true };
}
