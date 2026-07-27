export type ExecPolicyDecision = "allow" | "prompt" | "forbidden";

export interface ExecPolicyRule {
  id: string;
  pattern: RegExp;
  decision: ExecPolicyDecision;
  reason: string;
}

export interface ExecPolicyEvaluation {
  decision: ExecPolicyDecision;
  ruleId?: string;
  reason?: string;
}

const DEFAULT_RULES: ExecPolicyRule[] = [
  {
    id: "forbid-rm-rf",
    pattern: /\brm\s+(-[^\s]*\s+)*-rf\b/i,
    decision: "forbidden",
    reason: "Destructive recursive delete is forbidden."
  },
  {
    id: "forbid-format",
    pattern: /\b(format\s+[a-z]:|mkfs\.|diskpart)\b/i,
    decision: "forbidden",
    reason: "Disk format commands are forbidden."
  },
  {
    id: "forbid-pipe-shell",
    pattern: /\|\s*(sh|bash|zsh|powershell|cmd)\b/i,
    decision: "forbidden",
    reason: "Piping into a shell is forbidden."
  },
  {
    id: "forbid-admin-elevation",
    pattern: /\b(runas|sudo\s+su|Start-Process\s+-Verb\s+RunAs)\b/i,
    decision: "forbidden",
    reason: "Admin elevation commands are forbidden."
  },
  {
    id: "forbid-global-npm-install",
    pattern: /\bnpm\s+(install|i|add)\s+(-g|--global)\b/i,
    decision: "forbidden",
    reason: "Global npm installs are forbidden. Use a local project dependency after approval."
  },
  {
    id: "forbid-global-pnpm-add",
    pattern: /\bpnpm\s+(add|install|i)\s+(-g|--global)\b/i,
    decision: "forbidden",
    reason: "Global pnpm installs are forbidden. Use a local project dependency after approval."
  },
  {
    id: "forbid-global-yarn-add",
    pattern: /\byarn\s+global\s+add\b/i,
    decision: "forbidden",
    reason: "Global yarn installs are forbidden. Use a local project dependency after approval."
  },
  {
    id: "forbid-global-bun-install",
    pattern: /\bbun\s+(add|install)\s+(-g|--global)\b/i,
    decision: "forbidden",
    reason: "Global bun installs are forbidden. Use a local project dependency after approval."
  },
  {
    id: "prompt-local-dependency-install",
    pattern: /\b(npm\s+(install|i|add)|pnpm\s+(add|install|i)|yarn\s+add|bun\s+(add|install))\b/i,
    decision: "prompt",
    reason: "Dependency install changes lockfiles/node_modules and needs approval."
  },
  {
    id: "prompt-destructive-unlink",
    pattern: /\b(del\s+\/[sfq]|Remove-Item\s+-Recurse|unlink\s+\()/i,
    decision: "prompt",
    reason: "Potentially destructive delete requires approval."
  }
];

export class ExecPolicy {
  constructor(private readonly rules: ExecPolicyRule[] = DEFAULT_RULES) {}

  evaluate(command: string): ExecPolicyEvaluation {
    const normalized = command.trim();
    if (!normalized) {
      return { decision: "forbidden", reason: "Empty command." };
    }

    for (const rule of this.rules) {
      if (rule.pattern.test(normalized)) {
        return {
          decision: rule.decision,
          ruleId: rule.id,
          reason: rule.reason
        };
      }
    }

    return { decision: "allow" };
  }
}

export const defaultExecPolicy = new ExecPolicy();

export function evaluateTerminalCommandPolicy(command: string): ExecPolicyEvaluation {
  return defaultExecPolicy.evaluate(command);
}
