import type { SettingRuntimeStatus } from "./settingsSourceResolver";
import { formatSourceBadge } from "./settingsSourceResolver";

export function SettingStatusBadge({ status }: { status: SettingRuntimeStatus }) {
  const tone = status.saveError
    ? "text-dbzs-red"
    : status.dirty
      ? "text-dbzs-amber"
      : status.source === "environment"
        ? "text-dbzs-cyan"
        : "text-dbzs-muted";

  return <p className={`mt-1 text-[10px] leading-4 ${tone}`}>{formatSourceBadge(status)}</p>;
}
