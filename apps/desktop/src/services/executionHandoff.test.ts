import { describe, expect, it } from "vitest";
import {
  buildExecutionHandoff,
  handoffTargetAgent,
  mapExecutionIntentToHandoffIntent
} from "@/services/executionHandoff";

describe("executionHandoff", () => {
  it("maps implement intents and targets coder", () => {
    expect(mapExecutionIntentToHandoffIntent("implement")).toBe("implement");
    expect(mapExecutionIntentToHandoffIntent("explain_only")).toBeNull();
    const handoff = buildExecutionHandoff({
      runId: "run-1",
      workflowId: "wf-1",
      workspaceId: "ws-1",
      approvedPlanId: "plan-1",
      executionIntent: "implement",
      coderModelId: "coder-model"
    });
    expect(handoff.fromAgent).toBe("planner");
    expect(handoff.toAgent).toBe("coder");
    expect(handoffTargetAgent(handoff)).toBe("coder");
  });
});
