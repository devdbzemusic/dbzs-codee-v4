import type {
  AssistantAnswer,
  AssistantQuestion,
  ReviewArtifactSummary,
  ReviewRemediationSelectionScope
} from "@dbzs/shared";
import { useState } from "react";

export function ReviewRemediationSelectionCard({
  question,
  reviews,
  busy,
  onSubmit
}: {
  question: AssistantQuestion;
  reviews: ReviewArtifactSummary[];
  busy: boolean;
  onSubmit: (answer: AssistantAnswer) => void;
}) {
  const [reviewId, setReviewId] = useState(reviews[0]?.reviewId ?? "");
  const [scope, setScope] = useState<ReviewRemediationSelectionScope>("p0_p2");
  const scopes: Array<{ id: ReviewRemediationSelectionScope; label: string }> = [
    { id: "p0_p1", label: "nur P0/P1" },
    { id: "p0_p2", label: "P0 bis P2 (empfohlen)" },
    { id: "all", label: "alle Findings" },
    { id: "selected", label: "einzelne Findings" }
  ];

  return (
    <article className="rounded border border-dbzs-cyan/40 bg-dbzs-cyan/5 p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-dbzs-cyan">
        Review beheben
      </div>
      <h4 className="mt-1 text-xs font-medium text-dbzs-text">{question.prompt}</h4>

      <label className="mt-3 block text-[11px] text-dbzs-muted">
        Review
        <select
          className="mt-1 w-full rounded border border-dbzs-border bg-dbzs-bg px-2 py-1.5 text-dbzs-text"
          disabled={busy}
          onChange={(event) => setReviewId(event.target.value)}
          value={reviewId}
        >
          {reviews.map((review) => (
            <option key={review.reviewId} value={review.reviewId}>
              {review.reviewId} · {review.updatedAt}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="mt-3 space-y-1.5">
        <legend className="text-[11px] text-dbzs-muted">Scope</legend>
        {scopes.map((entry) => (
          <label className="flex items-center gap-2 text-[11px] text-dbzs-text" key={entry.id}>
            <input
              checked={scope === entry.id}
              disabled={busy}
              name={`remediation-scope-${question.id}`}
              onChange={() => setScope(entry.id)}
              type="radio"
            />
            {entry.label}
          </label>
        ))}
      </fieldset>

      <div className="mt-3 flex gap-2">
        <button
          className="flex-1 rounded border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1.5 text-xs font-medium text-dbzs-cyan disabled:opacity-40"
          disabled={busy || !reviewId}
          onClick={() =>
            onSubmit({
              questionId: question.id,
              answeredAt: new Date().toISOString(),
              optionIds: [reviewId, scope]
            })
          }
          type="button"
        >
          Fix-Plan erstellen
        </button>
        <button
          className="rounded border border-dbzs-border bg-dbzs-bg px-3 py-1.5 text-xs text-dbzs-muted"
          disabled={busy}
          onClick={() =>
            onSubmit({
              questionId: question.id,
              answeredAt: new Date().toISOString(),
              skipped: true
            })
          }
          type="button"
        >
          Abbrechen
        </button>
      </div>
    </article>
  );
}
