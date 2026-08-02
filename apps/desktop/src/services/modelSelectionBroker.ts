/**
 * Central, authoritative model selection broker.
 * 
 * This is the ONLY place where routing decisions are made.
 * All consumers (Frontend, Backend, UI) follow this decision.
 * 
 * Once decided: slot_id, model_id, fallback_policy are FIXED.
 * No re-evaluation, no implicit re-routing.
 */

import type {
  MultimodalPair,
  RuntimeTaskType,
  RuntimeSlotId as SharedRuntimeSlotId
} from "@dbzs/shared";
import {
  matchesCompleteRepositoryReviewIntent as matchesCompleteRepoReview,
  resolveRepositoryReviewScope
} from "@/services/repositoryReview/reviewIntent";
import {
  classifyUserExecutionIntent,
  isToolRequiredExecutionIntent,
  taskTypeForExecutionIntent
} from "@/services/executionIntent";
import type {
  CanonicalWorkflowAssignment,
  WorkflowAgentRole,
  WorkflowModelRole
} from "@/runtime/workflow/workflowContracts";
import { backendClient } from "@/services/backendClient";
  FleetRoutingDecision,
  FleetRoutingRequest,
} from "@dbzs/shared/src/fleet/routingContracts";
import { backendClient } from "./backendClient"; // Annahme: Ein API-Client existiert
import { getHardwareProfile } from "./hardwareService"; // Annahme: Eine Funktion zum Sammeln des HW-Profils existiert
import { v4 as uuidv4 } from "uuid";

export type TaskType = RuntimeTaskType;

export type ModelTargetAgent =
  | "default"
  | "planner"
  | "coder"
  | "tester"
  | "reviewer"
  | "debugger"
  | "docs";

export type RuntimeSlotId = SharedRuntimeSlotId;

export type FallbackPolicy =
  | "strict"
  | "allow_local_fallback"
  | "allow_cloud_fallback"
  | "allow_any_fallback";

export type BindingSelectionSource = "role_setting" | "manual_selection" | "explicit_fallback";

export interface ModelSelectionDecision {
  /** What kind of task is this? */
  taskType: TaskType;
  
  /** Which agent should handle this? */
  targetAgent: ModelTargetAgent;
  
  /** Which runtime slot should execute this? */
  slotId: RuntimeSlotId;
  
  /** Which specific model? (alias of resolvedModelId) */
  modelId: string;
  
  /** Model display name (alias of resolvedModelName) */
  modelName: string;

  /** Role setting id before resolution / vision gate. */
  configuredModelId: string;

  /** Authoritative resolved model id from index/settings. */
  resolvedModelId: string;

  /** Authoritative display name from the same IndexedModel when available. */
  resolvedModelName: string;

  selectionSource: BindingSelectionSource;
  fallbackReason?: string;
  capabilities: string[];
  hasImageInput: boolean;
  requiresVision: boolean;

  /** Plan 15, Phase 5 (Dual-Mode Vision): the id of the MMProj support artifact
   * (from a verified MultimodalPair) that runtimeSlotManager.startSlot() should
   * pass to the backend so it can load the projector alongside this model on
   * vision_gpu. Only set when slotId is "vision_gpu" and the resolved model
   * actually requires its projector — never a raw filesystem path, and never
   * trusted client-side; the backend re-resolves it against its own index. */
  projectorArtifactId?: string;
  
  /** Only supporting llama.cpp for now */
  providerId: "llama-cpp";
  
  /** Why was this decision made? (for diagnostics) */
  reason: string[];
  
  /** If target slot unavailable, what happens? */
  fallbackPolicy: FallbackPolicy;

  /** Stable identifier for this user-turn routing decision. */
  decisionId: string;
  
  /** Timestamp when decision was made */
  decidedAt: Date;

  /** Settings revision at decision time — must match current before runtime start. */
  decisionSettingsRevision: number;

  /** Confidence/ambiguity diagnostics from classifyTaskTypeDetailed(), used by the clarification policy. */
  intent?: IntentClassification;

  /** Repository-review diagnostics (canonical taskType stays `review`). */
  intentLabel?: "code_review" | "fix_review_findings";
  workflowId?: "repository_review" | "review_remediation";
  workflowKind?: string;
  workflowPhase?: string;
  modelRole?: WorkflowModelRole;
  toolProfile?: string;
  reviewScope?:
    | "active_file"
    | "uncommitted_changes"
    | "last_commit"
    | "selected_paths"
    | "full_repository";
}

export class BindingModelError extends Error {
  readonly code: string;
  readonly options: string[];

  constructor(message: string, code: string, options: string[] = []) {
    super(message);
    this.name = "BindingModelError";
    this.code = code;
    this.options = options;
  }
}

