import { useMemo } from "react";
import type { RoutingDiagnostics } from "@/types/runtimeRoutingDiagnostics";
import { RoutingDiagnosticsCard } from "@/components/RoutingDiagnosticsCard";
import { TokenBudgetVisualizer } from "@/components/TokenBudgetVisualizer";
import { RuntimeModelTestPanel } from "@/components/RuntimeModelTestPanel";
import { RuntimeChatTraceViewer } from "@/components/RuntimeChatTraceViewer";
import { observabilityService } from "@/runtime/observability/observabilityService";

/**
 * Pure technical diagnostics: routing decisions, token budget, model
 * self-test, and (see Schritt 5) session traces. Nothing here is required to
 * complete a normal workflow — it exists for when something needs
 * debugging, per the "Expertenflächen dürfen Hauptaufgaben nicht verdecken"
 * rule in docs/architecture/ui-system.md.
 */
export function RuntimeChatDiagnosticsPanels({
  diagnostics,
  tokenBudget,
  runtimeReady
}: {
  diagnostics: RoutingDiagnostics | null;
  tokenBudget: unknown;
  runtimeReady: boolean;
}) {
  const traceCount = useMemo(() => observabilityService.getAllTraces().length, []);

  return (
    <div className="space-y-2">
      {diagnostics ? (
        <RoutingDiagnosticsCard diagnostics={diagnostics} />
      ) : (
        <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/60 p-2 text-[10px] text-dbzs-muted">
          Noch keine Routing- oder Laufdiagnose vorhanden.
        </div>
      )}
      <TokenBudgetVisualizer budget={tokenBudget as never} />
      <RuntimeModelTestPanel runtimeReady={runtimeReady} />
      <details className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 p-2">
        <summary className="cursor-pointer text-[10px] font-medium text-dbzs-text">
          Session-Traces (Observability)
          <span className="ml-2 text-dbzs-muted">{traceCount > 0 ? `${traceCount} gespeichert` : "leer"}</span>
        </summary>
        <div className="mt-2">
          <RuntimeChatTraceViewer />
        </div>
      </details>
    </div>
  );
}
