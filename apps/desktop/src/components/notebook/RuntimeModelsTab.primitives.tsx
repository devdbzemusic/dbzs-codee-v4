import type { ReactNode } from "react";

export type UiTone = "ok" | "warn" | "error" | "info";
export type ProbeEvidenceTone = UiTone;

export interface ProbeEvidenceItem {
  tone: ProbeEvidenceTone;
  text: string;
}

export interface ProbeOutcomeSummary {
  label: string;
  tone: ProbeEvidenceTone;
}

function probeToneClasses(tone: ProbeEvidenceTone): string {
  if (tone === "ok") {
    return "border-dbzs-cyan/30 bg-dbzs-cyan/10 text-dbzs-cyan";
  }
  if (tone === "warn") {
    return "border-amber-400/30 bg-amber-400/10 text-amber-300";
  }
  if (tone === "error") {
    return "border-red-400/30 bg-red-400/10 text-red-300";
  }
  return "border-dbzs-border bg-dbzs-bg text-dbzs-muted";
}

function statusBadgeClasses(tone: UiTone): string {
  if (tone === "ok") {
    return "border-dbzs-cyan/30 bg-dbzs-cyan/10 text-dbzs-cyan";
  }
  if (tone === "warn") {
    return "border-amber-400/30 bg-amber-400/10 text-amber-300";
  }
  if (tone === "error") {
    return "border-red-400/30 bg-red-400/10 text-red-300";
  }
  return "border-dbzs-border bg-dbzs-bg text-dbzs-muted";
}

function hintToneClasses(tone: UiTone): string {
  if (tone === "ok") {
    return "border-dbzs-cyan/20 bg-dbzs-cyan/5 text-dbzs-cyan";
  }
  if (tone === "warn") {
    return "border-amber-400/20 bg-amber-400/5 text-amber-200";
  }
  if (tone === "error") {
    return "border-red-400/20 bg-red-400/5 text-red-200";
  }
  return "border-dbzs-border/70 bg-dbzs-bg text-dbzs-muted";
}

export function ToneBadge({
  tone,
  children,
  title,
  fit = false,
  uppercase = true,
  className = ""
}: {
  tone: UiTone;
  children: ReactNode;
  title?: string;
  fit?: boolean;
  uppercase?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`${fit ? "w-fit " : ""}inline-flex rounded border px-1.5 py-0.5 text-[9px] ${uppercase ? "uppercase tracking-[0.14em] " : ""}${statusBadgeClasses(tone)} ${className}`.trim()}
      title={title}
    >
      {children}
    </span>
  );
}

export function StatusDotBadge({
  tone,
  label,
  active = false
}: {
  tone: UiTone;
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(tone)}`}
    >
      {active ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {label}
    </span>
  );
}

export function HintBox({
  tone,
  children,
  className = ""
}: {
  tone: UiTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`rounded border px-1.5 py-1 text-[10px] ${hintToneClasses(tone)} ${className}`.trim()}>
      {children}
    </span>
  );
}

export function SummaryBadge({
  tone,
  children
}: {
  tone: UiTone;
  children: ReactNode;
}) {
  return <span className={`border px-2 py-0.5 text-[10px] ${statusBadgeClasses(tone)}`}>{children}</span>;
}

export function ProbeEvidencePanel({
  feedback,
  outcome,
  evidence,
  align = "right"
}: {
  feedback: string;
  outcome: ProbeOutcomeSummary;
  evidence: ProbeEvidenceItem[];
  align?: "left" | "right";
}) {
  const alignClass = align === "right" ? "items-end text-right" : "items-start text-left";

  return (
    <div className={`mt-1 flex max-w-[320px] flex-col gap-1 rounded border p-2 ${probeToneClasses(outcome.tone)} ${alignClass}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] ${probeToneClasses(outcome.tone)}`}>
          {outcome.label}
        </span>
        <span className="text-[10px]">{feedback}</span>
      </div>
      {evidence.length > 0 ? (
        <div className={`flex flex-col gap-1 text-[9px] ${alignClass}`}>
          {evidence.map((item) => (
            <span className={`rounded border px-1.5 py-1 ${probeToneClasses(item.tone)}`} key={`${item.tone}:${item.text}`}>
              {item.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
