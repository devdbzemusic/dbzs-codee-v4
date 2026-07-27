import { useState } from "react";

export type AgentReviewItem = {
  gateId: string;
  filePath: string;
  diff: string;
  riskLevel: "low" | "medium" | "high";
  stepId: string | null;
};

export type AgentReviewDockProps = {
  reviews: AgentReviewItem[];
  selectedGateId: string | null;
  isMutating: boolean;
  onSelectGate: (gateId: string) => void;
  onApprove: (gateId: string, comment: string) => void;
  onReject: (gateId: string, reason: string) => void;
  onOpenFile?: (filePath: string) => void;
};

export function AgentReviewDock({
  reviews,
  selectedGateId,
  isMutating,
  onSelectGate,
  onApprove,
  onReject,
  onOpenFile
}: AgentReviewDockProps) {
  const [comment, setComment] = useState("");
  const selected =
    reviews.find((entry) => entry.gateId === selectedGateId) ?? reviews[0] ?? null;

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-dbzs-text">Review Dock</h3>
        {reviews.length > 0 ? (
          <span className="rounded border border-dbzs-amber/40 bg-dbzs-amber/10 px-2 py-0.5 text-[10px] text-dbzs-amber">
            {reviews.length} offen
          </span>
        ) : null}
      </div>

      {reviews.length === 0 ? (
        <div className="mt-3 rounded border border-dashed border-dbzs-border p-3 text-xs text-dbzs-muted">
          Keine offenen Reviews. Patches laufen über die Safe Patch Pipeline.
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            {reviews.map((review) => (
              <button
                className={`max-w-full truncate border px-2 py-1 text-[10px] ${
                  selected?.gateId === review.gateId
                    ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan"
                    : "border-dbzs-border bg-dbzs-bg text-dbzs-muted"
                }`}
                key={review.gateId}
                onClick={() => onSelectGate(review.gateId)}
                type="button"
              >
                {review.filePath}
              </button>
            ))}
          </div>

          {selected ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <button
                  className="truncate text-dbzs-cyan hover:underline"
                  onClick={() => onOpenFile?.(selected.filePath)}
                  type="button"
                >
                  {selected.filePath}
                </button>
                <span className="text-dbzs-muted">Risiko: {selected.riskLevel}</span>
              </div>
              <pre className="max-h-40 overflow-auto border border-dbzs-border bg-dbzs-bg p-2 text-[10px] text-dbzs-muted">
                {selected.diff || "Kein Diff verfügbar."}
              </pre>
              <textarea
                className="h-14 w-full resize-y border border-dbzs-border bg-dbzs-bg p-2 text-xs text-dbzs-text"
                onChange={(event) => setComment(event.currentTarget.value)}
                placeholder="Review-Kommentar oder Ablehnungsgrund"
                value={comment}
              />
              <div className="flex gap-2">
                <button
                  className="border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
                  disabled={isMutating}
                  onClick={() => onApprove(selected.gateId, comment)}
                  type="button"
                >
                  Approve
                </button>
                <button
                  className="border border-dbzs-red/40 bg-dbzs-red/10 px-2 py-1 text-xs text-dbzs-red disabled:opacity-40"
                  disabled={isMutating}
                  onClick={() => onReject(selected.gateId, comment)}
                  type="button"
                >
                  Reject
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
