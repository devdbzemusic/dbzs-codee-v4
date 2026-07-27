import { beforeEach, describe, expect, it, vi } from "vitest";
import { trajectoryService } from "./trajectoryService";

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    listJobTrajectory: vi.fn(),
    listRecentTrajectories: vi.fn()
  }
}));

import { backendClient } from "@/services/backendClient";

describe("trajectoryService", () => {
  beforeEach(() => {
    vi.mocked(backendClient.listJobTrajectory).mockReset();
    vi.mocked(backendClient.listRecentTrajectories).mockReset();
  });

  it("maps job trajectory events from snake_case API response", async () => {
    vi.mocked(backendClient.listJobTrajectory).mockResolvedValue({
      schema_version: "atif-light-v1",
      events: [
        {
          schema_version: "atif-light-v1",
          id: "traj_abc",
          job_id: "job-1",
          step_number: 2,
          event_type: "review_gate_created",
          agent_role: null,
          model: null,
          summary: "Review gate created for proposed changes",
          files: ["backend/app/main.py"],
          risk_level: "high",
          metadata: { review_gate_id: "rg-job-1-2" },
          created_at: "2026-06-18T12:00:00Z"
        }
      ]
    });

    const events = await trajectoryService.listJobTrajectory("job-1");

    expect(backendClient.listJobTrajectory).toHaveBeenCalledWith("job-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "traj_abc",
      jobId: "job-1",
      stepNumber: 2,
      eventType: "review_gate_created",
      summary: "Review gate created for proposed changes",
      files: ["backend/app/main.py"],
      riskLevel: "high",
      createdAt: "2026-06-18T12:00:00Z"
    });
  });

  it("loads recent trajectories with limit query param", async () => {
    vi.mocked(backendClient.listRecentTrajectories).mockResolvedValue({
      schema_version: "atif-light-v1",
      events: []
    });

    await trajectoryService.listRecentTrajectories(25);

    expect(backendClient.listRecentTrajectories).toHaveBeenCalledWith(25);
  });

  it("throws when backend bridge rejects", async () => {
    vi.mocked(backendClient.listJobTrajectory).mockRejectedValue(
      new Error("Job-Trajectory konnte nicht geladen werden (500).")
    );

    await expect(trajectoryService.listJobTrajectory("job-1")).rejects.toThrow(
      "Job-Trajectory konnte nicht geladen werden (500)."
    );
  });
});
