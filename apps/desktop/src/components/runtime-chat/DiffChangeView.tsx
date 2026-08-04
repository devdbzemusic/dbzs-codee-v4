import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { RiskBadge, type RiskLevel } from "@/components/ui/RiskBadge";

export function renderColoredDiff(diff: string) {
  if (!diff.trim()) {
    return <p className="text-dbzs-muted">Kein Diff vorhanden.</p>;
  }

  return (
    <div className="font-mono text-[10px] leading-relaxed">
      {diff.split("\n").map((line, index) => {
        let className = "text-dbzs-muted";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          className = "text-dbzs-green bg-dbzs-green/5";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          className = "text-dbzs-red bg-dbzs-red/5";
        } else if (line.startsWith("@@")) {
          className = "text-dbzs-cyan";
        } else if (line.startsWith("+++") || line.startsWith("---")) {
          className = "text-dbzs-text font-semibold";
        }
        return (
          <div className={`whitespace-pre-wrap break-words px-2 ${className}`} key={index}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

interface DiffChangeViewProps {
  fileLabel: string;
  diff: string;
  source?: string;
  reason?: string;
  risk?: RiskLevel | string;
  busy?: boolean;
  onApply?: () => void;
  onReject?: () => void;
  onReset?: () => void;
  applyLabel?: string;
  rejectLabel?: string;
  resetLabel?: string;
  extraActions?: ReactNode;
}

/**
 * Single shared diff/apply/reject/reset presentation, used by DiffPanel
 * (editor pending-changes), RuntimeChatPatchPanel (chat patch proposals),
 * and CodeeRunLiveBlock's inline file-change cards. These three previously
 * each rendered their own diff (only DiffPanel had real colored diff lines)
 * with different button labels for the same actions (Anwenden/Übernehmen,
 * Verwerfen/Ablehnen, Zurücksetzen/Rollback). This component owns no state —
 * callers wire it to whichever store (useEditorStore vs. the chat patch
 * proposal state) actually owns the change.
 */
export function DiffChangeView({
  fileLabel,
  diff,
  source,
  reason,
  risk,
  busy = false,
  onApply,
  onReject,
  onReset,
  applyLabel = "Übernehmen",
  rejectLabel = "Ablehnen",
  resetLabel = "Zurücksetzen",
  extraActions
}: DiffChangeViewProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-dbzs-text">{fileLabel}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-dbzs-muted">
            {source ? <span>{source}</span> : null}
            {risk ? <RiskBadge level={risk} /> : null}
          </div>
          {reason ? <div className="mt-0.5 truncate text-[11px] text-dbzs-muted">{reason}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onApply ? (
            <Button variant="primary" disabled={busy} onClick={onApply}>
              <span className="inline-flex items-center gap-1">
                <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {applyLabel}
              </span>
            </Button>
          ) : null}
          {onReject ? (
            <Button disabled={busy} onClick={onReject}>
              <span className="inline-flex items-center gap-1">
                <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
                {rejectLabel}
              </span>
            </Button>
          ) : null}
          {onReset ? (
            <Button disabled={busy} onClick={onReset}>
              <span className="inline-flex items-center gap-1">
                <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {resetLabel}
              </span>
            </Button>
          ) : null}
          {extraActions}
        </div>
      </div>
      <div className="max-h-72 overflow-auto rounded border border-dbzs-border bg-dbzs-bg">
        {renderColoredDiff(diff)}
      </div>
    </div>
  );
}
