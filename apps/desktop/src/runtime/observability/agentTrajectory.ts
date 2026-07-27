import type { ToolName } from "@/runtime/tool/toolContracts";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";

export interface TrajectoryToolRecord {
  name: ToolName;
  status: string;
  durationMs: number;
}

export interface TrajectoryTurnRecord {
  turn: number;
  assistantChars: number;
  toolCalls: TrajectoryToolRecord[];
}

export interface AgentTrajectory {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  profile: AgentToolProfile;
  goal: string;
  turns: TrajectoryTurnRecord[];
  totalToolCalls: number;
  status: "completed" | "cancelled" | "budget_exceeded" | "failed";
  error?: string;
}

export function createAgentTrajectory(
  runId: string,
  goal: string,
  profile: AgentToolProfile
): AgentTrajectory {
  return {
    runId,
    startedAt: new Date().toISOString(),
    profile,
    goal,
    turns: [],
    totalToolCalls: 0,
    status: "completed"
  };
}

export function recordTrajectoryTurn(
  trajectory: AgentTrajectory,
  turn: number,
  assistantChars: number,
  toolCalls: TrajectoryToolRecord[]
): void {
  trajectory.turns.push({ turn, assistantChars, toolCalls });
  trajectory.totalToolCalls += toolCalls.length;
}

export function finalizeTrajectory(
  trajectory: AgentTrajectory,
  status: AgentTrajectory["status"],
  error?: string
): AgentTrajectory {
  trajectory.finishedAt = new Date().toISOString();
  trajectory.status = status;
  trajectory.error = error;
  return trajectory;
}

export function exportTrajectoryJson(trajectory: AgentTrajectory): string {
  return JSON.stringify(trajectory, null, 2);
}
