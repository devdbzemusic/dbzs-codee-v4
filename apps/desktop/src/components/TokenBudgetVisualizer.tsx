import type { FinalRequestTokenBudget } from "@dbzs/shared";
import { BudgetItem } from "./BudgetItem";

export type TokenBudgetSnapshot = Pick<
  FinalRequestTokenBudget,
  "runtimeContextLimit" | "totalRequiredTokens" | "totalInputTokens" | "outputReserveTokens" | "toolTokens"
>;

interface TokenBudgetVisualizerProps {
  budget: TokenBudgetSnapshot | null | undefined;
}

export function TokenBudgetVisualizer({ budget }: TokenBudgetVisualizerProps) {
  if (!budget) {
    return <div className="p-2 text-[10px] text-dbzs-muted">Keine Budget-Daten verfügbar.</div>;
  }

  const { runtimeContextLimit, totalRequiredTokens, totalInputTokens, outputReserveTokens, toolTokens } = budget;
  // Verbleibender Puffer bis zum Kontextlimit — abgeleitet, kein eigenständiges Eingabefeld
  // (siehe contextSafetyMarginTokens in services/finalRequestTokenBudget.ts für dieselbe Berechnung).
  const safetyMarginTokens = Math.max(0, runtimeContextLimit - totalRequiredTokens);
  const otherInputTokens = totalInputTokens - toolTokens;
  const usagePercent = runtimeContextLimit > 0 ? (totalRequiredTokens / runtimeContextLimit) * 100 : 0;
  const isOverflow = totalRequiredTokens > runtimeContextLimit;
  const barColor = isOverflow || usagePercent > 95 ? "bg-dbzs-red" : usagePercent > 80 ? "bg-dbzs-amber" : "bg-dbzs-cyan";
  const totalRequiredTooltip = `Berechnung: Input (${totalInputTokens}) + Output-Reserve (${outputReserveTokens}) + Puffer (${safetyMarginTokens}) = ${totalRequiredTokens}`;
  const totalInputTooltip = `Berechnung: System/User/History (${otherInputTokens}) + Tool-Definitionen (${toolTokens}) = ${totalInputTokens}`;

  return (
    <div className="space-y-1.5 border-t border-dbzs-border p-2 text-xs">
      <div className="flex justify-between font-semibold">
        <span>Token-Budget</span>
        <span>{usagePercent.toFixed(1)}%</span>
      </div>
      <div
        className="h-1.5 w-full rounded-full bg-dbzs-border"
        title={`Bedarf: ${totalRequiredTokens.toLocaleString()} / Limit: ${runtimeContextLimit.toLocaleString()}`}
      >
        <div
          role="progressbar"
          aria-valuenow={Math.round(Math.min(100, usagePercent))}
          aria-valuemin={0}
          aria-valuemax={100}
          className={`h-1.5 rounded-full ${barColor}`}
          style={{ width: `${Math.min(100, usagePercent)}%` }}
        />
      </div>
      <div className="space-y-0.5 text-[10px] text-dbzs-textSoft">
        <BudgetItem
          label="Bedarf (Input + Output)"
          value={totalRequiredTokens}
          tooltip={totalRequiredTooltip}
        />
        <BudgetItem
          label="Sicherheitspuffer"
          value={safetyMarginTokens}
          tooltip="Ein Puffer, um zu verhindern, dass das Modell sein Token-Limit während der Generierung überschreitet."
        />
        <BudgetItem
          label="Limit des Modells"
          value={runtimeContextLimit}
          tooltip="Das maximale Kontextfenster, das das ausgewählte Modell verarbeiten kann."
        />
        <hr className="my-1 border-dbzs-border/50" />
        <BudgetItem
          label="Input (Prompt + Tools)"
          value={totalInputTokens}
          tooltip={totalInputTooltip}
        />
        <BudgetItem
          label="Output-Reserve"
          value={outputReserveTokens}
          tooltip="Anzahl der Tokens, die für die generierte Antwort des Modells reserviert sind."
        />
        {toolTokens > 0 && (
          <BudgetItem
            label="Tool-Definitionen"
            value={toolTokens}
            tooltip="Tokens, die allein für die JSON-Schemata der verfügbaren Tools benötigt werden."
          />
        )}
        {isOverflow ? (
          <div className="mt-1 rounded border border-dbzs-red/40 bg-dbzs-red/10 px-2 py-1 text-[10px] font-medium text-dbzs-red">
            Fehler: Kontextlimit um {totalRequiredTokens - runtimeContextLimit} Tokens überschritten.
          </div>
        ) : usagePercent > 90 && safetyMarginTokens > 0 ? (
          <div className="mt-1 rounded border border-dbzs-amber/40 bg-dbzs-amber/10 px-2 py-1 text-[10px] font-medium text-dbzs-amber">
            Warnung: Kontextlimit fast erreicht.
          </div>
        ) : safetyMarginTokens === 0 ? (
          <div className="mt-1 rounded border border-dbzs-amber/40 bg-dbzs-amber/10 px-2 py-1 text-[10px] font-medium text-dbzs-amber">
            Warnung: Kein Sicherheitspuffer. Die Antwort könnte abgeschnitten werden.
          </div>
        ) : null}
      </div>
    </div>
  );
}
