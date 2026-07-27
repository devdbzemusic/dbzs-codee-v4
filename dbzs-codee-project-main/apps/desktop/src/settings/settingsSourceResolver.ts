import type { AppSettings } from "@dbzs/shared";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import { getSettingDefinition } from "./settingsRegistry";

export type SettingSource =
  | "default"
  | "settings_file"
  | "environment"
  | "runtime_override"
  | "workspace_override";

export interface SettingRuntimeStatus {
  key: keyof AppSettings;
  configuredValue: unknown;
  effectiveValue: unknown;
  source: SettingSource;
  persisted: boolean;
  dirty: boolean;
  saving: boolean;
  saveError?: string;
  applied: "immediate" | "next_run" | "restart_required";
}

const SECRET_ENV_BY_KEY: Partial<Record<keyof AppSettings, string>> = {
  openaiApiKey: "OPENAI_API_KEY",
  anthropicApiKey: "ANTHROPIC_API_KEY",
};

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Matches backend cloud_client precedence: non-empty settings value wins;
 * otherwise a configured env var is the effective source.
 */
export function resolveSettingSource(
  key: keyof AppSettings,
  settings: AppSettings,
  env: Record<string, string | undefined> = {},
): SettingSource {
  if (key === "modelsPath" && env.DBZS_MODELS_DIR) {
    return "environment";
  }

  const secretEnvName = SECRET_ENV_BY_KEY[key];
  if (secretEnvName) {
    const fromSettings = hasNonEmptyString(settings[key]);
    if (fromSettings) {
      return "settings_file";
    }
    if (hasNonEmptyString(env[secretEnvName])) {
      return "environment";
    }
    return "default";
  }

  const configured = settings[key];
  const fallback = DEFAULT_SETTINGS[key];
  if (configured === undefined || configured === null || configured === fallback) {
    return configured === fallback ? "default" : "settings_file";
  }
  return "settings_file";
}

export function buildRuntimeStatus(
  key: keyof AppSettings,
  settings: AppSettings,
  options?: {
    dirty?: boolean;
    saving?: boolean;
    saveError?: string;
    effectiveValue?: unknown;
    env?: Record<string, string | undefined>;
  },
): SettingRuntimeStatus {
  const def = getSettingDefinition(key);
  const source = resolveSettingSource(key, settings, options?.env);
  const restart = def?.restartRequirement ?? "next_run";
  const applied =
    restart === "none"
      ? "immediate"
      : restart === "next_run"
        ? "next_run"
        : "restart_required";

  return {
    key,
    configuredValue: settings[key],
    effectiveValue: options?.effectiveValue ?? settings[key],
    source,
    persisted: source === "settings_file" || source === "environment",
    dirty: options?.dirty ?? false,
    saving: options?.saving ?? false,
    saveError: options?.saveError,
    applied,
  };
}

export function formatSourceBadge(status: SettingRuntimeStatus): string {
  const sourceLabel: Record<SettingSource, string> = {
    default: "Default",
    settings_file: "settings.json",
    environment: "Umgebung",
    runtime_override: "Runtime",
    workspace_override: "Workspace",
  };
  const appliedLabel =
    status.applied === "immediate"
      ? "sofort wirksam"
      : status.applied === "next_run"
        ? "ab nächstem Run"
        : "Neustart nötig";

  if (status.dirty) {
    return `Ungespeichert · Quelle: ${sourceLabel[status.source]}`;
  }
  if (status.saving) {
    return `Speichern… · Quelle: ${sourceLabel[status.source]}`;
  }
  if (status.saveError) {
    return `Fehler: ${status.saveError}`;
  }
  if (status.source === "environment") {
    return `Durch Umgebung überschrieben · ${appliedLabel}`;
  }
  return `Gespeichert · Quelle: ${sourceLabel[status.source]} · ${appliedLabel}`;
}
