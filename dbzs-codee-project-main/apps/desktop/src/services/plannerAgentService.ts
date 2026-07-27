import type {
  GitDiffSummary,
  GitRepositoryStatus,
  PlannerAgentReference,
  PlannerPlan,
  ProjectMemory,
  PlannerTask,
  PlannerWorkspaceContext,
  PlannedExecution
} from "@dbzs/shared";

const MAX_TASKS_FOR_SMALL_GOAL = 3;
const MAX_TASKS_FOR_LARGE_GOAL = 5;

export class PlannerAgentError extends Error {
  readonly code: "EMPTY_GOAL" | "INVALID_PLAN";

  constructor(code: "EMPTY_GOAL" | "INVALID_PLAN", message: string) {
    super(message);
    this.name = "PlannerAgentError";
    this.code = code;
  }
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
}

interface AreaProfile {
  area: string;
  files: string[];
  title: string;
  description: string;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function goalWordCount(goal: string): number {
  return normalizeText(goal).split(/\s+/).filter(Boolean).length;
}

function isLargeGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  return goalWordCount(goal) >= 14 || /\b(und|danach|anschliessend|then|multiple|mehrere)\b/i.test(lower) || lower.includes("debug") || lower.includes("refactor") || lower.includes("planner");
}

function detectAreaProfiles(goal: string, context: PlannerWorkspaceContext): AreaProfile[] {
  const lower = goal.toLowerCase();
  const profiles: AreaProfile[] = [];

  const addProfile = (profile: AreaProfile) => {
    if (!profiles.some((entry) => entry.area === profile.area)) {
      profiles.push(profile);
    }
  };

  const fileTree = context.fileTree.map((entry) => normalizePath(entry));
  const matchFiles = (pattern: RegExp): string[] => fileTree.filter((entry) => pattern.test(entry));

  if (lower.includes("debug") || lower.includes("test") || lower.includes("typecheck") || lower.includes("runtime") || lower.includes("lint")) {
    addProfile({
      area: "Validation / Debugging",
      files: unique([
        ...matchFiles(/(^|[\/])(tests?|specs?)[\/]/i),
        ...matchFiles(/\.(test|spec)\.(ts|tsx|js|jsx|py)$/i)
      ]),
      title: "Analyse- und Validierungspfad",
      description: "Fehler, Testausgaben und Typpruefungen muessen konsistent betrachtet werden."
    });
  }

  if (lower.includes("agent")) {
    addProfile({
      area: "Agent Registry / Orchestration",
      files: unique([
        ...matchFiles(/src\/App\.tsx$/i),
        ...matchFiles(/src\/stores\/.*agent.*\.ts$/i),
        ...matchFiles(/src\/components\/.*Agent.*\.tsx$/i)
      ]),
      title: "Agenten-Integration",
      description: "Bestehende Agenten- und Registry-Flows sollten weiterverwendet statt dupliziert werden."
    });
  }

  if (lower.includes("ui") || lower.includes("panel") || lower.includes("workspace explorer") || lower.includes("editor")) {
    addProfile({
      area: "Renderer UI",
      files: unique([
        ...matchFiles(/src\/App\.tsx$/i),
        ...matchFiles(/src\/components\/.+\.tsx$/i),
        ...matchFiles(/src\/styles\.css$/i)
      ]),
      title: "UI-Anpassungen",
      description: "Die UI sollte modular bleiben und bestehende Panel-Strukturen respektieren."
    });
  }

  if (lower.includes("type") || lower.includes("shared") || lower.includes("contract")) {
    addProfile({
      area: "Shared Types / Contracts",
      files: unique([
        ...matchFiles(/packages\/shared\/src\/index\.ts$/i),
        ...matchFiles(/src\/types\/.+\.d\.ts$/i)
      ]),
      title: "Gemeinsame Typen",
      description: "Typen sollten zentral im Shared-Layer gepflegt werden, um Drift zu vermeiden."
    });
  }

  if (lower.includes("backend") || lower.includes("api") || lower.includes("runtime")) {
    addProfile({
      area: "Backend / IPC",
      files: unique([
        ...matchFiles(/^backend\/.+\.(py|ts)$/i),
        ...matchFiles(/apps\/desktop\/electron\/.+\.(ts|js)$/i)
      ]),
      title: "Backend- oder IPC-Anschluss",
      description: "Server- und IPC-Grenzen muessen stabil bleiben und getrennt behandelt werden."
    });
  }

  if (profiles.length === 0) {
    addProfile({
      area: "Workspace Core",
      files: unique([
        ...matchFiles(/src\/App\.tsx$/i),
        ...matchFiles(/src\/stores\/.+\.ts$/i),
        ...matchFiles(/src\/services\/.+\.ts$/i),
        ...matchFiles(/packages\/shared\/src\/index\.ts$/i)
      ]),
      title: "Kernpfad",
      description: "Die naheliegenden Kernmodule muessen vor zu breiten Anpassungen untersucht werden."
    });
  }

  return profiles;
}

