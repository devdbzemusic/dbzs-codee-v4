import type { AppSettings, SettingsPatchResponse } from "@dbzs/shared";

type RendererSafeSettings = AppSettings & {
  openaiConfigured?: boolean;
  anthropicConfigured?: boolean;
};

const SECRET_KEYS = new Set<keyof AppSettings>([
  "openaiApiKey",
  "anthropicApiKey",
]);

const RENDERER_ONLY_KEYS = new Set(["openaiConfigured", "anthropicConfigured"]);

function preserveSecret(nextValue: unknown, currentValue: string): string {
  if (typeof nextValue !== "string") {
    return currentValue;
  }
  return nextValue.trim().length > 0 ? nextValue : currentValue;
}

export function sanitizeSettingsForRenderer(settings: RendererSafeSettings): RendererSafeSettings {
  return {
    ...settings,
    openaiApiKey: "",
    anthropicApiKey: "",
  };
}

export function stripRendererOnlySettings(
  changes: Partial<AppSettings> | (Partial<AppSettings> & Record<string, unknown>)
): Partial<AppSettings> {
  const sanitized = { ...changes } as Partial<AppSettings> & Record<string, unknown>;
  for (const key of RENDERER_ONLY_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

export function mergeFullSettingsUpdateForBackend(
  next: RendererSafeSettings,
  current: AppSettings
): AppSettings {
  const merged: AppSettings = {
    ...current,
    ...stripRendererOnlySettings(next),
  };

  for (const key of SECRET_KEYS) {
    merged[key] = preserveSecret(next[key], current[key]) as never;
  }

  return merged;
}

export function sanitizeSettingsPatchResponse(
  response: SettingsPatchResponse
): SettingsPatchResponse {
  return {
    ...response,
    settings: sanitizeSettingsForRenderer(response.settings),
  };
}
