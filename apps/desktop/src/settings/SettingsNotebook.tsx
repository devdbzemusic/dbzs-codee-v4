import { useEffect, useMemo, useState } from "react";
import type { AppSettings, IndexedModel, ModelLabModel } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
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

function isEmbeddingBundle(entry: ModelLabModel): boolean {
  return entry.bundle.capabilities.includes("embedding");
}

function isRerankingBundle(entry: ModelLabModel): boolean {
  return entry.bundle.capabilities.includes("reranking");
}

function isUsableOnnxBundle(entry: ModelLabModel): boolean {
  const hasOnnxModel = entry.artifacts.some((artifact) => artifact.artifact_type === "model" && artifact.format === "onnx");
  const hasTokenizer = entry.artifacts.some((artifact) => artifact.artifact_type === "tokenizer");
  return hasOnnxModel && hasTokenizer;
}

function modelLabOptionLabel(entry: ModelLabModel): string {
  const reason = isUsableOnnxBundle(entry) ? null : "kein .onnx + Tokenizer im Bundle";
  return [entry.bundle.name, reason].filter(Boolean).join(" · ");
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
  const loadInitialState = useSettingsStore((state) => state.loadInitialState);
  const refreshBackendHealth = useSettingsStore((state) => state.refreshBackendHealth);
  const setError = useSettingsStore((state) => state.setError);
  const { index: modelIndex, isLoading: modelIndexLoading, error: modelIndexError, loadModelIndex } = useModelIndexStore();
  const backendReady = backendHealth?.status === "ok";
  const [modelLabModels, setModelLabModels] = useState<ModelLabModel[]>([]);

  useEffect(() => {
    if (backendReady && !modelIndex && !modelIndexLoading) {
      void loadModelIndex();
    }
  }, [backendReady, loadModelIndex, modelIndex, modelIndexLoading]);

  useEffect(() => {
    if (!backendReady || !backendClient.listModelLabModels) {
      return;
    }
    let cancelled = false;
    backendClient
      .listModelLabModels()
      .then((models) => {
        if (!cancelled) {
          setModelLabModels(models);
        }
      })
      .catch(() => {
        // Settings panel stays usable without Model Lab data (e.g. never scanned yet).
      });
    return () => {
      cancelled = true;
    };
  }, [backendReady]);

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

  const embeddingModelLabOptions = useMemo(() => {
    return modelLabModels
      .filter(isEmbeddingBundle)
      .sort((left, right) => {
        const leftUsable = isUsableOnnxBundle(left) ? 0 : 1;
        const rightUsable = isUsableOnnxBundle(right) ? 0 : 1;
        if (leftUsable !== rightUsable) return leftUsable - rightUsable;
        return left.bundle.name.localeCompare(right.bundle.name);
      })
      .map((entry) => ({
        id: entry.bundle.bundle_id,
        label: modelLabOptionLabel(entry),
        disabled: !isUsableOnnxBundle(entry),
      }));
  }, [modelLabModels]);

  const rerankerModelLabOptions = useMemo(() => {
    return modelLabModels
      .filter(isRerankingBundle)
      .sort((left, right) => {
        const leftUsable = isUsableOnnxBundle(left) ? 0 : 1;
        const rightUsable = isUsableOnnxBundle(right) ? 0 : 1;
        if (leftUsable !== rightUsable) return leftUsable - rightUsable;
        return left.bundle.name.localeCompare(right.bundle.name);
      })
      .map((entry) => ({
        id: entry.bundle.bundle_id,
        label: modelLabOptionLabel(entry),
        disabled: !isUsableOnnxBundle(entry),
      }));
  }, [modelLabModels]);

  const modelLabOptionsByKey = useMemo(
    () => ({
      defaultEmbeddingModelId: embeddingModelLabOptions,
      defaultRerankerModelId: rerankerModelLabOptions,
    }),
    [embeddingModelLabOptions, rerankerModelLabOptions],
  );

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

  const reloadSettingsConnection = async () => {
    setError(null);
    const healthy = await refreshBackendHealth();
    if (!healthy) {
      const reload = window.dbzs.reloadBackend;
      if (reload) {
        try {
          await reload();
        } catch {
          // Best-effort fallback — the explicit health error is shown below.
        }
      }
    }
    await loadInitialState();
  };

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
      {!backendReady ? (
        <div className="mb-3 rounded border border-dbzs-amber/40 bg-dbzs-amber/10 px-3 py-2 text-[11px] text-dbzs-amber">
          <div className="font-medium">Backend nicht erreichbar</div>
          <div className="mt-1 leading-5">
            Einstellungen können aktuell nicht direkt gespeichert werden. Text-, Auswahl- und Toggle-Änderungen
            bleiben lokal vorgemerkt, bis das Backend wieder erreichbar ist.
          </div>
          <div className="mt-2">
            <button
              className="border border-dbzs-amber/50 bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-amber hover:border-dbzs-amber"
              onClick={() => void reloadSettingsConnection()}
              type="button"
            >
              Backend prüfen / neu laden
            </button>
          </div>
        </div>
      ) : null}
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
            <RegistrySettingsTab category={activeTab} modelLabOptionsByKey={modelLabOptionsByKey} modelOptions={modelOptions} />
          </div>
        )}
      </div>
      {(settingsError || saveError) && dirtyCount === 0 ? (
        <p className="mt-2 text-[11px] text-dbzs-red">{settingsError ?? saveError}</p>
      ) : null}
      <SettingsFooter
        backendReady={backendReady}
        dirtyCount={dirtyCount}
        error={saveError}
        onDiscard={discardDraft}
        onRetry={() => void reloadSettingsConnection()}
        onSave={() => void applyDraft()}
        saving={saving}
      />
    </section>
  );
}
