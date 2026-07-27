import { useMemo, useState } from "react";
import type {
  AgentRecord,
  GitDiffSummary,
  GitRepositoryStatus,
  PlannerPlan,
  PlannerWorkspaceContext,
  ProjectMemory,
  WorkspaceProjectFile
} from "@dbzs/shared";
import { isContextPathAllowed } from "@dbzs/shared";
import { PlannerAgentService, createPlannerWorkspaceContext } from "@/services/plannerAgentService";

const IMPORTANT_FILE_NAMES = new Set([
  "README.md",
  "AGENTS.md",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "tsconfig.json",
  "vite.config.ts",
  "electron.vite.config.ts"
]);

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function isContextEligible(file: WorkspaceProjectFile): boolean {
  return isContextPathAllowed(file.relativePath);
}

function buildWorkspaceContext(
  workspaceRoot: string | null,
  workspaceName: string | null,
  workspaceFiles: WorkspaceProjectFile[],
  agents: AgentRecord[],
  prioritizedFiles: string[]
): PlannerWorkspaceContext | null {
  if (!workspaceRoot) {
    return null;
  }

  const eligibleFiles = workspaceFiles.filter(isContextEligible);
  const prioritized = eligibleFiles.filter((file) => prioritizedFiles.includes(file.relativePath));
  const sampledFiles = [...prioritized, ...eligibleFiles]
    .filter((file) => IMPORTANT_FILE_NAMES.has(file.name) || /(^|[\\/])(main|app|index|config|settings)\.(py|ts|tsx|js|json)$/i.test(file.relativePath))
    .slice(0, 6)
    .map((file) => ({
      path: file.path,
      relativePath: file.relativePath,
      language: file.language,
      content: ""
    }));

  return createPlannerWorkspaceContext(
    workspaceRoot,
    workspaceName ?? normalizePath(workspaceRoot).split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace",
    eligibleFiles.slice(0, 80).map((file) => file.relativePath),
    sampledFiles,
    agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status.state
    }))
  );
}

interface PlannerAgentPanelProps {
  agents: AgentRecord[];
  workspaceFiles: WorkspaceProjectFile[];
  workspaceName: string | null;
  workspaceRoot: string | null;
  projectMemory?: ProjectMemory | null;
  relevantFiles?: string[];
  gitRepositoryStatus?: GitRepositoryStatus | null;
  gitDiffSummary?: GitDiffSummary[];
  onPlanCreated?: (plan: PlannerPlan) => void;
}

export function PlannerAgentPanel({
  agents,
  workspaceFiles,
  workspaceName,
  workspaceRoot,
  projectMemory,
  relevantFiles = [],
  gitRepositoryStatus,
  gitDiffSummary = [],
  onPlanCreated
}: PlannerAgentPanelProps) {
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<PlannerPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const service = useMemo(() => new PlannerAgentService(), []);

  const handleCreatePlan = () => {
    const workspaceContext = buildWorkspaceContext(workspaceRoot, workspaceName, workspaceFiles, agents, relevantFiles);
    if (!workspaceContext) {
      setError("Kein Workspace aktiv.");
      return;
    }

    try {
      const nextPlan = service.createPlan(goal, workspaceContext, projectMemory, gitRepositoryStatus, gitDiffSummary);
      const validation = service.validatePlan(nextPlan);
      setPlan(nextPlan);
      setValidationErrors(validation.errors);
      setError(null);
      onPlanCreated?.(nextPlan);
    } catch (caughtError) {
      setPlan(null);
      setValidationErrors([]);
      setError(caughtError instanceof Error ? caughtError.message : "Plan konnte nicht erstellt werden");
    }
  };

  const planSummary = plan ? service.summarizePlan(plan) : "Noch kein Plan erstellt.";

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Planner Agent</h3>
          <p className="mt-1 text-[11px] text-dbzs-muted">
            Analysiert Ziele und erzeugt strukturierte Entwicklungsplaene ohne Code- oder Dateioperationen.
          </p>
          <p className="mt-1 text-[11px] text-dbzs-amber">
            Hinweis: Primärer Pfad ist Runtime Chat (Agent-Mode + Turn-Loop). Planner bleibt als Hilfsmittel.
          </p>
        </div>
        <button
          className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
          disabled={goal.trim().length === 0}
          onClick={handleCreatePlan}
          type="button"
        >
          Plan erstellen
        </button>
      </div>

      <textarea
        className="mt-3 h-24 w-full resize-y border border-dbzs-border bg-dbzs-bg p-2 text-xs text-dbzs-text"
        onChange={(event) => setGoal(event.currentTarget.value)}
        placeholder="Welches Ziel soll der Planner strukturieren?"
        value={goal}
      />

      {error ? <p className="mt-2 text-xs text-dbzs-red">{error}</p> : null}

      <div className="mt-3 text-[11px] text-dbzs-muted">
        <div>Plan Summary: {planSummary}</div>
        {plan ? <div className="mt-1">Bereiche: {plan.affectedAreas.join(", ") || "keine"}</div> : null}
      </div>

      {plan ? (
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Tasks</div>
            <div className="mt-1 space-y-2">
              {plan.tasks.map((task) => (
                <div className="border border-dbzs-border bg-dbzs-bg p-2 text-[11px] text-dbzs-text" key={task.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{task.title}</div>
                    <span className="text-dbzs-muted">{task.priority} · {task.estimatedComplexity}</span>
                  </div>
                  <div className="mt-1 text-dbzs-muted">{task.description}</div>
                  <div className="mt-1 text-dbzs-muted">Dateien: {task.affectedFiles.join(", ") || "keine"}</div>
                  <div className="mt-1 text-dbzs-muted">Dependencies: {task.dependencies.join(", ") || "keine"}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Risiken</div>
            <ul className="mt-1 space-y-1 text-[11px] text-dbzs-text">
              {plan.risks.map((risk) => (
                <li className="border border-dbzs-border bg-dbzs-bg px-2 py-1" key={risk}>
                  {risk}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Betroffene Bereiche</div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-dbzs-text">
              {plan.affectedAreas.map((area) => (
                <span className="border border-dbzs-border bg-dbzs-bg px-2 py-1" key={area}>
                  {area}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Annahmen</div>
            <ul className="mt-1 space-y-1 text-[11px] text-dbzs-text">
              {plan.assumptions.map((assumption) => (
                <li className="border border-dbzs-border bg-dbzs-bg px-2 py-1" key={assumption}>
                  {assumption}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {validationErrors.length > 0 ? (
        <div className="mt-3 border border-dbzs-amber/40 bg-dbzs-amber/10 p-2 text-[11px] text-dbzs-text">
          <div className="font-medium text-dbzs-amber">Validierungshinweise</div>
          <ul className="mt-1 space-y-1">
            {validationErrors.map((validationError) => (
              <li key={validationError}>{validationError}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
