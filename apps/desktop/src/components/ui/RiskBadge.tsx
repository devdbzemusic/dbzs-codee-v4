export type RiskLevel = "low" | "medium" | "high";
export type ReviewSeverity = "P0" | "P1" | "P2" | "P3";

interface RiskBadgeProps {
  /** Either a generic risk level or a review-finding severity — exactly one. */
  level?: RiskLevel | string;
  severity?: ReviewSeverity;
  label?: string;
}

const RISK_CLASS: Record<RiskLevel, string> = {
  low: "border-dbzs-green/40 bg-dbzs-green/10 text-dbzs-green",
  medium: "border-dbzs-amber/40 bg-dbzs-amber/10 text-dbzs-amber",
  high: "border-dbzs-red/40 bg-dbzs-red/10 text-dbzs-red"
};

const SEVERITY_CLASS: Record<ReviewSeverity, string> = {
  P0: "border-dbzs-red/40 bg-dbzs-red/10 text-dbzs-red",
  P1: "border-dbzs-amber/40 bg-dbzs-amber/10 text-dbzs-amber",
  P2: "border-dbzs-cyan/40 bg-dbzs-cyan/10 text-dbzs-cyan",
  P3: "border-dbzs-border bg-dbzs-panelSoft text-dbzs-muted"
};

function normalizedRiskClass(level: string): string {
  if (level in RISK_CLASS) return RISK_CLASS[level as RiskLevel];
  return RISK_CLASS.medium;
}

/**
 * Shared risk/severity badge. Replaces ad hoc riskClass()/approvalRiskClass()
 * implementations (some of which used raw Tailwind colors like `green-400`
 * instead of the `dbzs-*` design tokens) that were duplicated across the
 * patch panel, approval cards, and review findings.
 */
export function RiskBadge({ level, severity, label }: RiskBadgeProps) {
  const toneClass = severity ? SEVERITY_CLASS[severity] : normalizedRiskClass(level ?? "medium");
  const text = label ?? severity ?? level ?? "";
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] ${toneClass}`}
    >
      {text}
    </span>
  );
}
