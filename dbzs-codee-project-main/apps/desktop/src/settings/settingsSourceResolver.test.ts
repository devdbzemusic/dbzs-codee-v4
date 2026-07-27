import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import { resolveSettingSource } from "./settingsSourceResolver";

describe("resolveSettingSource", () => {
  it("prefers env for API keys when settings fields are empty", () => {
    expect(
      resolveSettingSource("openaiApiKey", DEFAULT_SETTINGS, {
        OPENAI_API_KEY: "sk-from-env",
      }),
    ).toBe("environment");
    expect(
      resolveSettingSource("anthropicApiKey", DEFAULT_SETTINGS, {
        ANTHROPIC_API_KEY: "ant-from-env",
      }),
    ).toBe("environment");
  });

  it("prefers settings file when API key fields are non-empty", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      openaiApiKey: "sk-from-file",
    };
    expect(
      resolveSettingSource("openaiApiKey", settings, {
        OPENAI_API_KEY: "sk-from-env",
      }),
    ).toBe("settings_file");
  });

  it("reports default when neither settings nor env provide a key", () => {
    expect(resolveSettingSource("openaiApiKey", DEFAULT_SETTINGS, {})).toBe("default");
  });
});
