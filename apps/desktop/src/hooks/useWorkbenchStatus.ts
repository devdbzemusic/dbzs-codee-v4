import type { BackendStartupStatus } from "@dbzs/shared";
import { backendUiStatus, formatBootStateForUi } from "@/services/bootUiFormatter";

export type WorkbenchStatusTone = "success" | "warning" | "danger" | "running" | "neutral";

export interface WorkbenchStatusItem {
  label: string;
  value: string;
  tone: WorkbenchStatusTone;
  tooltip?: string;
}

interface StatusInputs {
  backendStartupStatus: BackendStartupStatus | null;
  runtimeState?: string;
  runtimeProvider?: string | null;
  readyLocalModels?: number;
  totalModels?: number;
  modelIndexLoading?: boolean;
  workspaceName?: string | null;
}

/**
 * Derives typed status items for the workbench status bar
 * from raw store/service values.
 */
export function deriveWorkbenchStatus({
  backendStartupStatus,
  runtimeState,
  runtimeProvider,
  readyLocalModels = 0,
  totalModels = 0,
  modelIndexLoading = false,
  workspaceName
}: StatusInputs): { items: WorkbenchStatusItem[]; workspaceLabel: string } {
  const backendState = backendUiStatus(backendStartupStatus);

  const backendTone: WorkbenchStatusTone =
    backendState === "ready"
      ? "success"
      : backendState === "starting" || backendState === "degraded"
      ? "warning"
      : "danger";

  const runtimeTone: WorkbenchStatusTone =
    runtimeState === "running"
      ? "running"
      : readyLocalModels > 0
      ? "warning"
      : "neutral";

  const runtimeValue =
    runtimeState === "running"
      ? `${runtimeProvider ?? "runtime"} aktiv`
      : readyLocalModels > 0
      ? `${readyLocalModels}/${totalModels} bereit`
      : modelIndexLoading
      ? "indexiere…"
      : "Kein Modell aktiv";

  const items: WorkbenchStatusItem[] = [
    { label: "Desktop", value: "Desktop bereit", tone: "success" },
    {
      label: "Backend",
      value: formatBootStateForUi(backendStartupStatus),
      tone: backendTone,
      tooltip: backendStartupStatus?.message ?? undefined
    },
    {
      label: "Runtime",
      value: runtimeValue,
      tone: runtimeTone,
      tooltip: runtimeState === "running" ? `Provider: ${runtimeProvider ?? "unbekannt"}` : undefined
    }
  ];

  return {
    items,
    workspaceLabel: workspaceName ?? "Kein Workspace"
  };
}

/** @deprecated Use deriveWorkbenchStatus instead */
export function useWorkbenchStatus(inputs: StatusInputs) {
  return deriveWorkbenchStatus(inputs);
}
