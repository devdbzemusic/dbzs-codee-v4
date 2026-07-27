import type { ModelTargetAgent } from "@dbzs/shared";
import type { ModelTargetAgent as BrokerModelTargetAgent } from "@/services/modelSelectionBroker";

export function mapBrokerAgentToShared(agent: BrokerModelTargetAgent): ModelTargetAgent {
  switch (agent) {
    case "planner":
      return "planner";
    case "coder":
      return "coder";
    case "reviewer":
      return "reviewer";
    case "debugger":
      return "debugger";
    default:
      return "runtime_chat";
  }
}

export function mapWorkflowAgentToShared(
  agent: "runtime_chat" | "planner" | "debugger" | "coder" | "tester" | "reviewer"
): ModelTargetAgent {
  switch (agent) {
    case "planner":
      return "planner";
    case "debugger":
      return "debugger";
    case "reviewer":
      return "reviewer";
    case "tester":
    case "coder":
      return "coder";
    case "runtime_chat":
    default:
      return "runtime_chat";
  }
}
