import type { ReactNode } from "react";

export type DecisionCardTone = "cyan" | "amber" | "red" | "green";

interface DecisionCardProps {
  /** e.g. "Chat-Freigabe · Patch", "Job-Review · Step 3", "Tool-Freigabe · run_terminal_command" */
  kind: string;
  tone?: DecisionCardTone;
  title?: string;
  timestamp?: string;
  /** Optional trailing badge, e.g. a resolved "Freigegeben"/"Abgelehnt" pill. */
  statusBadge?: ReactNode;
  children: ReactNode;
  /** Usually a Freigeben/Ablehnen Button pair; omit once resolved. */
  footer?: ReactNode;
}

const TONE_CLASS: Record<DecisionCardTone, string> = {
  cyan: "border-dbzs-cyan/30 bg-dbzs-cyan/5",
  amber: "border-dbzs-amber/30 bg-dbzs-amber/5",
  red: "border-dbzs-red/30 bg-dbzs-red/5",
  green: "border-dbzs-green/30 bg-dbzs-green/5"
};

const TONE_LABEL_CLASS: Record<DecisionCardTone, string> = {
  cyan: "text-dbzs-cyan",
  amber: "text-dbzs-amber",
  red: "text-dbzs-red",
  green: "text-dbzs-green"
};

/**
 * Shared frame for every "this needs a decision" card in RuntimeChat
 * (chat takeover approvals, job review gates, structured chat actions, tool
 * approvals, assistant questions, review-remediation choices). These six
 * card types previously each hand-rolled their own `<article>` with subtly
 * different border/background tones and raw (non-dbzs-token) colors for the
 * same "kind of decision" concept — this gives them one consistent header/
 * footer shape while leaving the body content fully custom per card type.
 */
export function DecisionCard({
  kind,
  tone = "cyan",
  title,
  timestamp,
  statusBadge,
  children,
  footer
}: DecisionCardProps) {
  return (
    <article className={`rounded border p-3 ${TONE_CLASS[tone]}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`text-[10px] font-medium uppercase tracking-[0.12em] ${TONE_LABEL_CLASS[tone]}`}>
            {kind}
          </div>
          {title ? <h4 className="mt-1 truncate text-xs font-medium text-dbzs-text">{title}</h4> : null}
        </div>
        {statusBadge ? <div className="shrink-0">{statusBadge}</div> : null}
        {timestamp && !statusBadge ? (
          <div className="shrink-0 text-[10px] text-dbzs-muted">{timestamp}</div>
        ) : null}
      </div>

      {children}

      {footer ? <div className="mt-3 flex items-center gap-2">{footer}</div> : null}
    </article>
  );
}
