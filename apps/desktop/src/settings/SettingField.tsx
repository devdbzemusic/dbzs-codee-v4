import type { ReactNode } from "react";
import type { AppSettings } from "@dbzs/shared";
import type { SettingDefinition } from "./settingsRegistry";
import { isEditableClassification } from "./settingsRegistry";
import { SettingStatusBadge } from "./SettingStatusBadge";
import { buildRuntimeStatus } from "./settingsSourceResolver";
import { useSettingsDraftStore } from "./settingsDraftStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { buildResetChanges, computeSettingsDiff } from "./settingsTransfer";

type ModelLabOptionList = Array<{ id: string; label: string; disabled?: boolean }>;

interface SettingFieldProps {
  definition: SettingDefinition;
  modelOptions?: Array<{ id: string; label: string; disabled?: boolean }>;
  modelLabOptionsByKey?: Partial<Record<keyof AppSettings, ModelLabOptionList>>;
}

export function SettingField({ definition, modelOptions = [], modelLabOptionsByKey }: SettingFieldProps) {
  const modelLabOptions = modelLabOptionsByKey?.[definition.key] ?? [];
  const settings = useSettingsStore((state) => state.settings);
  const backendHealth = useSettingsStore((state) => state.backendHealth);
  const diagnostics = useSettingsStore((state) => state.diagnostics);
  const draft = useSettingsDraftStore((state) => state.draft);
  const fieldErrors = useSettingsDraftStore((state) => state.fieldErrors);
  const setDraftField = useSettingsDraftStore((state) => state.setDraftField);
  const patchSettings = useSettingsStore((state) => state.patchSettings);

  const key = definition.key;
  const draftValue = draft[key];
  const value = (draftValue !== undefined ? draftValue : settings[key]) as AppSettings[typeof key];
  const dirty = draftValue !== undefined;
  const error = fieldErrors[String(key)];
  const editable = isEditableClassification(definition.classification) && definition.control !== "readonly";
  const backendReady = backendHealth?.status === "ok";
  const envHints: Record<string, string | undefined> = {};
  for (const envName of definition.environmentOverrides ?? []) {
    // Presence-only: diagnostics reports source without exposing secret values.
    if (diagnostics?.effectiveSources?.[String(key)] === "environment") {
      envHints[envName] = "set";
    }
    if (key === "modelsPath" && diagnostics?.effectiveSources?.modelsPath === "environment") {
      envHints[envName] = "set";
    }
  }
  const status = buildRuntimeStatus(key, settings, {
    dirty,
    saveError: error,
    env: envHints,
  });
  const differsFromDefault =
    JSON.stringify(settings[key]) !== JSON.stringify(definition.defaultValue);

  const resetField = () => {
    if (!editable) return;
    const changes = buildResetChanges(settings, "field", key);
    const diff = computeSettingsDiff(settings, changes);
    if (diff.length === 0) return;
    if (
      !window.confirm(
        `${definition.label} auf Default zurücksetzen?\n\nAktuell: ${JSON.stringify(settings[key])}\nDefault: ${JSON.stringify(definition.defaultValue)}`,
      )
    ) {
      return;
    }
    void patchSettings(changes);
  };

  const commitImmediate = (next: AppSettings[typeof key]) => {
    if (
      backendReady &&
      (definition.control === "toggle" ||
        definition.control === "select" ||
        definition.control === "model_select" ||
        definition.control === "model_lab_select")
    ) {
      void patchSettings({ [key]: next } as Partial<AppSettings>);
      return;
    }
    setDraftField(key, next);
  };

  const inputClass =
    "mt-2 w-full border border-dbzs-border bg-dbzs-panel px-3 py-2 text-dbzs-text disabled:opacity-60";

  let control: ReactNode = null;

  switch (definition.control) {
    case "toggle":
      control = (
        <input
          checked={Boolean(value)}
          className="h-4 w-4 accent-dbzs-cyan"
          disabled={!editable}
          onChange={(event) =>
            commitImmediate(event.currentTarget.checked as AppSettings[typeof key])
          }
          type="checkbox"
        />
      );
      break;
    case "range":
      control = (
        <input
          className="mt-2 w-full accent-dbzs-cyan"
          disabled={!editable}
          max={definition.validation?.max}
          min={definition.validation?.min}
          onChange={(event) =>
            setDraftField(key, Number(event.currentTarget.value) as AppSettings[typeof key])
          }
          step={definition.validation?.step ?? 1}
          type="range"
          value={Number(value ?? definition.defaultValue)}
        />
      );
      break;
    case "number":
      control = (
        <input
          className={inputClass}
          disabled={!editable}
          inputMode="numeric"
          max={definition.validation?.max}
          min={definition.validation?.min}
          onChange={(event) => {
            const parsed = Number.parseInt(event.currentTarget.value, 10);
            if (!Number.isFinite(parsed)) {
              return;
            }
            setDraftField(key, parsed as AppSettings[typeof key]);
          }}
          type="number"
          value={Number(value ?? definition.defaultValue)}
        />
      );
      break;
    case "percent": {
      const ratio = Number(value ?? definition.defaultValue ?? 0);
      control = (
        <input
          className={inputClass}
          disabled={!editable}
          max={(definition.validation?.max ?? 1) * 100}
          min={(definition.validation?.min ?? 0) * 100}
          onChange={(event) => {
            const parsed = Number.parseFloat(event.currentTarget.value);
            if (!Number.isFinite(parsed)) {
              return;
            }
            setDraftField(key, (parsed / 100) as AppSettings[typeof key]);
          }}
          step={1}
          type="number"
          value={Math.round(ratio * 1000) / 10}
        />
      );
      break;
    }
    case "select":
      control = (
        <select
          className={inputClass}
          disabled={!editable}
          onChange={(event) =>
            commitImmediate(event.currentTarget.value as AppSettings[typeof key])
          }
          value={String(value ?? definition.defaultValue ?? "")}
        >
          {(definition.validation?.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
      break;
    case "model_select":
      control = (
        <select
          className={inputClass}
          disabled={!editable}
          onChange={(event) =>
            commitImmediate(event.currentTarget.value as AppSettings[typeof key])
          }
          value={String(value ?? "")}
        >
          <option value="">Automatisch / erben</option>
          {modelOptions.map((option) => (
            <option disabled={option.disabled} key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      );
      break;
    case "model_lab_select":
      control = (
        <select
          className={inputClass}
          disabled={!editable}
          onChange={(event) =>
            commitImmediate(event.currentTarget.value as AppSettings[typeof key])
          }
          value={String(value ?? "")}
        >
          <option value="">Keines ausgewaehlt</option>
          {modelLabOptions.map((option) => (
            <option disabled={option.disabled} key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      );
      break;
    case "password":
      control = (
        <input
          autoComplete="off"
          className={inputClass}
          disabled={!editable}
          onChange={(event) =>
            setDraftField(key, event.currentTarget.value as AppSettings[typeof key])
          }
          type="password"
          value={String(value ?? "")}
        />
      );
      break;
    case "path":
    case "text":
      control = (
        <input
          className={inputClass}
          disabled={!editable}
          maxLength={definition.validation?.maxLength}
          onChange={(event) =>
            setDraftField(key, event.currentTarget.value as AppSettings[typeof key])
          }
          type="text"
          value={String(value ?? "")}
        />
      );
      break;
    case "readonly":
    default:
      control = (
        <div className="mt-2 border border-dbzs-border/60 bg-dbzs-panelSoft px-3 py-2 text-dbzs-text">
          {String(value ?? definition.defaultValue ?? "—")}
        </div>
      );
      break;
  }

  const layoutToggle = definition.control === "toggle";

  return (
    <label
      className={
        layoutToggle
          ? "flex items-center justify-between gap-3 text-xs text-dbzs-muted"
          : "block text-xs text-dbzs-muted"
      }
      data-setting-key={String(key)}
      id={`setting-${String(key)}`}
    >
      <span className={layoutToggle ? "max-w-[70%]" : "block"}>
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-dbzs-text">{definition.label}</span>
          {definition.experimental ? (
            <span className="text-[10px] uppercase tracking-wide text-dbzs-amber">Experimental</span>
          ) : null}
          {definition.classification === "orphaned" ? (
            <span className="text-[10px] uppercase tracking-wide text-dbzs-muted">Orphaned</span>
          ) : null}
          {definition.classification === "deprecated" ? (
            <span className="text-[10px] uppercase tracking-wide text-dbzs-amber">Deprecated</span>
          ) : null}
          {editable && differsFromDefault ? (
            <button
              className="border border-dbzs-border px-1.5 py-0.5 text-[10px] text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-cyan"
              onClick={(event) => {
                event.preventDefault();
                resetField();
              }}
              type="button"
            >
              Feld-Reset
            </button>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[10px] leading-4 text-dbzs-muted">{definition.description}</span>
      </span>
      {control}
      <SettingStatusBadge status={status} />
      {error ? <span className="mt-1 block text-[10px] text-dbzs-red">{error}</span> : null}
    </label>
  );
}
