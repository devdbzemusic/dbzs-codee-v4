import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrajectoryMiniPanel } from "./TrajectoryMiniPanel";
import { trajectoryService } from "@/services/trajectoryService";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock("@/services/trajectoryService", () => ({
  trajectoryService: {
    listJobTrajectory: vi.fn()
  }
}));

describe("TrajectoryMiniPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(trajectoryService.listJobTrajectory).mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders nothing when jobId is null", async () => {
    await act(async () => {
      root.render(<TrajectoryMiniPanel jobId={null} />);
    });

    expect(container.textContent).toBe("");
  });

  it("renders latest trajectory events for a job", async () => {
    vi.mocked(trajectoryService.listJobTrajectory).mockResolvedValue([
      {
        id: "traj_1",
        jobId: "job-1",
        stepNumber: 1,
        eventType: "step_started",
        agentRole: null,
        model: null,
        summary: "Autonomous loop step started",
        files: [],
        riskLevel: null,
        metadata: {},
        createdAt: "2026-06-18T12:00:00Z"
      },
      {
        id: "traj_2",
        jobId: "job-1",
        stepNumber: 1,
        eventType: "completed",
        agentRole: null,
        model: null,
        summary: "goal_achieved",
        files: [],
        riskLevel: null,
        metadata: {},
        createdAt: "2026-06-18T12:05:00Z"
      }
    ]);

    await act(async () => {
      root.render(<TrajectoryMiniPanel jobId="job-1" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Agent Trajectory");
    expect(container.textContent).toContain("completed");
    expect(container.textContent).toContain("goal_achieved");
    expect(container.textContent).toContain("step started");
  });
});
