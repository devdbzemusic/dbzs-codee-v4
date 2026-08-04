export type UiStatusTone = "neutral" | "info" | "running" | "success" | "warning" | "danger";

const toneClass: Record<UiStatusTone, string> = {
  neutral: "dbzs-workbench__badge--neutral",
  info: "dbzs-workbench__badge--info",
  running: "dbzs-workbench__badge--running",
  success: "dbzs-workbench__badge--success",
  warning: "dbzs-workbench__badge--warning",
  danger: "dbzs-workbench__badge--danger"
};

export function WorkbenchStatusBadge({
  label,
  tone,
  value,
  title
}: {
  label: string;
  tone: UiStatusTone;
  value: string;
  title?: string;
}) {
  return (
    <span
      className={`dbzs-workbench__badge ${toneClass[tone]}`}
      title={title ?? `${label}: ${value}`}
    >
      <span className="sr-only">{label}: </span>
      {value}
    </span>
  );
}
