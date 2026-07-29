/**
 * Central status-word mapping, per docs/architecture/ui-system.md.
 *
 * The app has many different status enums (RuntimeState, RuntimeChatRunStatus,
 * AgentRun status, RepositoryReviewStatus, ...). Historically each surface
 * invented its own label/color for "the same" underlying state (e.g. "bereit"
 * vs "online" vs "READY" vs "AKTIV" all meaning roughly the same thing). This
 * module is the single place that normalizes any of those raw status strings
 * onto the four vocabulary words the design doc defines, so the same
 * technical state always reads and looks the same everywhere.
 */

export type StatusTone = "cyan" | "green" | "amber" | "red";
export type StatusVocabularyWord = "starting" | "live" | "ready" | "degraded" | "failed";

export interface ResolvedStatus {
  word: StatusVocabularyWord;
  label: string;
  tone: StatusTone;
}

const WORD_LABEL: Record<StatusVocabularyWord, string> = {
  starting: "Startet",
  live: "Aktiv",
  ready: "Bereit",
  degraded: "Eingeschränkt",
  failed: "Fehlgeschlagen"
};

const WORD_TONE: Record<StatusVocabularyWord, StatusTone> = {
  starting: "cyan",
  live: "cyan",
  ready: "green",
  degraded: "amber",
  failed: "red"
};

const STARTING_STATES = new Set([
  "starting",
  "preparing",
  "routing",
  "waiting_first_token",
  "loading",
  "pending",
  "queued",
  "indexing"
]);

const LIVE_STATES = new Set([
  "running",
  "streaming",
  "running_tools",
  "resuming",
  "resuming_after_plan_approval",
  "live",
  "active"
]);

const READY_STATES = new Set([
  "ready",
  "completed",
  "idle",
  "pass",
  "passed",
  "applied",
  "approved",
  "chat_ready"
]);

const DEGRADED_STATES = new Set([
  "degraded",
  "partial",
  "waiting_for_plan_approval",
  "waiting_for_patch_approval",
  "waiting_for_command_approval",
  "waiting_for_web_approval",
  "waiting_for_user_answer",
  "collecting",
  "completed_with_warnings",
  "degraded_heuristic_only"
]);

const FAILED_STATES = new Set([
  "failed",
  "fail",
  "error",
  "cancelled",
  "canceled",
  "timeout",
  "rejected",
  "stopped",
  "expired"
]);

/**
 * Resolves a raw status string (from any of the app's status enums) to the
 * shared four-word vocabulary. `degraded` forces the degraded word/tone
 * regardless of the raw state — used for e.g. `RuntimeChatRun.degraded`,
 * which is an independent flag rather than part of the status enum itself.
 */
export function resolveStatusVocabulary(
  state: string | null | undefined,
  options?: { degraded?: boolean }
): ResolvedStatus {
  if (options?.degraded) {
    return { word: "degraded", label: WORD_LABEL.degraded, tone: WORD_TONE.degraded };
  }

  const normalized = (state ?? "").trim().toLowerCase();

  if (FAILED_STATES.has(normalized)) {
    return { word: "failed", label: WORD_LABEL.failed, tone: WORD_TONE.failed };
  }
  if (DEGRADED_STATES.has(normalized)) {
    return { word: "degraded", label: WORD_LABEL.degraded, tone: WORD_TONE.degraded };
  }
  if (READY_STATES.has(normalized)) {
    return { word: "ready", label: WORD_LABEL.ready, tone: WORD_TONE.ready };
  }
  if (LIVE_STATES.has(normalized)) {
    return { word: "live", label: WORD_LABEL.live, tone: WORD_TONE.live };
  }
  if (STARTING_STATES.has(normalized)) {
    return { word: "starting", label: WORD_LABEL.starting, tone: WORD_TONE.starting };
  }

  // Unmapped state: show it plainly rather than mislabeling it as one of the
  // four words — better to surface an unfamiliar raw value than to falsely
  // claim "ready" or hide a state that might matter.
  return { word: "live", label: state ? String(state) : "Unbekannt", tone: "cyan" };
}