const REVIEW_PATTERNS = [
  "code review",
  "codereview",
  "reviewe",
  "mach einen code review",
  "mache einen code review",
  "kompletten code review",
  "complete code review",
  "audit",
  "überprüfe den code",
  "ueberpruefe den code",
  "prüfe den code",
  "prufe den code",
  "prüfe die änderungen",
  "prufe die anderungen",
  "prüfe auf regression",
  "prufe auf regression",
  "analysiere den diff",
  "suche fehler",
  "suche risiken",
  "fehler und risiken",
  "codequalität",
  "codequalitat",
  "code qualität",
  "bewerte die code",
  "bewerte den code",
  "bewerte die änderungen"
];
const REVIEW_WORD_BOUNDARY = /\breview\b/i;
const DEBUG_PATTERNS = ["debug", "fehler", "bug", "problem", "warum", "why", "error"];
const LARGE_CHANGE_PATTERNS = ["refactor", "umstrukturiere", "reorganisiere", "neudesign"];
const SMALL_CHANGE_PATTERNS = [
  "ändere", "change", "update", "add", "entferne", "remove", "fix",
  "füge hinzu", "modifiziere", "modify", "neue funktion", "neues feature",
  "new function", "new feature", "baue", "einbauen", "integriere", "implementiere",
  "setup", "richte ein", "umsetzen"
];
const PLAN_PATTERNS = ["plan", "design", "architektur", "architecture", "struktur"];

/**
 * Explicit review intent — must win over Agent Mode / coding prefixes.
 * Canonical task type remains `review` (hotfix alias: code_review).
 * Der ModelSelectionBroker ist nach dem Umbau ein reiner Client/Presenter
 * für den autoritativen FleetRoutingResolver im Backend.
 *
 * FRÜHER: Hielt komplexe Logik zum Filtern, Scoren und Auswählen von Modellen.
 * HEUTE: Baut eine Anfrage, sendet sie ans Backend und gibt die Entscheidung zurück.
 */
export function matchesReviewIntent(userMessage: string): boolean {
  const cleaned = userMessage.toLowerCase();
  if (REVIEW_PATTERNS.some((p) => cleaned.includes(p))) {
    return true;
  }
  // Standalone "review" word only when not an implement/fix/refactor request.
  if (REVIEW_WORD_BOUNDARY.test(cleaned)) {
    const intent = classifyUserExecutionIntent(userMessage);
    return intent === "review" || intent === "explain_only" || intent === "inspect";
  }
  return false;
}

export { matchesCompleteRepositoryReviewIntent } from "@/services/repositoryReview/reviewIntent";

/**
 * Classify the intent of a user message.
 * Determines if this is chat or requires tooling/agent.
 */
export function classifyTaskType(
  userMessage: string,
  hasExplicitAgentPrefix?: boolean,
  hasFileContext?: boolean,
): TaskType {
  const cleaned = userMessage.toLowerCase();

  // Execution / plan intents beat review and casual chat (e.g. "Implementiere Electron").
  const executionIntent = classifyUserExecutionIntent(userMessage);
  if (isToolRequiredExecutionIntent(executionIntent) || executionIntent === "plan_only") {
    return taskTypeForExecutionIntent(executionIntent);
  }

  // Explicit review after execution verbs have been ruled out.
  if (matchesReviewIntent(cleaned) || executionIntent === "review") {
    return "review";
  }

  // Explicit agent mode overrides remaining intents (coding default).
  if (hasExplicitAgentPrefix) {
    return "large_code_change";
  }

  if (DEBUG_PATTERNS.some(p => cleaned.includes(p))) {
    return "debugging";
  }

  if (LARGE_CHANGE_PATTERNS.some(p => cleaned.includes(p))) {
    return "large_code_change";
  }

  if (SMALL_CHANGE_PATTERNS.some(p => cleaned.includes(p))) {
    return "small_code_change";
  }

  if (PLAN_PATTERNS.some(p => cleaned.includes(p))) {
    return "planning";
  }

  // Code context present → slightly elevated
  if (hasFileContext) {
    return "normal_chat";
  }

  // Default to casual chat
  return "casual_chat";
}

export interface IntentClassification {
  /** The task type classifyTaskType() would return — identical decision, never changed by this function. */
  taskType: TaskType;
  /** 0..1 keyword-match ratio for the winning pattern group; 1 for explicit-agent-prefix or the no-match fallback. */
  confidence: number;
  matchedPatterns: string[];
  /** Runner-up task types by confidence, excluding the winner. Empty if nothing else matched. */
  alternativeTaskTypes: Array<{ taskType: TaskType; confidence: number }>;
}

function scorePatternGroup(cleaned: string, patterns: string[]): { confidence: number; matched: string[] } {
  const matched = patterns.filter((p) => cleaned.includes(p));
  return { confidence: matched.length / patterns.length, matched };
}

/**
 * Same intent decision as classifyTaskType(), plus confidence/alternatives for
 * the clarification policy. The winning taskType is always derived by calling
 * classifyTaskType() itself, so this can never diverge from it — confidence
 * scoring is purely additive diagnostic information layered on top of the
 * existing first-match priority chain, not a replacement for it.
 */
