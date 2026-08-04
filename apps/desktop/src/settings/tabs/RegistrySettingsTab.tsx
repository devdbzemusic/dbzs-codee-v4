import type { AppSettings } from "@dbzs/shared";
import { SettingField } from "../SettingField";
import { IdleUnloadDiagnosticsPanel } from "../IdleUnloadDiagnosticsPanel";
import {
  getDisplayCategoryDefinition,
  getDisplaySectionsForCategory,
  type SettingsDisplayCategory,
} from "../settingsDisplay";

export function RegistrySettingsTab({
  category,
  filteredKeys,
  modelOptions = [],
  modelLabOptionsByKey,
}: {
  category: SettingsDisplayCategory;
  filteredKeys?: ReadonlySet<string>;
  modelOptions?: Array<{ id: string; label: string; disabled?: boolean }>;
  modelLabOptionsByKey?: Partial<Record<keyof AppSettings, Array<{ id: string; label: string; disabled?: boolean }>>>;
}) {
  const categoryDef = getDisplayCategoryDefinition(category);
  const sections = getDisplaySectionsForCategory(category)
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) =>
        filteredKeys ? filteredKeys.has(String(entry.key)) : true,
      ),
    }))
    .filter((section) => section.entries.length > 0);

  if (sections.length === 0) {
    return (
      <div className="border border-dashed border-dbzs-border bg-dbzs-panel/30 px-4 py-5 text-xs text-dbzs-muted">
        {filteredKeys ? "Keine Treffer in dieser Kategorie." : categoryDef.emptyState}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {category === "runtime" ? <IdleUnloadDiagnosticsPanel /> : null}
      {sections.map((section) => (
        <section className="border border-dbzs-border/60 bg-dbzs-panel/40" key={section.id}>
          <header className="border-b border-dbzs-border/60 px-3 py-2">
            <h5 className="text-[11px] font-medium uppercase tracking-[0.14em] text-dbzs-text">
              {section.label}
            </h5>
            <p className="mt-1 text-[10px] leading-4 text-dbzs-muted">{section.description}</p>
          </header>
          <div className="space-y-3 p-3">
            {section.entries.map((entry) => (
              <div
                className="border border-dbzs-border/40 bg-dbzs-panelSoft/60 px-3 py-3"
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
        </section>
      ))}
    </div>
  );
}
