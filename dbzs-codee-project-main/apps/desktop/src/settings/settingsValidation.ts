import type { AppSettings } from "@dbzs/shared";
import type { SettingDefinition } from "./settingsRegistry";
import { getSettingDefinition, SETTINGS_REGISTRY } from "./settingsRegistry";

export function validateSettingValue(
  def: SettingDefinition,
  value: unknown,
): string | null {
  if (def.control === "readonly" || def.classification === "hard_invariant") {
    return null;
  }

  const { validation } = def;
  if (!validation) {
    return null;
  }

  if (typeof value === "string" && validation.maxLength !== undefined) {
    if (value.length > validation.maxLength) {
      return `Maximal ${validation.maxLength} Zeichen.`;
    }
  }

  if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)))) {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) {
      return "Ungültige Zahl.";
    }
    if (validation.min !== undefined && num < validation.min) {
      return `Minimum: ${validation.min}.`;
    }
    if (validation.max !== undefined && num > validation.max) {
      return `Maximum: ${validation.max}.`;
    }
  }

  if (validation.options && value !== undefined && value !== null && value !== "") {
    const allowed = validation.options.map((option) => option.value);
    if (!allowed.includes(String(value))) {
      return "Ungültige Auswahl.";
    }
  }

  return null;
}

export function validatePatch(changes: Partial<AppSettings>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(changes)) {
    const def = getSettingDefinition(key as keyof AppSettings);
    if (!def) {
      errors[key] = "Unbekanntes Setting.";
      continue;
    }
    const error = validateSettingValue(def, value);
    if (error) {
      errors[key] = error;
    }
  }
  return errors;
}

export function searchSettings(query: string): SettingDefinition[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return SETTINGS_REGISTRY;
  }
  return SETTINGS_REGISTRY.filter((entry) => {
    const haystack = [entry.key, entry.label, entry.description, entry.category]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
