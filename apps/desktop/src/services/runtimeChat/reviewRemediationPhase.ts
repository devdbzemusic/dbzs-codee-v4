import type { AssistantQuestion, ModelTargetAgent, RepositoryReviewFinding, RuntimeChatMessage, RuntimeTaskType, WorkspaceFile } from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import type { ActiveTaskContract } from "@/services/activeTaskContract";
import { upsertActiveTaskContract } from "@/services/activeTaskContract";
import type { IntentClassification } from "@/services/modelSelectionBroker";
import type { UserExecutionIntent } from "@/services/executionIntent";
import {
  buildFindingSelectionQuestion,
  buildReviewSelectionQuestion,
  extractRemediationScope,
  extractReviewId,
  loadReviewFindingsForRemediation,
  REVIEW_REMEDIATION_WORKFLOW_ID
} from "@/services/reviewRemediation";
import {
  beginReviewRemediationQuestion,
  createReviewRemediationSelection,
  readReviewRemediationSelection,
  writeReviewRemediationSelection
} from "@/services/reviewRemediationSelection";

function createMessageId(prefix: string): string {
  return `msg-${Date.now().toString(36)}-${prefix}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface ReviewRemediationInput {
  trimmedContent: string;
  workspaceRootForWorkflow: string | null;
  workspaceRootEarly: string | null;
  executionIntent: UserExecutionIntent;
  activeTaskContract: ActiveTaskContract | null;
  intentClassification: IntentClassification;
  appendMessages: (messages: RuntimeChatMessage[]) => void;
  /** Patches `remediationReviews` onto the just-appended action whose question id matches. */
  markActionRemediationReviews: (questionId: string, reviews: unknown) => void;
}



export type ReviewRemediationOutcome =
  | { kind: "not_applicable" }
  | { kind: "handled" }
  | {
      kind: "continue";
      activeTaskContract: ActiveTaskContract;
      effectiveAgent: "planner";
      taskType: "planning";
      intentClassification: IntentClassification;
    };

/**
 * Detects and drives the "fix review findings" workflow branch: locates a
 * completed review, resolves scope/finding selection (asking clarifying
 * questions via `appendMessages` when needed), and — once fully resolved —
 * returns an updated `activeTaskContract` for the caller to continue with.
 * Mirrors the original inline `sendMessage` branch exactly, just with `set()`
 * replaced by the injected `appendMessages`/`markActionsRemediationReviews`.
 */
export async function runReviewRemediationPhase(
  input: ReviewRemediationInput
): Promise<ReviewRemediationOutcome> {
  const {
    trimmedContent,
    workspaceRootForWorkflow,
    workspaceRootEarly,
    executionIntent,
    activeTaskContract: initialActiveTaskContract,
    intentClassification,
    appendMessages,
    markActionRemediationReviews
  } = input;

  const isReviewRemediation =
    executionIntent === "fix_review_findings" ||
    (initialActiveTaskContract?.workflowId === REVIEW_REMEDIATION_WORKFLOW_ID &&
      !initialActiveTaskContract.reviewRemediation);
  if (!isReviewRemediation) {
    return { kind: "not_applicable" };
  }

  let activeTaskContract = initialActiveTaskContract;

  const remediationWorkspaceRoot = workspaceRootForWorkflow ?? workspaceRootEarly;
  if (!remediationWorkspaceRoot) {
    appendMessages([
      { id: createMessageId("user-remediation"), role: "user", content: trimmedContent },
      {
        id: createMessageId("system-remediation-workspace"),
        role: "system",
        content: "Zum Beheben von Review-Findings muss zuerst ein Workspace geöffnet sein."
      }
    ]);
    return { kind: "handled" };
  }

  const remediationWorkspaceId = workspaceScopeId(remediationWorkspaceRoot);
  const askRemediationQuestion = (question: AssistantQuestion): { kind: "handled" } => {
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const messageId = createMessageId("review-remediation-question");
    const action = {
      id: `act-${Math.random().toString(36).substring(2, 10)}`,
      runId,
      messageId,
      workspaceRoot: remediationWorkspaceRoot,
      workspaceId: remediationWorkspaceId,
      kind: "answer_question" as const,
      title: question.prompt,
      description: question.context,
      riskLevel: question.riskLevel ?? "low",
      payload: {
        question,
        preflight: {
          originalMessage: trimmedContent,
          targetAgent: "planner" as ModelTargetAgent,
          workspaceRoot: remediationWorkspaceRoot,
          workflow: REVIEW_REMEDIATION_WORKFLOW_ID,
          taskType: "planning" as RuntimeTaskType
        }
      },
      state: "pending" as const,
      createdAt: new Date().toISOString()
    };
    activeTaskContract = upsertActiveTaskContract(remediationWorkspaceRoot, {
      workflowId: REVIEW_REMEDIATION_WORKFLOW_ID,
      originalRequest: activeTaskContract?.originalRequest ?? trimmedContent,
      confirmedGoal: activeTaskContract?.confirmedGoal ?? "Ausgewählte Review-Findings beheben",
      taskType: "planning",
      assignedAgent: "planner",
      currentPhase: "clarification"
    });
    appendMessages([
      { id: createMessageId("user-remediation"), role: "user", content: trimmedContent },
      { id: messageId, role: "system", content: question.prompt, actions: [action] }
    ]);
    return { kind: "handled" };
  };

  const reviewApi = window.dbzs;
  let reviews: Awaited<ReturnType<NonNullable<typeof reviewApi.listReviewArtifacts>>> = [];
  try {
    reviews = (await reviewApi.listReviewArtifacts?.(remediationWorkspaceRoot) ?? [])
      .filter((review) => review.status === "completed");
  } catch (error) {
    appendMessages([
      {
        id: createMessageId("system-remediation-registry-error"),
        role: "system",
        content: `Review-Registry konnte nicht sicher geladen werden: ${
          error instanceof Error ? error.message : "unbekannter Fehler"
        }`
      }
    ]);
    return { kind: "handled" };
  }
  if (reviews.length === 0) {
    return askRemediationQuestion({
      id: "review-remediation-missing-review",
      questionType: "free_text",
      prompt: "Es gibt noch keinen abgeschlossenen Review. Welcher Review soll verwendet werden?",
      context: "Führe einen Repository-Review aus oder nenne anschließend dessen Review-ID.",
      allowFreeText: true,
      freeTextPlaceholder: "rev-…",
      riskLevel: "low",
      toolCallId: "review-remediation-preflight",
      requiredField: "review_selection",
      workflow: "planning"
    });
  }
  let selection =
    (await readReviewRemediationSelection(remediationWorkspaceRoot)) ??
    createReviewRemediationSelection(remediationWorkspaceRoot);
  const explicitReviewId = extractReviewId(trimmedContent);
  const explicitScope = extractRemediationScope(trimmedContent);
  if (
    selection.status === "cancelled" ||
    selection.status === "consumed" ||
    (explicitReviewId && selection.reviewId !== explicitReviewId)
  ) {
    selection = createReviewRemediationSelection(remediationWorkspaceRoot);
  }
  if (selection.status !== "complete" && explicitReviewId) {
    const explicitReview = reviews.find((candidate) => candidate.reviewId === explicitReviewId);
    if (explicitReview) {
      selection = {
        ...selection,
        reviewId: explicitReview.reviewId,
        scope:
          explicitScope === "individual"
            ? "selected"
            : explicitScope ?? selection.scope ?? "p0_p2",
        selectedFindingIds: explicitScope === "individual" ? selection.selectedFindingIds : [],
        reviewConfirmed: true,
        scopeConfirmed: true,
        status: "complete",
        pendingQuestionId: null,
        updatedAt: new Date().toISOString()
      };
      await writeReviewRemediationSelection(remediationWorkspaceRoot, selection);
    }
  }
  if (selection.status !== "complete") {
    const questionId = `review-remediation-selection-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const question: AssistantQuestion = {
      id: questionId,
      questionType: "single_choice",
      prompt: "Review und Finding-Scope auswählen",
      context: "Beide Angaben werden gemeinsam und workspace-gebunden gespeichert.",
      riskLevel: "low",
      toolCallId: "review-remediation-preflight",
      requiredField: "review_remediation_selection",
      workflow: "planning"
    };
    await beginReviewRemediationQuestion(remediationWorkspaceRoot, questionId);
    askRemediationQuestion(question);
    markActionRemediationReviews(question.id, reviews);
    return { kind: "handled" };
  }
  const requestedReviewId = selection.reviewId;
  if (!requestedReviewId && reviews.length > 1) {
    return askRemediationQuestion(buildReviewSelectionQuestion(reviews));
  }
  const review =
    reviews.find((candidate) => candidate.reviewId === requestedReviewId) ??
    (requestedReviewId ? null : reviews[0]);
  if (!review) {
    return askRemediationQuestion(buildReviewSelectionQuestion(reviews));
  }
  let deterministicRemediation: Awaited<ReturnType<typeof loadReviewFindingsForRemediation>>;
  try {
    deterministicRemediation = await loadReviewFindingsForRemediation({
      workspaceId: remediationWorkspaceId,
      selection,
      reviews,
      openFindings: async (reviewId) =>
        reviewApi.openReviewArtifact?.(remediationWorkspaceRoot, reviewId, "findings")
    });
  } catch (error) {
    appendMessages([
      {
        id: createMessageId("system-remediation-findings-error"),
        role: "system",
        content: `Findings konnten nicht sicher geladen werden: ${
          error instanceof Error ? error.message : "findings_invalid"
        }`
      }
    ]);
    return { kind: "handled" };
  }

  let findingsFile: WorkspaceFile | undefined;
  try {
    findingsFile = await reviewApi.openReviewArtifact?.(remediationWorkspaceRoot, review.reviewId, "findings");
  } catch (error) {
    appendMessages([
      {
        id: createMessageId("system-remediation-findings-error"),
        role: "system",
        content: `Findings konnten nicht sicher geöffnet werden: ${
          error instanceof Error ? error.message : "unbekannter Fehler"
        }`
      }
    ]);
    return { kind: "handled" };
  }
  let reviewFindings: RepositoryReviewFinding[] = [];
  try {
    const parsed = JSON.parse(findingsFile?.content ?? "[]");
    reviewFindings = Array.isArray(parsed) ? (parsed as RepositoryReviewFinding[]) : [];
  } catch {
    appendMessages([
      {
        id: createMessageId("system-remediation-findings-invalid"),
        role: "system",
        content: `Die Findings von ${review.reviewId} sind nicht als gültiges JSON lesbar.`
      }
    ]);
    return { kind: "handled" };
  }

  const scope = selection.scope === "selected" ? "individual" : selection.scope;
  const selectedFindingIds = selection.selectedFindingIds;
  if (scope === "individual" && selectedFindingIds.length === 0) {
    const question = buildFindingSelectionQuestion(reviewFindings);
    const uniqueQuestion = {
      ...question,
      id: `${question.id}-${Date.now().toString(36)}`
    };
    await beginReviewRemediationQuestion(remediationWorkspaceRoot, uniqueQuestion.id);
    return askRemediationQuestion(uniqueQuestion);
  }

  const remediationCapsule = deterministicRemediation.capsule;
  activeTaskContract = upsertActiveTaskContract(remediationWorkspaceRoot, {
    workflowId: REVIEW_REMEDIATION_WORKFLOW_ID,
    originalRequest: activeTaskContract?.originalRequest ?? trimmedContent,
    confirmedGoal: `Findings aus Review ${review.reviewId} beheben`,
    acceptanceCriteria: [
      "Genehmigter Fix-Plan wurde umgesetzt",
      "Mindestens ein Finding wurde durch einen relevanten Check verifiziert",
      "Originales findings.json bleibt unverändert"
    ],
    taskType: "planning",
    assignedAgent: "planner",
    currentPhase: "planning",
    reviewRemediation: remediationCapsule
  });

  return {
    kind: "continue",
    activeTaskContract,
    effectiveAgent: "planner",
    taskType: "planning",
    intentClassification: { ...intentClassification, taskType: "planning" }
  };
}