export function classifyTaskTypeDetailed(
  userMessage: string,
  hasExplicitAgentPrefix?: boolean,
  hasFileContext?: boolean,
): IntentClassification {
  const taskType = classifyTaskType(userMessage, hasExplicitAgentPrefix, hasFileContext);
  const cleaned = userMessage.toLowerCase();

  if (taskType === "review" && matchesReviewIntent(cleaned)) {
    const reviewScore = scorePatternGroup(cleaned, REVIEW_PATTERNS);
    return {
      taskType: "review",
      confidence: reviewScore.confidence > 0 ? reviewScore.confidence : 1,
      matchedPatterns: reviewScore.matched.length > 0 ? reviewScore.matched : ["review_intent"],
      alternativeTaskTypes: hasExplicitAgentPrefix
        ? [{ taskType: "large_code_change", confidence: 1 }]
        : []
    };
  }

  if (hasExplicitAgentPrefix) {
    return { taskType, confidence: 1, matchedPatterns: ["explicit_agent_prefix"], alternativeTaskTypes: [] };
  }

  const groups: Array<{ taskType: TaskType; patterns: string[] }> = [
    { taskType: "review", patterns: REVIEW_PATTERNS },
    { taskType: "debugging", patterns: DEBUG_PATTERNS },
    { taskType: "large_code_change", patterns: LARGE_CHANGE_PATTERNS },
    { taskType: "small_code_change", patterns: SMALL_CHANGE_PATTERNS },
    { taskType: "planning", patterns: PLAN_PATTERNS }
  ];

  const scored = groups
    .map((group) => ({ taskType: group.taskType, ...scorePatternGroup(cleaned, group.patterns) }))
    .filter((entry) => entry.confidence > 0);

  const winner = scored.find((entry) => entry.taskType === taskType);
  const alternativeTaskTypes = scored
    .filter((entry) => entry.taskType !== taskType)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2)
    .map((entry) => ({ taskType: entry.taskType, confidence: entry.confidence }));

  return {
    taskType,
    confidence: winner?.confidence ?? 1,
    matchedPatterns: winner?.matched ?? [],
    alternativeTaskTypes
  };
}

export interface BrokerModelCatalogEntry {
  id: string;
  name?: string;
  artifact_type?: string;
  capabilities?: string[];
  recommended_use?: string;
  /** Explicit: model can run pure text chat without an image. */
  supportsTextOnly?: boolean;
  /** Explicit: vision projector / MMProj is required for any request. */
  requiresVisionProjector?: boolean;
  supportsVision?: boolean;
}

/** A model actually resident in a runtime slot right now — used for role-model fallback. */
export interface RunningModelSnapshot {
  slotId: RuntimeSlotId;
  modelId: string;
}

