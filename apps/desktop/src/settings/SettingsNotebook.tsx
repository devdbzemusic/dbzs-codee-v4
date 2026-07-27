import { useEffect, useMemo, useState } from "react";
import type { AppSettings, IndexedModel } from "@dbzs/shared";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSettingsDraftStore } from "./settingsDraftStore";
import { SettingsFooter } from "./SettingsFooter";
import { SettingsPageHeader } from "./SettingsPageHeader";
import { SettingsSearch } from "./SettingsSearch";
import { SettingsTabBar } from "./SettingsTabBar";
import { SettingsTransferBar } from "./SettingsTransferBar";
import {
  SETTINGS_TABS,
  type SettingsCategory,
  getSettingDefinition,
} from "./settingsRegistry";
import { searchSettings } from "./settingsValidation";
import { RegistrySettingsTab } from "./tabs/RegistrySettingsTab";
import { DiagnosticsStorageTab } from "./tabs/DiagnosticsStorageTab";

function modelDisplayName(model: IndexedModel): string {
  return model.name || model.id;
}

function isSelectableModel(model: IndexedModel): boolean {
  return model.compatibility === "llama_server_ready" || model.compatibility === "ollama_ready";
}

function modelOptionLabel(model: IndexedModel): string {
  const size = model.size_gb != null ? `${model.size_gb.toFixed(1)} GB` : null;
  return [modelDisplayName(model), size, model.compatibility].filter(Boolean).join(" · ");
}

export function SettingsNotebook({ compact = true }: { compact?: boolean }) {
  const [activeTab, setActiveTab] = useState<SettingsCategory>("general");
  const [query, setQuery] = useState("");
  const draft = useSettingsDraftStore((state) => state.draft);
  const saving = useSettingsDraftStore((state) => state.saving);
  const saveError = useSettingsDraftStore((state) => state.saveError);
  const discardDraft = useSettingsDraftStore((state) => state.discardDraft);
  const applyDraft = useSettingsDraftStore((state) => state.applyDraft);
  const settingsError = useSettingsStore((state) => state.error);
  const backendHealth = useSettingsStore((state) => state.backendHealth);
  const { index: modelIndex, isLoading: modelIndexLoading, error: modelIndexError, loadModelIndex } = useModelIndexStore();
  const backendReady = backendHealth?.status === "ok";

  useEffect(() => {
    if (backendReady && !modelIndex && !modelIndexLoading) {
      void loadModelIndex();
    }
  }, [backendReady, loadModelIndex, modelIndex, modelIndexLoading]);

  const modelOptions = useMemo(() => {
    return (modelIndex?.models ?? [])
      .filter((model) => model.recommended_use !== "unsupported")
      .sort((left, right) => {
        const leftReady = isSelectableModel(left) ? 0 : 1;
        const rightReady = isSelectableModel(right) ? 0 : 1;
        if (leftReady !== rightReady) return leftReady - rightReady;
        return modelDisplayName(left).localeCompare(modelDisplayName(right));
      })
      .map((model) => ({
        id: model.id,
        label: modelOptionLabel(model),
        disabled: !isSelectableModel(model),
      }));
  }, [modelIndex]);

  const hits = useMemo(
    () =>
      searchSettings(query).map((entry) => ({
        key: String(entry.key),
        label: entry.label,
        category: entry.category,
      })),
    [query],
  );

  const dirtyCount = Object.keys(draft).length;

  const navigateToSetting = (key: string) => {
    const def = getSettingDefinition(key as keyof AppSettings);
    if (def) {
      setActiveTab(def.category);
      setQuery("");
      window.requestAnimationFrame(() => {
        document.getElementById(`setting-${key}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col border border-dbzs-border bg-dbzs-panelSoft p-4">
      <SettingsPageHeader compact={compact} />
      <SettingsSearch
        hits={hits}
        onChange={setQuery}
        onNavigate={navigateToSetting}
        value={query}
      />
      <SettingsTransferBar activeTab={activeTab} />
      <SettingsTabBar active={activeTab} onChange={setActiveTab} />
      <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
        {activeTab === "diagnostics" ? (
          <DiagnosticsStorageTab />
        ) : (
          <div className="space-y-3 border border-dbzs-border bg-dbzs-bg p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-dbzs-muted">
                {SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label ?? activeTab}
              </h4>
              {activeTab === "models" ? (
                <button
                  className="border border-dbzs-border px-2 py-1 text-[10px] text-dbzs-muted hover:border-dbzs-cyan/40 disabled:opacity-50"
                  disabled={modelIndexLoading}
                  onClick={() => void loadModelIndex()}
                  type="button"
                >
                  {modelIndexLoading ? "Lade…" : "Modellindex aktualisieren"}
                </button>
              ) : null}
            </div>
            {activeTab === "models" && modelIndexError ? (
              <p className="text-[11px] text-dbzs-red">Modellindex: {modelIndexError}</p>
            ) : null}
            <RegistrySettingsTab category={activeTab} modelOptions={modelOptions} />
          </div>
        )}
      </div>
      {(settingsError || saveError) && dirtyCount === 0 ? (
        <p className="mt-2 text-[11px] text-dbzs-red">{settingsError ?? saveError}</p>
      ) : null}
      <SettingsFooter
        dirtyCount={dirtyCount}
        error={saveError}
        onDiscard={discardDraft}
        onSave={() => void applyDraft()}
        saving={saving}
      />
    </section>
  );
}