function pickPrimaryFiles(context: PlannerWorkspaceContext, areaProfiles: AreaProfile[], projectMemory?: ProjectMemory | null): string[] {
  const sampled = context.sampledFiles.map((file) => normalizePath(file.relativePath));
  const files = areaProfiles.flatMap((profile) => profile.files);
  const memoryImportant = projectMemory?.importantFiles.map((entry) => normalizePath(entry.path)) ?? [];
  return unique([...memoryImportant, ...files, ...sampled]).slice(0, 8);
}

function determineTaskCount(goal: string): number {
  return isLargeGoal(goal) ? MAX_TASKS_FOR_LARGE_GOAL : MAX_TASKS_FOR_SMALL_GOAL;
}

function buildBaseTasks(goal: string, context: PlannerWorkspaceContext, areaProfiles: AreaProfile[], projectMemory?: ProjectMemory | null): PlannerTask[] {
  const normalizedGoal = normalizeText(goal);
  const primaryFiles = pickPrimaryFiles(context, areaProfiles, projectMemory);
  const analysisFiles = primaryFiles.slice(0, 3);
  const implementationFiles = primaryFiles.slice(0, 5);
  const validationFiles = unique([
    ...implementationFiles,
    ...context.fileTree.filter((entry) => /(^|[\/])(tests?|specs?)[\/]/i.test(entry)).slice(0, 2)
  ]).slice(0, 6);

  const largeGoal = isLargeGoal(goal);
  const tasks: PlannerTask[] = [
    {
      id: createId("task"),
      title: "Ziel und Architekturrahmen analysieren",
      description: `Das Ziel "${normalizedGoal}" in bestehende Module, Stores und UI-Flows einordnen und die kleinste saubere Aenderungsgrenze bestimmen.`,
      affectedFiles: analysisFiles,
      priority: "high",
      estimatedComplexity: "small",
      dependencies: []
    },
    {
      id: createId("task"),
      title: largeGoal ? "Betroffene Bereiche zerlegen" : "Betroffene Dateien und Services bestimmen",
      description: largeGoal
        ? "Die Aenderung in Teilbereiche zerlegen, damit UI, Stores, Shared Types und Backend nur bei Bedarf beruehrt werden."
        : "Die wichtigsten Dateien und Services markieren, ohne unnötige Querschnitts-Aenderungen einzufuehren.",
      affectedFiles: implementationFiles,
      priority: largeGoal ? "high" : "medium",
      estimatedComplexity: largeGoal ? "medium" : "small",
      dependencies: []
    },
    {
      id: createId("task"),
      title: "Kernaenderung umsetzen",
      description: "Nur die minimalen betroffenen Pfade anpassen und bestehende Architekturgrenzen beibehalten.",
      affectedFiles: implementationFiles,
      priority: "high",
      estimatedComplexity: largeGoal ? "large" : "medium",
      dependencies: []
    }
  ];

  if (largeGoal) {
    tasks.push({
      id: createId("task"),
      title: "Integration und Validierung sichern",
      description: "Sicherstellen, dass alle Aenderungen mit existierenden Stores, Agenten und Typen kompatibel bleiben.",
      affectedFiles: validationFiles,
      priority: "high",
      estimatedComplexity: "medium",
      dependencies: []
    });
  }

  tasks.push({
    id: createId("task"),
    title: "Tests und Risiken validieren",
    description: "Die wichtigsten Tests, Typpruefungen und Folgefehler gegen den vorgeschlagenen Plan abgleichen.",
    affectedFiles: validationFiles,
    priority: "medium",
    estimatedComplexity: "medium",
    dependencies: []
  });

  const orderedTasks = tasks.slice(0, determineTaskCount(goal));
  for (let index = 1; index < orderedTasks.length; index += 1) {
    orderedTasks[index] = {
      ...orderedTasks[index],
      dependencies: [orderedTasks[index - 1]?.id ?? ""]
        .filter(Boolean)
    };
  }

  return orderedTasks;
}

