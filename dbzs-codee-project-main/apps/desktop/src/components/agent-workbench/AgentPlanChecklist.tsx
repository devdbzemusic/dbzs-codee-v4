import type { AgentStep, AgentStepStatus } from "@dbzs/shared";

const STEP_STATUS_CLASS: Record<AgentStepStatus, string> = {
  pending: "text-dbzs-muted",
  active: "text-dbzs-cyan",
  blocked: "text-dbzs-amber",
  waiting_review: "text-dbzs-amber",
  completed: "text-dbzs-green",
  failed: "text-dbzs-red",
  skipped: "text-dbzs-muted",
  retrying: "text-dbzs-amber"
};

export type AgentPlanChecklistProps = {
  steps: AgentStep[];
  currentStepId: string | null;
};

export function AgentPlanChecklist({ steps, currentStepId }: AgentPlanChecklistProps) {
  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-3">
      <h3 className="text-sm font-medium text-dbzs-text">Plan</h3>
      <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
        {steps.length === 0 ? (
          <div className="text-xs text-dbzs-muted">Noch keine Steps geplant.</div>
        ) : (
          steps.map((step) => {
            const isCurrent = step.id === currentStepId;
            return (
              <div
                className={`border p-2 text-[11px] ${
                  isCurrent ? "border-dbzs-cyan/50 bg-dbzs-cyan/5" : "border-dbzs-border bg-dbzs-bg"
                }`}
                key={step.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-dbzs-text">
                    {step.ordinal}. {step.title}
                  </div>
                  <span className={STEP_STATUS_CLASS[step.status]}>{step.status}</span>
                </div>
                {step.description ? (
                  <div className="mt-1 text-dbzs-muted">{step.description}</div>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-dbzs-muted">
                  <span>Rolle: {step.role ?? "-"}</span>
                  <span>Versuche: {step.attemptCount}/{step.maxAttempts}</span>
                  {step.dependsOn.length > 0 ? (
                    <span>Abhängigkeiten: {step.dependsOn.join(", ")}</span>
                  ) : null}
                </div>
                {step.errorMessage ? (
                  <div className="mt-1 text-dbzs-red">{step.errorMessage}</div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
