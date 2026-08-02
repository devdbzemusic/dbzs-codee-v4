import type { AppSettings } from "@dbzs/shared";
import { SettingField } from "../SettingField";
import { IdleUnloadDiagnosticsPanel } from "../IdleUnloadDiagnosticsPanel";
import { settingsByCategory, type SettingsCategory } from "../settingsRegistry";

export function RegistrySettingsTab({
  category,
  modelOptions = [],
  modelLabOptionsByKey,
}: {
  category: SettingsCategory;
  modelOptions?: Array<{ id: string; label: string; disabled?: boolean }>;
  modelLabOptionsByKey?: Partial<Record<keyof AppSettings, Array<{ id: string; label: string; disabled?: boolean }>>>;
}) {
  const entries = settingsByCategory(category);
  if (entries.length === 0) {
    return <p className="text-xs text-dbzs-muted">Keine Settings in dieser Kategorie.</p>;
  }

  return (
    <div className="space-y-4">
      {category === "runtime" ? <IdleUnloadDiagnosticsPanel /> : null}
      {entries.map((entry) => (
        <div
          className="border border-dbzs-border/40 bg-dbzs-panel/40 px-3 py-3"
          key={String(entry.key)}
        >
          <SettingField
            definition={entry}
            modelLabOptionsByKey={entry.control === "model_lab_select" ? modelLabOptionsByKey : undefined}
            modelOptions={entry.control === "model_select" ? modelOptions : undefined}
          />
        </div>
      ))}
    </div>
  );
}