function buildRisks(
  goal: string,
  context: PlannerWorkspaceContext,
  areaProfiles: AreaProfile[],
  projectMemory?: ProjectMemory | null,
  gitRepositoryStatus?: GitRepositoryStatus | null,
  gitDiffSummary: GitDiffSummary[] = []
): string[] {
  const risks = [
    "Der Plan sollte keine direkten Schreib- oder Ausfuehrungsschritte enthalten.",
    "Zu breite Aenderungen koennen bestehende Agenten-, Store- und Shared-Type-Grenzen verletzen."
  ];

  if (isLargeGoal(goal)) {
    risks.push("Das Ziel ist breit formuliert; ohne Priorisierung kann der Plan zu viele Dateien beruehren.");
  }

  if (context.sampledFiles.length === 0) {
    risks.push("Der Workspace-Kontext ist dünn; Dateizuordnung basiert dann nur auf der Projektstruktur.");
  }

  if (areaProfiles.some((profile) => profile.area === "Shared Types / Contracts")) {
    risks.push("Shared-Type-Aenderungen koennen TypeScript-Fehler in mehreren Schichten ausloesen.");
  }

  if (areaProfiles.some((profile) => profile.area === "Agent Registry / Orchestration")) {
    risks.push("Agenten-Integration sollte die bestehende Registry verwenden statt neue Laufzeitwege einzufuehren.");
  }

  if ((projectMemory?.knownIssues.length ?? 0) > 0) {
    risks.push(`Bekannte Issues beachten: ${projectMemory?.knownIssues.slice(0, 3).map((issue) => issue.title).join(", ")}.`);
  }

  if (gitRepositoryStatus && gitRepositoryStatus.isRepository && gitRepositoryStatus.entries.length > 12) {
    risks.push("Viele uncommitted Aenderungen erkannt; Plan sollte strikt in kleine, pruefbare Schritte zerlegt werden.");
  }

  if (gitRepositoryStatus?.entries.some((entry) => entry.status === "conflicted")) {
    risks.push("Git-Konflikte vorhanden; erst Konflikte aufloesen, bevor weitere Agent-Aenderungen angewendet werden.");
  }

  if (gitDiffSummary.some((entry) => entry.additions + entry.deletions > 250)) {
    risks.push("Mindestens ein sehr grosser Diff erkannt; Review und Testabdeckung priorisieren.");
  }

  return unique(risks);
}

function buildAssumptions(
  goal: string,
  context: PlannerWorkspaceContext,
  areaProfiles: AreaProfile[],
  gitRepositoryStatus?: GitRepositoryStatus | null
): string[] {
  const assumptions = [
    `Das Ziel wurde als: "${normalizeText(goal)}" interpretiert.`,
    `Der aktuelle Workspace ${context.rootPath} wird als primäre Quelle fuer relevante Dateien verwendet.`,
    "Bestehende Stores, Services und Panels sollen bevorzugt erweitert statt ersetzt werden."
  ];

  if (context.availableAgents.length > 0) {
    assumptions.push(
      `Verfuegbare Agenten fuer spaetere Orchestrierung: ${context.availableAgents.map((agent) => `${agent.name} (${agent.role})`).join(", ")}.`
    );
  } else {
    assumptions.push("Aktuell sind keine Agenten fuer eine spaetere Orchestrierung vorausgesetzt.");
  }

  if (areaProfiles.every((profile) => profile.files.length === 0)) {
    assumptions.push("Dateibezogene Details werden aus der vorhandenen Architektur abgeleitet, nicht aus exakten Pfadtreffern.");
  }

  if (gitRepositoryStatus?.isRepository) {
    assumptions.push(`Aktueller Branch lautet ${gitRepositoryStatus.currentBranch || "(unbekannt)"} und muss fuer Planungskontext beruecksichtigt werden.`);
  }

  return assumptions;
}

function buildAffectedAreas(areaProfiles: AreaProfile[]): string[] {
  return unique(areaProfiles.map((profile) => profile.area));
}

function buildSummary(goal: string, tasks: PlannerTask[], affectedAreas: string[]): string {
  const taskCount = tasks.length;
  const areaText = affectedAreas.length > 0 ? affectedAreas.join(", ") : "Workspace Core";
  return `Plan fuer "${normalizeText(goal)}": ${taskCount} Schritte ueber ${areaText}.`;
}

function buildExecutionDraft(plan: PlannerPlan, availableAgents: PlannerAgentReference[]): PlannedExecution[] {
  const agentCandidates = availableAgents.filter((agent) => agent.status !== "stopped");
  return plan.tasks.map((task, index) => {
    const title = task.title.toLowerCase();
    const preferredAgent =
      agentCandidates.find((agent) => /test|verify|qa/.test(agent.role.toLowerCase()) && /test|validierung|pruef/.test(title)) ??
      agentCandidates.find((agent) => /planner|analysis|debug/.test(agent.role.toLowerCase()) && /analys|architektur/.test(title)) ??
      agentCandidates[0];

    return {
      taskId: task.id,
      assignedAgent: preferredAgent?.id,
      status: index === 0 ? "pending" : "pending"
    };
  });
}

