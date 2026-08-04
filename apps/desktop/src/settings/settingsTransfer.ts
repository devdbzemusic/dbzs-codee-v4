import type { AppSettings } from "@dbzs/shared";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import {
  SETTINGS_REGISTRY,
  getSettingDefinition,
  settingsByCategory,
  type SettingsCategory,
} from "./settingsRegistry";
import { validatePatch } from "./settingsValidation";

export const SECRET_SETTING_KEYS = ["openaiApiKey", "anthropicApiKey"] as const;

const METADATA_KEYS = new Set(["schemaVersion", "revision", "updatedAt"]);

export interface SettingsDiffEntry {
  key: keyof AppSettings;
  label: string;
  from: unknown;
  to: unknown;
}

export interface SettingsImportResult {
  ok: boolean;
  errors: string[];
  fieldErrors: Record<string, string>;
  changes: Partial<AppSettings>;
  diff: SettingsDiffEntry[];
}

export function redactSecrets(settings: AppSettings): AppSettings {
  const next = { ...settings };
  for (const key of SECRET_SETTING_KEYS) {
    if (next[key]) {
      (next as Record<string, unknown>)[key] = "";
    }
  }
  return next;
}

export function buildSettingsExportPayload(settings: AppSettings): string {
  const redacted = redactSecrets(settings);
  const payload = {
    format: "dbzs-codee-settings-export",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: redacted,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function computeSettingsDiff(
  current: AppSettings,
  proposed: Partial<AppSettings>,
): SettingsDiffEntry[] {
  const diff: SettingsDiffEntry[] = [];
  for (const [rawKey, to] of Object.entries(proposed)) {
    const key = rawKey as keyof AppSettings;
    if (METADATA_KEYS.has(rawKey)) continue;
    const from = current[key];
    if (Object.is(from, to)) continue;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    const def = getSettingDefinition(key);
    diff.push({
      key,
      label: def?.label ?? String(key),
      from,
      to,
    });
  }
  return diff;
}

export function buildResetChanges(
  current: AppSettings,
  scope: "field" | "tab" | "global",
  target?: keyof AppSettings | SettingsCategory,
): Partial<AppSettings> {
  if (scope === "field") {
    if (!target || typeof target !== "string") return {};
    const def = getSettingDefinition(target as keyof AppSettings);
    if (!def || def.control === "readonly" || def.classification === "hard_invariant") {
      return {};
    }
    const key = def.key;
    return { [key]: def.defaultValue };
  }

  if (scope === "tab") {
    const category = target as SettingsCategory;
    const changes: Partial<AppSettings> = {};
    for (const entry of settingsByCategory(category)) {
      if (entry.control === "readonly" || entry.classification === "hard_invariant") {
        continue;
      }
      if (entry.sensitive) {
        continue;
      }
      (changes as Record<string, unknown>)[entry.key] = entry.defaultValue;
    }
    return changes;
  }

  const changes: Partial<AppSettings> = {};
  for (const entry of SETTINGS_REGISTRY) {
    if (entry.control === "readonly" || entry.classification === "hard_invariant") {
      continue;
    }
    if (entry.sensitive) {
      continue;
    }
    const key = entry.key;
    if (JSON.stringify(current[key]) === JSON.stringify(entry.defaultValue)) {
      continue;
    }
    (changes as Record<string, unknown>)[key] = entry.defaultValue;
  }
  return changes;
}

export function parseSettingsImport(
  rawText: string,
  current: AppSettings,
): SettingsImportResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      errors: ["JSON konnte nicht gelesen werden."],
      fieldErrors: {},
      changes: {},
      diff: [],
    };
  }

  let candidate: Record<string, unknown>;
  if (isPlainObject(parsed) && isPlainObject(parsed.settings)) {
    candidate = parsed.settings;
  } else if (isPlainObject(parsed)) {
    candidate = parsed;
  } else {
    return {
      ok: false,
      errors: ["Ungültiges Export-Format."],
      fieldErrors: {},
      changes: {},
      diff: [],
    };
  }

  const known = new Set(SETTINGS_REGISTRY.map((entry) => String(entry.key)));
  const changes: Partial<AppSettings> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (METADATA_KEYS.has(key)) continue;
    if (!known.has(key)) {
      errors.push(`Unbekanntes Feld ignoriert: ${key}`);
      continue;
    }
    const def = getSettingDefinition(key as keyof AppSettings);
    if (!def) continue;
    if (def.classification === "hard_invariant" || def.control === "readonly") {
      continue;
    }
    if (SECRET_SETTING_KEYS.includes(key as (typeof SECRET_SETTING_KEYS)[number])) {
      // Never import blank secrets over existing values unless explicitly non-empty.
      if (typeof value === "string" && value.length === 0) {
        continue;
      }
    }
    (changes as Record<string, unknown>)[key] = value;
  }

  const fieldErrors = validatePatch(changes);
  const diff = computeSettingsDiff(current, changes);
  const ok = Object.keys(fieldErrors).length === 0 && diff.length > 0;

  if (diff.length === 0 && errors.length === 0) {
    errors.push("Keine wirksamen Änderungen im Import gefunden.");
  }

  return {
    ok: ok && Object.keys(fieldErrors).length === 0,
    errors,
    fieldErrors,
    changes,
    diff,
  };
}

export function formatDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") {
    if (value.length === 0) return '""';
    if (value.length > 80) return `${value.slice(0, 77)}…`;
    return value;
  }
  return JSON.stringify(value);
}

export function defaultSettingsSnapshot(): AppSettings {
  return { ...DEFAULT_SETTINGS };
}
