import type { PointerEvent } from "react";

export function PanelHeader({
  description,
  onCollapse,
  title
}: {
  description: string;
  onCollapse: () => void;
  title: string;
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 px-4 py-4">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-normal">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-dbzs-muted">{description}</p> : null}
      </div>
      <button
        className="grid h-7 w-7 shrink-0 place-items-center border border-dbzs-border bg-dbzs-bg text-xs text-dbzs-muted hover:border-dbzs-cyan/50 hover:text-dbzs-cyan"
        onClick={onCollapse}
        title={`${title} einklappen`}
        type="button"
      >
        -
      </button>
    </div>
  );
}

export function CollapsedPanelButton({
  label,
  onClick,
  side
}: {
  label: string;
  onClick: () => void;
  side: "left" | "right";
}) {
  return (
    <button
      className="flex h-full w-full items-start justify-center border-0 bg-dbzs-panel px-0 py-4 text-xs font-medium text-dbzs-muted hover:text-dbzs-cyan"
      onClick={onClick}
      title={label}
      type="button"
    >
      <span className="[writing-mode:vertical-rl]">
        {side === "left" ? "Workspace" : "AI / Agents"} +
      </span>
    </button>
  );
}

export function ResizeHandle({
  label,
  onPointerDown,
  side
}: {
  label: string;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  side: "left" | "right" | "top";
}) {
  const positionClass = {
    left: "left-0 top-0 h-full w-2 cursor-col-resize",
    right: "right-0 top-0 h-full w-2 cursor-col-resize",
    top: "left-0 top-0 h-2 w-full cursor-row-resize"
  }[side];

  return (
    <button
      aria-label={label}
      className={`absolute z-20 border-0 bg-transparent transition-colors hover:bg-dbzs-cyan/20 ${positionClass}`}
      onPointerDown={onPointerDown}
      title={label}
      type="button"
    />
  );
}

export function PanelTitle({ description, title }: { description: string; title: string }) {
  return (
    <div className="px-4 py-4">
      <h2 className="text-sm font-semibold tracking-normal">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-dbzs-muted">{description}</p>
    </div>
  );
}

export function StatusPill({
  label,
  tone,
  value
}: {
  label: string;
  tone: "green" | "amber" | "red";
  value: string;
}) {
  const toneClass = {
    amber: "border-dbzs-amber/50 text-dbzs-amber bg-dbzs-amber/10",
    green: "border-dbzs-green/50 text-dbzs-green bg-dbzs-green/10",
    red: "border-dbzs-red/50 text-dbzs-red bg-dbzs-red/10"
  }[tone];

  return (
    <div className={`border px-3 py-1.5 ${toneClass}`}>
      <span className="text-dbzs-muted">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="text-dbzs-text">{value}</span>
    </div>
  );
}
