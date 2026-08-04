import { describe, expect, it } from "vitest";
import { SETTINGS_REGISTRY } from "./settingsRegistry";
import {
  SETTINGS_DISPLAY_CATEGORIES,
  getDisplayCategoryForSetting,
  getUnassignedSettingKeys,
} from "./settingsDisplay";

describe("settingsDisplay", () => {
  it("assigns every registered setting to exactly one display category", () => {
    expect(getUnassignedSettingKeys()).toEqual([]);

    const assignments = SETTINGS_REGISTRY.map((entry) => getDisplayCategoryForSetting(entry.key));
    expect(assignments).toHaveLength(SETTINGS_REGISTRY.length);
    expect(SETTINGS_DISPLAY_CATEGORIES.map((entry) => entry.id)).toContain("updates");
  });
});
