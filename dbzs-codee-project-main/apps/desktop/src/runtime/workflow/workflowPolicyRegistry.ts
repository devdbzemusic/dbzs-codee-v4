import type {
  CanonicalWorkflowPhase,
  WorkflowKind,
  WorkflowPhasePolicy,
  WorkflowPolicy,
  WorkflowTransitionPolicy
} from "@/runtime/workflow/workflowContracts";

export const WORKFLOW_POLICY_VERSION = 1;

function phase(
  input: Omit<WorkflowPhasePolicy, "terminal"> & { terminal?: boolean }
): WorkflowPhasePolicy {
  return {
    ...input,
    terminal: input.terminal === true
  };
}

function transition(
  from: CanonicalWorkflowPhase,
  event: WorkflowTransitionPolicy["event"],
  to: CanonicalWorkflowPhase
): WorkflowTransitionPolicy {
  return { from, event, to };
}

export const WORKFLOW_POLICY_REGISTRY: Record<WorkflowKind, WorkflowPolicy> = {
  chat: {
    kind: "chat",
    initialPhase: "clarification",
    phases: {
      clarification: phase({
        phase: "clarification",
        allowedAgents: ["runtime_chat", "planner"],
        defaultAgent: "runtime_chat",
        modelRole: "chat",
        toolProfile: "ask"
      }),
      completed: phase({
        phase: "completed",
        allowedAgents: ["runtime_chat"],
        defaultAgent: "runtime_chat",
        modelRole: "chat",
        toolProfile: "ask",
        terminal: true
      })
    },
    transitions: [transition("clarification", "information_complete", "completed")]
  },
  planning: {
    kind: "planning",
    initialPhase: "planning",
    phases: {
      planning: phase({
        phase: "planning",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      }),
      awaiting_plan_approval: phase({
        phase: "awaiting_plan_approval",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      }),
      completed: phase({
        phase: "completed",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask",
        terminal: true
      })
    },
    transitions: [
      transition("planning", "plan_created", "awaiting_plan_approval"),
      transition("awaiting_plan_approval", "plan_approved", "completed")
    ]
  },
  code_change: {
    kind: "code_change",
    initialPhase: "planning",
    phases: {
      planning: phase({
        phase: "planning",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      }),
      awaiting_plan_approval: phase({
        phase: "awaiting_plan_approval",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      }),
      implementation: phase({
        phase: "implementation",
        allowedAgents: ["coder"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      executing: phase({
        phase: "executing",
        allowedAgents: ["coder"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      awaiting_patch_approval: phase({
        phase: "awaiting_patch_approval",
        allowedAgents: ["coder"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      testing: phase({
        phase: "testing",
        allowedAgents: ["coder", "tester"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      verification: phase({
        phase: "verification",
        allowedAgents: ["reviewer"],
        defaultAgent: "reviewer",
        modelRole: "review",
        toolProfile: "ask"
      }),
      completed: phase({
        phase: "completed",
        allowedAgents: ["reviewer"],
        defaultAgent: "reviewer",
        modelRole: "review",
        toolProfile: "ask",
        terminal: true
      })
    },
    transitions: [
      transition("planning", "plan_created", "awaiting_plan_approval"),
      transition("awaiting_plan_approval", "plan_approved", "implementation"),
      transition("implementation", "patch_proposed", "awaiting_patch_approval"),
      transition("awaiting_patch_approval", "patch_approved", "executing"),
      transition("executing", "implementation_completed", "testing"),
      transition("testing", "checks_passed", "verification"),
      transition("verification", "review_passed", "completed")
    ]
  },
  refactoring: {
    kind: "refactoring",
    initialPhase: "planning",
    phases: {},
    transitions: []
  },
  debug_fix: {
    kind: "debug_fix",
    initialPhase: "diagnosis",
    phases: {
      diagnosis: phase({
        phase: "diagnosis",
        allowedAgents: ["debugger"],
        defaultAgent: "debugger",
        modelRole: "debug",
        toolProfile: "ask"
      }),
      planning: phase({
        phase: "planning",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      }),
      awaiting_plan_approval: phase({
        phase: "awaiting_plan_approval",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      }),
      implementation: phase({
        phase: "implementation",
        allowedAgents: ["coder"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      executing: phase({
        phase: "executing",
        allowedAgents: ["coder"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      testing: phase({
        phase: "testing",
        allowedAgents: ["coder", "tester"],
        defaultAgent: "tester",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      verification: phase({
        phase: "verification",
        allowedAgents: ["reviewer"],
        defaultAgent: "reviewer",
        modelRole: "review",
        toolProfile: "ask"
      })
    },
    transitions: [
      transition("diagnosis", "information_complete", "planning"),
      transition("planning", "plan_created", "awaiting_plan_approval"),
      transition("awaiting_plan_approval", "plan_approved", "implementation"),
      transition("implementation", "implementation_completed", "testing"),
      transition("testing", "checks_failed", "diagnosis"),
      transition("testing", "checks_passed", "verification")
    ]
  },
  review: {
    kind: "review",
    initialPhase: "review",
    phases: {
      review: phase({
        phase: "review",
        allowedAgents: ["reviewer"],
        defaultAgent: "reviewer",
        modelRole: "review",
        toolProfile: "ask"
      }),
      completed: phase({
        phase: "completed",
        allowedAgents: ["reviewer"],
        defaultAgent: "reviewer",
        modelRole: "review",
        toolProfile: "ask",
        terminal: true
      })
    },
    transitions: [transition("review", "review_passed", "completed")]
  },
  review_remediation: {
    kind: "review_remediation",
    initialPhase: "planning",
    phases: {
      planning: phase({
        phase: "planning",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      }),
      awaiting_plan_approval: phase({
        phase: "awaiting_plan_approval",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      }),
      implementation: phase({
        phase: "implementation",
        allowedAgents: ["coder"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      executing: phase({
        phase: "executing",
        allowedAgents: ["coder"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      testing: phase({
        phase: "testing",
        allowedAgents: ["coder", "tester"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      verification: phase({
        phase: "verification",
        allowedAgents: ["reviewer"],
        defaultAgent: "reviewer",
        modelRole: "review",
        toolProfile: "ask"
      })
    },
    transitions: [
      transition("planning", "plan_created", "awaiting_plan_approval"),
      transition("awaiting_plan_approval", "plan_approved", "implementation"),
      transition("implementation", "implementation_completed", "testing"),
      transition("testing", "checks_passed", "verification")
    ]
  },
  test: {
    kind: "test",
    initialPhase: "testing",
    phases: {
      testing: phase({
        phase: "testing",
        allowedAgents: ["tester", "coder"],
        defaultAgent: "tester",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      completed: phase({
        phase: "completed",
        allowedAgents: ["tester"],
        defaultAgent: "tester",
        modelRole: "review",
        toolProfile: "ask",
        terminal: true
      })
    },
    transitions: [transition("testing", "checks_passed", "completed")]
  },
  build: {
    kind: "build",
    initialPhase: "planning",
    phases: {},
    transitions: []
  },
  workspace_backup: {
    kind: "workspace_backup",
    initialPhase: "planning",
    phases: {
      planning: phase({
        phase: "planning",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      }),
      awaiting_plan_approval: phase({
        phase: "awaiting_plan_approval",
        allowedAgents: ["planner"],
        defaultAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      }),
      implementation: phase({
        phase: "implementation",
        allowedAgents: ["coder"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      testing: phase({
        phase: "testing",
        allowedAgents: ["coder", "tester"],
        defaultAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      }),
      verification: phase({
        phase: "verification",
        allowedAgents: ["reviewer"],
        defaultAgent: "reviewer",
        modelRole: "review",
        toolProfile: "ask"
      })
    },
    transitions: [
      transition("planning", "plan_created", "awaiting_plan_approval"),
      transition("awaiting_plan_approval", "plan_approved", "implementation"),
      transition("implementation", "implementation_completed", "testing"),
      transition("testing", "checks_passed", "verification")
    ]
  },
  workspace_maintenance: {
    kind: "workspace_maintenance",
    initialPhase: "planning",
    phases: {},
    transitions: []
  }
};

for (const alias of ["refactoring", "build", "workspace_maintenance"] as const) {
  WORKFLOW_POLICY_REGISTRY[alias] = {
    ...WORKFLOW_POLICY_REGISTRY.code_change,
    kind: alias
  };
}
