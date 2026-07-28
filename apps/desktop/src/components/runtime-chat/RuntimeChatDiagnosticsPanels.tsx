import type { RoutingDiagnostics } from "@/types/runtimeRoutingDiagnostics";
import { RoutingDiagnosticsCard } from "@/components/RoutingDiagnosticsCard";
import { TokenBudgetVisualizer } from "@/components/TokenBudgetVisualizer";
import { RuntimeModelTestPanel } from "@/components/RuntimeModelTestPanel";

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
    </div>
  );
}
