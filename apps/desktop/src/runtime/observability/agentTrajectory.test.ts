import { describe, expect, it } from "vitest";
import {
  createAgentTrajectory,
  finalizeTrajectory,
  recordTrajectoryTurn
} from "./agentTrajectory";

describe("agentTrajectory", () => {
  it("records turns and finalizes status", () => {
    const traj = createAgentTrajectory("run-1", "goal", "agent");
    recordTrajectoryTurn(traj, 1, 120, [{ name: "read_file", status: "ok", durationMs: 10 }]);
    recordTrajectoryTurn(traj, 2, 220, [{ name: "apply_patch", status: "ok", durationMs: 20 }]);
    const done = finalizeTrajectory(traj, "completed");

    expect(done.turns).toHaveLength(2);
    expect(done.totalToolCalls).toBe(2);
    expect(done.status).toBe("completed");
    expect(done.finishedAt).toBeTruthy();
  });
});
