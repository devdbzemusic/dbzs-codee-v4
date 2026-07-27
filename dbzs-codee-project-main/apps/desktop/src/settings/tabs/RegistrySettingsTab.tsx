import { SettingField } from "../SettingField";
import { IdleUnloadDiagnosticsPanel } from "../IdleUnloadDiagnosticsPanel";
import { settingsByCategory, type SettingsCategory } from "../settingsRegistry";

export function RegistrySettingsTab({
  category,
  modelOptions = [],
}: {
  category: SettingsCategory;
  modelOptions?: Array<{ id: string; label: string; disabled?: boolean }>;
}) {
  const entries = settingsByCategory(category);
  if (entries.length === 0) {
    return <p className="text-xs text-dbzs-muted">Keine Settings in dieser Kategorie.</p>;
  }

  return (
    <div className="space-y-3">
      {category === "runtime" ? <IdleUnloadDiagnosticsPanel /> : null}
      {entries.map((entry) => (
        <SettingField
          definition={entry}
          key={String(entry.key)}
          modelOptions={entry.control === "model_select" ? modelOptions : undefined}
        />
      ))}
    </div>
  );
}
