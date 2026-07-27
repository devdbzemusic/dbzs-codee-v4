interface BudgetItemProps {
  label: string;
  value: number | undefined;
  unit?: string;
  tooltip?: string;
}

export function BudgetItem({ label, value, unit = "Tokens", tooltip }: BudgetItemProps) {
  if (value === undefined) return null;
  return (
    <div className="flex justify-between">
      <span className="cursor-help" title={tooltip}>
        {label}
      </span>
      <span className="font-mono">{value.toLocaleString("en-US")} {unit}</span>
    </div>
  );
}