export interface BrokerDecisionOptions {
  hasImageInput?: boolean;
  requiresVision?: boolean;
  /** When true (default for feature work), route small_code_change to planner first. */
  preferPlannerFirst?: boolean;
  /** Manual model override id — kept even if vision, but reason warns. */
  manualModelId?: string;
  catalog?: BrokerModelCatalogEntry[];
  multimodalPairs?: MultimodalPair[];
  /** Current settings revision — stamped onto the decision. */
  settingsRevision?: number;
  /** Original user message — used to attach repository-review meta. */
  userMessage?: string;
  workflowAssignment?: Pick<
    CanonicalWorkflowAssignment,
    "workflowKind" | "phase" | "effectiveAgent" | "modelRole" | "toolProfile"
  >;
class ModelSelectionBroker {
  /**
   * Models currently resident in a runtime slot. Only consulted when no role model is
   * configured for the resolved target — used to fall back onto an already-running model
   * instead of hard-failing the turn. See resolveModelIdWithVisionGate().
   * Löst eine Routing-Anfrage auf, indem der zentrale Backend-Resolver aufgerufen wird.
   * @param routingParams Parameter, die den Modellbedarf beschreiben.
   * @returns Die verbindliche Entscheidung des Backends.
   */
  runningModels?: RunningModelSnapshot[];
}
  public async resolve(routingParams: {
    usecase: string;
    role: string;
    capabilities: string[];
  }): Promise<FleetRoutingDecision> {
    console.log(`[ModelSelectionBroker] Degrading to client. Calling backend fleet resolver for role: ${routingParams.role}`);

function isNonRunnableSupportArtifact(entry?: BrokerModelCatalogEntry | null): boolean {
  return entry?.artifact_type != null && entry.artifact_type !== "model";
}
    // 1. Sammle alle notwendigen Informationen für die Anfrage.
    const hardwareProfile = await getHardwareProfile();

function mapWorkflowAgentToModelTarget(agent: WorkflowAgentRole): ModelTargetAgent {
  switch (agent) {
    case "runtime_chat":
      return "default";
    case "planner":
    case "coder":
    case "tester":
    case "reviewer":
    case "debugger":
      return agent;
    default:
      return "default";
  }
}
    // 2. Erstelle die autoritative Anfrage gemäß Vertrag.
    const request: FleetRoutingRequest = {
      requestId: `fsr-${uuidv4()}`,
      usecaseId: routingParams.usecase,
      workflowModelRole: routingParams.role,
      requiredCapabilities: routingParams.capabilities,
      // Diese Werte würden aus den Usecase-Definitionen oder Settings stammen.
      requiredCertification: "CHAT_VERIFIED",
      minimumSafetyLevel: "GUARDED",
      hardwareProfile: hardwareProfile,
      fallbackPolicy: "allow_local_fallback",
    };

/**
 * Detect vision / multimodal models by catalog metadata or filename tokens.
 */
export function looksLikeVisionModel(
  value: string,
  catalogEntry?: BrokerModelCatalogEntry | null,
): boolean {
  if (catalogEntry) {
    if (isNonRunnableSupportArtifact(catalogEntry)) return false;
    if (catalogEntry.recommended_use === "vision_candidate") return true;
    if (catalogEntry.capabilities?.includes("vision")) return true;
  }

  const key = value.toLowerCase().replace(/\\/g, "/");
  if (
    key.includes("vision") ||
    key.includes("llava") ||
    key.includes("janus") ||
    key.includes("smolvlm") ||
    key.includes("qwen2.5-vl") ||
    key.includes("qwen2-vl") ||
    key.includes("image_text_to_text") ||
    key.includes("vision_chat") ||
    key.includes("multimodal") ||
    key.includes("-vl-") ||
    key.includes("-vl.") ||
    key.includes("/vl") ||
    key.includes("_vl_") ||
    key.includes("_vl.")
  ) {
    return true;
  }
  return /(^|[^a-z0-9])vl([^a-z0-9]|$)/.test(key);
}

function findCatalogEntry(
  modelId: string,
  catalog?: BrokerModelCatalogEntry[],
): BrokerModelCatalogEntry | undefined {
  if (!catalog?.length) return undefined;
  const normalized = modelId.toLowerCase();
  return catalog.find(
    (entry) =>
      entry.id === modelId ||
      entry.name === modelId ||
      entry.id.toLowerCase() === normalized ||
      (entry.name?.toLowerCase() ?? "") === normalized,
  );
}

function findVerifiedMultimodalPair(
  modelId: string,
  multimodalPairs?: MultimodalPair[],
): MultimodalPair | undefined {
  if (!multimodalPairs?.length) return undefined;
  return multimodalPairs.find(
    (pair) => pair.base_model_id === modelId && pair.routing_allowed === true,
  );
}

/** Content-hash / opaque ids must never be shown as the sole model label. */
export function looksLikeOpaqueModelId(value: string): boolean {
  const base = value.replace(/\\/g, "/").split("/").pop() ?? value;
  const stripped = base.replace(/\.(gguf|bin)$/i, "").trim();
  if (!stripped) return true;
  return /^[a-f0-9]{8,64}$/i.test(stripped);
}

function isVisionModelRef(modelId: string, catalog?: BrokerModelCatalogEntry[]): boolean {
  return looksLikeVisionModel(modelId, findCatalogEntry(modelId, catalog));
}

/**
 * Whether a (possibly vision) model may handle text-only requests.
 * Prefer explicit catalog flags; otherwise infer from Instruct-VL / dual chat+vision caps.
 */
export function modelSupportsTextOnly(
  modelId: string,
  catalog?: BrokerModelCatalogEntry[],
): boolean {
  const entry = findCatalogEntry(modelId, catalog);
  if (entry?.supportsTextOnly === true) return true;
  if (entry?.supportsTextOnly === false) return false;
  if (entry?.requiresVisionProjector === true) return false;
  if (entry?.supportsVision === false) return true;

  const caps = entry?.capabilities ?? [];
  if (caps.includes("vision") && caps.includes("chat")) return true;

  const key = `${entry?.name ?? ""} ${modelId}`.toLowerCase();
  if (/vl/.test(key) && /instruct/.test(key)) return true;
  return false;
}

export function modelRequiresVisionProjector(
  modelId: string,
  catalog?: BrokerModelCatalogEntry[],
): boolean {
  const entry = findCatalogEntry(modelId, catalog);
  if (entry?.requiresVisionProjector === true) return true;
  if (entry?.supportsTextOnly === false && isVisionModelRef(modelId, catalog)) return true;
  return false;
}

function taskRequiresCodingCapability(taskType: TaskType): boolean {
  return (
    taskType === "small_code_change" ||
    taskType === "large_code_change" ||
    taskType === "refactoring" ||
    taskType === "debugging" ||
    taskType === "review" ||
    taskType === "test_analysis"
  );
}

function modelSupportsCodingCapability(
  modelId: string,
  catalog?: BrokerModelCatalogEntry[],
): boolean {
  const entry = findCatalogEntry(modelId, catalog);
  if (!entry) {
    return false;
  }
  return entry.capabilities?.includes("code") === true;
}

export function deriveModelDisplayName(
  modelId: string,
  fallbackName: string,
  catalog?: BrokerModelCatalogEntry[],
): string {
  const entry = findCatalogEntry(modelId, catalog);
  if (entry?.name?.trim() && !looksLikeOpaqueModelId(entry.name)) {
    return entry.name.trim();
  }
  const base = modelId.replace(/\\/g, "/").split("/").pop() ?? modelId;
  const withoutExt = base.replace(/\.(gguf|bin)$/i, "").trim();
  if (withoutExt && withoutExt !== "default" && !looksLikeOpaqueModelId(withoutExt)) {
    return withoutExt;
  }
  if (fallbackName.trim() && !looksLikeOpaqueModelId(fallbackName)) {
    return fallbackName.trim();
  }
  return "Lokales Modell";
}

/** Prefer a human-readable name; never show a bare hash id. */
export function formatModelDisplayLabel(
  modelName: string | null | undefined,
  modelId: string | null | undefined,
  fallback = "Lokales Modell",
): string {
  const name = modelName?.trim();
  if (name && !looksLikeOpaqueModelId(name)) {
    return name;
  }
  const id = modelId?.trim();
  if (id && !looksLikeOpaqueModelId(id)) {
    return deriveModelDisplayName(id, fallback);
  }
  return fallback;
}

/**
 * Whether a candidate model may stand in for a missing role model on this turn.
 * Vision-safety is a hard filter here, never a score penalty: a text turn must never
 * fall back onto a vision-only model and vice versa (mirrors the role-setting gate above).
 */
function isFallbackCandidateEligible(
  modelId: string,
  allowVision: boolean,
  catalog: BrokerModelCatalogEntry[] | undefined,
  multimodalPairs: MultimodalPair[] | undefined,
): boolean {
  const entry = findCatalogEntry(modelId, catalog);
  if (isNonRunnableSupportArtifact(entry)) return false;
  if (!isVisionModelRef(modelId, catalog)) {
    return true;
  }
  if (!allowVision) return false;
  if (modelSupportsTextOnly(modelId, catalog)) return true;
  return Boolean(findVerifiedMultimodalPair(modelId, multimodalPairs));
}

/** Ranks eligible fallback candidates by fitness for the task at hand. */
function scoreFallbackCandidate(modelId: string, taskType: TaskType, catalog?: BrokerModelCatalogEntry[]): number {
  const entry = findCatalogEntry(modelId, catalog);
  if (!entry) return 0;
  let score = 0;
  const requiresCoding = taskRequiresCodingCapability(taskType);
  if (requiresCoding && entry.capabilities?.includes("code")) score += 100;
  if (requiresCoding && entry.recommended_use === "primary_coding") score += 50;
  if (requiresCoding && entry.recommended_use === "coding_candidate") score += 25;
  if (!requiresCoding && entry.capabilities?.includes("chat")) score += 30;
  if (!requiresCoding && entry.recommended_use === "chat_candidate") score += 20;
  return score;
}

function bestFallbackCandidate(
  candidateModelIds: string[],
  taskType: TaskType,
  catalog: BrokerModelCatalogEntry[] | undefined,
): string | undefined {
  return candidateModelIds
    .slice()
    .sort((a, b) => scoreFallbackCandidate(b, taskType, catalog) - scoreFallbackCandidate(a, taskType, catalog))[0];
}

function resolveModelIdWithVisionGate(
  preferred: string | undefined,
  settings: {
    defaultModelId: string;
    defaultChatModelId?: string;
    defaultPlannerModelId?: string;
    defaultCoderModelId?: string;
    defaultReviewerModelId?: string;
    defaultDebugModelId?: string;
    defaultVisionModelId?: string;
  },
  allowVision: boolean,
  catalog: BrokerModelCatalogEntry[] | undefined,
  multimodalPairs: MultimodalPair[] | undefined,
  reasons: string[],
  manualModelId?: string,
  taskType?: TaskType,
  runningModels?: RunningModelSnapshot[],
): {
  modelId: string;
  selectionSource: BindingSelectionSource;
  fallbackReason?: string;
  fallbackSlotId?: RuntimeSlotId;
} {
  if (manualModelId?.trim()) {
    const verifiedManualPair = findVerifiedMultimodalPair(manualModelId, multimodalPairs);
    if (allowVision && verifiedManualPair) {
      reasons.push(`multimodal_pair:routing_allowed:${verifiedManualPair.projector_artifact_id}`);
    }
    if (
      allowVision &&
      modelRequiresVisionProjector(manualModelId, catalog) &&
      !verifiedManualPair
    ) {
      reasons.push(`multimodal_pair:missing_verified_pair:${manualModelId}`);
      throw new BindingModelError(
        `Visionmodell '${manualModelId}' benoetigt ein verifiziertes MMProj-Pairing, aber es ist keine Routing-Freigabe vorhanden.`,
        "vision_pairing_required",
        ["MM-Pairing verifizieren", "Anderes Modell waehlen", "Abbrechen"]
    // 3. Rufe das Backend auf und warte auf die Entscheidung.
    try {
      const decision = await backendClient.post<FleetRoutingDecision>(
        "/fleet/resolve",
        request
      );
    }
    if (!allowVision && isVisionModelRef(manualModelId, catalog)) {
      reasons.push(`vision_gate:manual_override_warning:${manualModelId}`);
    }
    return { modelId: manualModelId, selectionSource: "manual_selection" };
  }

  if (!preferred?.trim()) {
    reasons.push("role_fallback:role_model_missing");

    // Tier 2: an already-running model that is safe for this turn — reuse it and
    // relocate the decision onto its slot instead of hard-failing.
    const runningCandidateIds = (runningModels ?? [])
      .map((snapshot) => snapshot.modelId)
      .filter((modelId) => isFallbackCandidateEligible(modelId, allowVision, catalog, multimodalPairs));
    const bestRunning = bestFallbackCandidate(runningCandidateIds, taskType ?? "normal_chat", catalog);
    if (bestRunning) {
      const slotId = runningModels?.find((snapshot) => snapshot.modelId === bestRunning)?.slotId;
      reasons.push(`role_fallback:running_model:${bestRunning}`);
      if (slotId) reasons.push(`role_fallback:slot_reassigned:${slotId}`);
      return decision;
    } catch (error: any) {
      // Erstelle eine Fehler-Entscheidung, falls das Backend nicht erreichbar ist.
      return {
        modelId: bestRunning,
        selectionSource: "explicit_fallback",
        fallbackReason: "role_model_missing_used_running",
        fallbackSlotId: slotId,
        decisionId: `fsd-error-${uuidv4()}`,
        timestamp: new Date().toISOString(),
        request: request,
        status: "error",
        evidence: { reasoning: `Backend resolver failed: ${error.message}`, certificationUsed: [] },
        fallbackChain: [],
      };
    }

    // Tier 3: best installed, catalog-known model that is safe for this turn.
    const installedCandidateIds = (catalog ?? [])
      .map((entry) => entry.id)
      .filter((modelId) => isFallbackCandidateEligible(modelId, allowVision, catalog, multimodalPairs));
    const bestInstalled = bestFallbackCandidate(installedCandidateIds, taskType ?? "normal_chat", catalog);
    if (bestInstalled) {
      reasons.push(`role_fallback:installed_model:${bestInstalled}`);
      return {
        modelId: bestInstalled,
        selectionSource: "explicit_fallback",
        fallbackReason: "role_model_missing_used_installed",
      };
    }

    reasons.push("role_fallback:no_candidate_found");
    throw new BindingModelError(
      "Rollenmodell in Settings fehlt, und es ist weder ein laufendes noch ein installiertes kompatibles Modell " +
        "als Fallback verfügbar. Bitte default*ModelId für die Zielrolle setzen oder ein Modell installieren.",
      "role_model_missing_no_fallback",
      ["Rollenmodell in Settings wählen", "Modell installieren", "Abbrechen"]
    );
  }

  if (catalog?.length) {
    const entry = findCatalogEntry(preferred, catalog);
    if (!entry) {
      throw new BindingModelError(
        `Konfiguriertes Rollenmodell '${preferred}' ist nicht im Modellindex.`,
        "role_model_not_in_index",
        ["Anderes Rollenmodell wählen", "Abbrechen"]
      );
    }
  }

  const configuredEntry = findCatalogEntry(preferred, catalog);
  if (isNonRunnableSupportArtifact(configuredEntry)) {
    throw new BindingModelError(
      `Konfiguriertes Rollenmodell '${preferred}' ist ein Support-Artefakt (${configuredEntry?.artifact_type ?? "unknown"}) und nicht direkt startbar.`,
      "role_model_not_runnable",
      ["Anderes Rollenmodell waehlen", "Abbrechen"]
    );
  }

  if (allowVision || !isVisionModelRef(preferred, catalog)) {
    const verifiedPair = allowVision ? findVerifiedMultimodalPair(preferred, multimodalPairs) : undefined;
    if (allowVision && verifiedPair) {
      reasons.push(`multimodal_pair:routing_allowed:${verifiedPair.projector_artifact_id}`);
    }
    if (allowVision && modelRequiresVisionProjector(preferred, catalog) && !verifiedPair) {
      reasons.push(`multimodal_pair:missing_verified_pair:${preferred}`);
      throw new BindingModelError(
        `Visionmodell '${preferred}' benoetigt ein verifiziertes MMProj-Pairing, aber es ist keine Routing-Freigabe vorhanden.`,
        "vision_pairing_required",
        ["MM-Pairing verifizieren", "Anderes Rollenmodell waehlen", "Abbrechen"]
      );
    }
    reasons.push(`role_setting:${preferred}`);
    return { modelId: preferred, selectionSource: "role_setting" };
  }

  // Vision role model on a text-only turn: allow only when text-only is supported.
  // Silent swaps to another role model are not allowed.
  if (modelSupportsTextOnly(preferred, catalog)) {
    reasons.push(`role_setting:${preferred}`);
    reasons.push("vision_gate:text_only_supported");
    reasons.push(`supportsTextOnly:true`);
    return { modelId: preferred, selectionSource: "role_setting" };
  }

  reasons.push(`vision_gate:blocked:${preferred}`);
  reasons.push("supportsTextOnly:false");
  throw new BindingModelError(
    `Rollenmodell '${preferred}' ist ein Visionmodell ohne Text-only-Support, und die Anfrage hat kein Bild.`,
    "vision_gate_blocked",
    ["Textmodell in Settings wählen", "Bild anhängen", "Abbrechen"]
  );
}

/**
 * Cheap pre-check for callers deciding whether it's worth fetching a running-slots
 * snapshot before calling brokerDecision(). Mirrors the same target/role resolution
 * brokerDecision() performs internally, so it can never diverge from what actually
 * triggers the fallback chain in resolveModelIdWithVisionGate().
 */
export function hasConfiguredRoleModelForTask(
  taskType: TaskType,
  settings: {
    defaultModelId: string;
    defaultChatModelId?: string;
    defaultPlannerModelId?: string;
    defaultCoderModelId?: string;
    defaultReviewerModelId?: string;
    defaultDebugModelId?: string;
    defaultVisionModelId?: string;
  },
  options?: {
    preferPlannerFirst?: boolean;
    workflowAssignment?: Pick<CanonicalWorkflowAssignment, "effectiveAgent" | "modelRole">;
  },
): boolean {
  const assignment = options?.workflowAssignment;
  const targetAgent = assignment
    ? mapWorkflowAgentToModelTarget(assignment.effectiveAgent)
    : mapTaskTypeToAgent(taskType, options?.preferPlannerFirst !== false);
  const configuredModelId = assignment
    ? selectModelForRole(assignment.modelRole, settings, targetAgent)
    : selectModelForTask(taskType, settings, targetAgent);
  return Boolean(configuredModelId?.trim());
}

/**
 * Make a BINDING routing decision.
 * This decision is final. Backend does NOT re-route.
 */
export async function brokerDecision(
  taskType: TaskType,
  settings: {
    defaultModelId: string;
    defaultChatModelId?: string;
    defaultModelName: string;
    defaultPlannerModelId?: string;
    defaultCoderModelId?: string;
    defaultReviewerModelId?: string;
    defaultDebugModelId?: string;
    defaultVisionModelId?: string;
    localOnlyModels?: boolean;
  },
  options?: BrokerDecisionOptions,
): Promise<ModelSelectionDecision> {
  const assignment = options?.workflowAssignment;
  const targetAgent = assignment
    ? mapWorkflowAgentToModelTarget(assignment.effectiveAgent)
    : mapTaskTypeToAgent(taskType, options?.preferPlannerFirst !== false);

  if (!backendClient.resolveRuntimeRoute) {
    throw new Error("Backend does not support resolveRuntimeRoute yet.");
  }

  const response = await backendClient.resolveRuntimeRoute({
    task_type: taskType,
    has_image_input: options?.hasImageInput,
    requires_vision: options?.requiresVision,
    prefer_planner_first: options?.preferPlannerFirst,
    manual_model_id: options?.manualModelId,
    user_message: options?.userMessage,
    workflow_kind: assignment?.workflowKind,
    phase: assignment?.phase,
    effective_agent: assignment?.effectiveAgent,
    model_role: assignment?.modelRole,
  });

  const decision: ModelSelectionDecision = {
    taskType: response.task_type as TaskType,
    targetAgent: response.target_agent as ModelTargetAgent,
    slotId: response.slot_id as RuntimeSlotId,
    modelId: response.model_id,
    modelName: response.model_name,
    configuredModelId: response.configured_model_id,
    resolvedModelId: response.resolved_model_id,
    resolvedModelName: response.resolved_model_name,
    selectionSource: response.selection_source as BindingSelectionSource,
    fallbackReason: response.fallback_reason,
    capabilities: response.capabilities,
    hasImageInput: response.has_image_input,
    requiresVision: response.requires_vision,
    projectorArtifactId: response.projector_artifact_id,
    providerId: response.provider_id as "llama-cpp",
    reason: response.reason,
    fallbackPolicy: response.fallback_policy as FallbackPolicy,
    decisionId: response.decision_id,
    decidedAt: new Date(),
    decisionSettingsRevision: response.decision_settings_revision,
  };

  if (taskType === "review" && options?.userMessage) {
    const scope =
      resolveRepositoryReviewScope(options.userMessage) ??
      (matchesCompleteRepoReview(options.userMessage) ? "full_repository" : null);
    if (scope) {
      decision.intentLabel = "code_review";
      decision.workflowId = "repository_review";
      decision.reviewScope = scope;
    }
  }

  if (
    options?.userMessage &&
    classifyUserExecutionIntent(options.userMessage) === "fix_review_findings"
  ) {
    decision.intentLabel = "fix_review_findings";
    decision.workflowId = "review_remediation";
  }

  if (assignment) {
    decision.workflowKind = assignment.workflowKind;
    decision.workflowPhase = assignment.phase;
    decision.modelRole = assignment.modelRole;
    decision.toolProfile = assignment.toolProfile;
  }

  return decision;
}

/**
 * Map task type to most appropriate agent.
 * Feature work prefers planner before file edits (Phase 2B).
 */
function mapTaskTypeToAgent(taskType: TaskType, preferPlannerFirst: boolean): ModelTargetAgent {
  switch (taskType) {
    case "small_code_change":
      return preferPlannerFirst ? "planner" : "coder";
    case "large_code_change":
    case "refactoring":
      return preferPlannerFirst ? "planner" : "coder";
    case "debugging":
      return "debugger";
    case "review":
    case "test_analysis":
      return "reviewer";
    case "planning":
    case "architecture":
      return "planner";
    case "normal_chat":
    case "casual_chat":
    default:
      return "default";
  }
}

/**
 * Map task type to runtime slot.
 * - Fast GPU: coding, debugging, review, planning (needs throughput)
 * - Quality CPU: chat (default)
 * - Utility: embedding/reranking/indexing
 */
function mapTaskTypeToSlot(taskType: TaskType): RuntimeSlotId {
  if (taskType === "embedding" || taskType === "reranking" || taskType === "indexing") {
    return "utility";
  }

  if (taskType === "small_code_change" || taskType === "large_code_change" || taskType === "debugging" || taskType === "review" || taskType === "planning" || taskType === "architecture" || taskType === "test_analysis" || taskType === "refactoring") {
    return "fast_gpu";
  }

  return "quality_cpu";
}

function mapModelRoleToSlot(modelRole: WorkflowModelRole, taskType: TaskType): RuntimeSlotId {
  switch (modelRole) {
    case "chat":
      return "quality_cpu";
    case "planner":
    case "debug":
    case "coder":
    case "review":
    default:
      return mapTaskTypeToSlot(taskType);
  }
}

/**
 * Select model for the specific task / target agent.
 */
function selectModelForTask(
  taskType: TaskType,
  settings: {
    defaultModelId: string;
    defaultChatModelId?: string;
    defaultPlannerModelId?: string;
    defaultCoderModelId?: string;
    defaultReviewerModelId?: string;
    defaultDebugModelId?: string;
    defaultVisionModelId?: string;
  },
  targetAgent: ModelTargetAgent,
): string | undefined {
  if (targetAgent === "planner") {
    return settings.defaultPlannerModelId || undefined;
  }
  switch (taskType) {
    case "small_code_change":
    case "large_code_change":
    case "refactoring":
      return settings.defaultCoderModelId || undefined;
    case "debugging":
      return settings.defaultDebugModelId || undefined;
    case "review":
    case "test_analysis":
      return settings.defaultReviewerModelId || undefined;
    case "planning":
    case "architecture":
      return settings.defaultPlannerModelId || undefined;
    case "image_analysis":
    case "ui_analysis":
    case "visual_debugging":
    case "document_vision":
      return settings.defaultVisionModelId || settings.defaultChatModelId || settings.defaultModelId || undefined;
    case "casual_chat":
    case "normal_chat":
      return settings.defaultChatModelId || settings.defaultModelId || undefined;
    default:
      return settings.defaultChatModelId || settings.defaultModelId || undefined;
  }
}

function selectModelForRole(
  modelRole: WorkflowModelRole,
  settings: {
    defaultModelId: string;
    defaultChatModelId?: string;
    defaultPlannerModelId?: string;
    defaultCoderModelId?: string;
    defaultReviewerModelId?: string;
    defaultDebugModelId?: string;
    defaultVisionModelId?: string;
  },
  targetAgent: ModelTargetAgent
): string | undefined {
  if (targetAgent === "planner") {
    return settings.defaultPlannerModelId || undefined;
  }

  switch (modelRole) {
    case "planner":
      return settings.defaultPlannerModelId || undefined;
    case "coder":
      return settings.defaultCoderModelId || undefined;
    case "debug":
      return settings.defaultDebugModelId || undefined;
    case "review":
      return settings.defaultReviewerModelId || undefined;
    case "chat":
    default:
      return settings.defaultChatModelId || settings.defaultModelId || undefined;
  }
}

/**
 * Verify that a decision is still valid.
 * Used before actually sending request to runtime.
 */
export function isDecisionStillValid(
  decision: ModelSelectionDecision,
  ageMs: number = 5000, // Max 5 seconds old
  currentSettingsRevision?: number,
): boolean {
  const decisionAge = Date.now() - decision.decidedAt.getTime();

  if (decisionAge > ageMs) {
    return false; // Decision is too old
  }

  if (
    typeof currentSettingsRevision === "number" &&
    decision.decisionSettingsRevision !== currentSettingsRevision
  ) {
    return false;
  }

  return true;
}

/**
 * Re-derive the role-setting-based configuredModelId a decision would get
 * with the *current* settings, and compare it against the value the decision
 * was actually bound with. Used as a targeted alternative to a raw
 * settingsRevision comparison: with "Lazy Runtime" (routing happens before
 * the work model is actually started - see runtimeChatStore.ts), a slow
 * model warmup can leave a routing decision pending for minutes, during
 * which the settingsRevision counter can bump for entirely unrelated reasons
 * (theme, editor font size, ...). A raw revision mismatch there would throw
 * away an already-in-flight request even though nothing routing-relevant
 * changed. This only returns true when the specific settings field that fed
 * this decision's model selection actually changed.
 */
export function hasRoutingRelevantSettingsChanged(
  decision: Pick<ModelSelectionDecision, "taskType" | "targetAgent" | "modelRole" | "configuredModelId">,
  settings: {
    defaultModelId: string;
    defaultChatModelId?: string;
    defaultPlannerModelId?: string;
    defaultCoderModelId?: string;
    defaultReviewerModelId?: string;
    defaultDebugModelId?: string;
    defaultVisionModelId?: string;
  },
): boolean {
  const currentConfiguredModelId =
    (decision.modelRole
      ? selectModelForRole(decision.modelRole, settings, decision.targetAgent)
      : selectModelForTask(decision.taskType, settings, decision.targetAgent)) ?? "";
  return currentConfiguredModelId !== decision.configuredModelId;
}

/**
 * Utility: Format decision for logging/diagnostics.
 */
export function formatDecision(decision: ModelSelectionDecision): string {
  return [
    `task=${decision.taskType}`,
    `agent=${decision.targetAgent}`,
    `slot=${decision.slotId}`,
    `model=${decision.modelId}`,
    `policy=${decision.fallbackPolicy}`,
    `reasons=[${decision.reason.join("; ")}]`,
  ].join(" | ");
}
export const modelSelectionBroker = new ModelSelectionBroker();