export class PlannerAgentService {
  createPlan(
    goal: string,
    workspaceContext: PlannerWorkspaceContext,
    projectMemory?: ProjectMemory | null,
    gitRepositoryStatus?: GitRepositoryStatus | null,
    gitDiffSummary: GitDiffSummary[] = []
  ): PlannerPlan {
    const normalizedGoal = normalizeText(goal);
    if (!normalizedGoal) {
      throw new PlannerAgentError("EMPTY_GOAL", "Planungsziel ist leer.");
    }

    const areaProfiles = detectAreaProfiles(normalizedGoal, workspaceContext);
    const tasks = buildBaseTasks(normalizedGoal, workspaceContext, areaProfiles, projectMemory);
    const plan: PlannerPlan = {
      id: createId("plan"),
      goal: normalizedGoal,
      summary: buildSummary(normalizedGoal, tasks, buildAffectedAreas(areaProfiles)),
      tasks,
      risks: buildRisks(normalizedGoal, workspaceContext, areaProfiles, projectMemory, gitRepositoryStatus, gitDiffSummary),
      assumptions: buildAssumptions(normalizedGoal, workspaceContext, areaProfiles, gitRepositoryStatus),
      affectedAreas: buildAffectedAreas(areaProfiles),
      createdAt: new Date().toISOString()
    };

    return plan;
  }

  validatePlan(plan: PlannerPlan): PlanValidationResult {
    const errors: string[] = [];

    if (!normalizeText(plan.goal)) {
      errors.push("Plan.goal fehlt.");
    }
    if (!normalizeText(plan.summary)) {
      errors.push("Plan.summary fehlt.");
    }
    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
      errors.push("Plan.tasks ist leer.");
    }

    const taskIds = new Set<string>();
    const taskIdCounts = new Map<string, number>();
    for (const task of plan.tasks) {
      if (normalizeText(task.id)) {
        taskIds.add(task.id);
        taskIdCounts.set(task.id, (taskIdCounts.get(task.id) ?? 0) + 1);
      }
    }

    for (const task of plan.tasks) {
      if (!normalizeText(task.id)) {
        errors.push("Eine Task hat keine ID.");
      }
      if ((taskIdCounts.get(task.id) ?? 0) > 1) {
        errors.push(`Task-ID doppelt vorhanden: ${task.id}`);
      }

      if (!normalizeText(task.title)) {
        errors.push(`Task ${task.id} hat keinen Titel.`);
      }
      if (!normalizeText(task.description)) {
        errors.push(`Task ${task.id} hat keine Beschreibung.`);
      }
      if (!["low", "medium", "high"].includes(task.priority)) {
        errors.push(`Task ${task.id} hat eine ungueltige Prioritaet.`);
      }
      if (!(["small", "medium", "large"].includes(task.estimatedComplexity))) {
        errors.push(`Task ${task.id} hat eine ungueltige Komplexitaet.`);
      }
      if (!Array.isArray(task.affectedFiles)) {
        errors.push(`Task ${task.id} hat keine gueltige affectedFiles-Liste.`);
      }
      if (!Array.isArray(task.dependencies)) {
        errors.push(`Task ${task.id} hat keine gueltige dependencies-Liste.`);
      }
      for (const dependency of task.dependencies) {
        if (!taskIds.has(dependency) && dependency !== task.id) {
          errors.push(`Task ${task.id} referenziert unbekannte Abhaengigkeit ${dependency}.`);
        }
      }
    }

    if (plan.affectedAreas.length === 0) {
      errors.push("Plan.affectedAreas ist leer.");
    }

    return { valid: errors.length === 0, errors };
  }

  summarizePlan(plan: PlannerPlan): string {
    const taskCount = plan.tasks.length;
    const riskCount = plan.risks.length;
    const areas = plan.affectedAreas.length > 0 ? plan.affectedAreas.join(", ") : "keine Bereiche erkannt";
    return `${plan.summary} ${taskCount} Tasks, ${riskCount} Risiken, Bereiche: ${areas}.`;
  }

  buildExecutionDraft(plan: PlannerPlan, availableAgents: PlannerAgentReference[]): PlannedExecution[] {
    return buildExecutionDraft(plan, availableAgents);
  }
}

export function createPlannerWorkspaceContext(
  rootPath: string,
  name: string,
  fileTree: string[],
  sampledFiles: PlannerWorkspaceContext["sampledFiles"],
  availableAgents: PlannerAgentReference[]
): PlannerWorkspaceContext {
  return {
    rootPath,
    name,
    fileTree,
    sampledFiles,
    availableAgents
  };
}