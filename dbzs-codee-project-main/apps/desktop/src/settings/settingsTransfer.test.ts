import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import {
  buildResetChanges,
  buildSettingsExportPayload,
  computeSettingsDiff,
  parseSettingsImport,
  redactSecrets,
} from "./settingsTransfer";

describe("settingsTransfer", () => {
  it("redacts secrets in export payload", () => {
    const exported = buildSettingsExportPayload({
      ...DEFAULT_SETTINGS,
      openaiApiKey: "sk-secret",
      anthropicApiKey: "ant-secret",
      theme: "light",
    });
    expect(exported).not.toContain("sk-secret");
    expect(exported).not.toContain("ant-secret");
    expect(exported).toContain('"theme": "light"');
    expect(exported).toContain("dbzs-codee-settings-export");
  });

  it("parses import and builds a diff preview", () => {
    const current = { ...DEFAULT_SETTINGS, theme: "dark" as const };
    const result = parseSettingsImport(
      JSON.stringify({
        format: "dbzs-codee-settings-export",
        settings: { theme: "light", idleUnloadWorkModelsMinutes: 0 },
      }),
      current,
    );
    expect(result.ok).toBe(true);
    expect(result.diff.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["theme", "idleUnloadWorkModelsMinutes"]),
    );
  });

  it("rejects invalid import numbers", () => {
    const result = parseSettingsImport(
      JSON.stringify({ idleUnloadWorkModelsMinutes: 999 }),
      DEFAULT_SETTINGS,
    );
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.idleUnloadWorkModelsMinutes).toBeTruthy();
  });

  it("does not import blank secrets over existing values", () => {
    const current = { ...DEFAULT_SETTINGS, openaiApiKey: "keep-me" };
    const result = parseSettingsImport(
      JSON.stringify({ openaiApiKey: "", theme: "light" }),
      current,
    );
    expect(result.changes.openaiApiKey).toBeUndefined();
    expect(result.changes.theme).toBe("light");
  });

  it("builds tab and global reset diffs without secrets/hard invariants", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      theme: "light" as const,
      openaiApiKey: "sk-live",
      chatRuntimeSlot: "quality_cpu" as const,
    };
    const tab = buildResetChanges(current, "tab", "general");
    expect(tab.theme).toBe("dark");
    expect(tab.openaiApiKey).toBeUndefined();

    const global = buildResetChanges(current, "global");
    expect(global.theme).toBe("dark");
    expect(global.openaiApiKey).toBeUndefined();
    expect(global.chatRuntimeSlot).toBeUndefined();

    const diff = computeSettingsDiff(current, global);
    expect(diff.some((entry) => entry.key === "theme")).toBe(true);
  });

  it("redactSecrets clears api keys", () => {
    const redacted = redactSecrets({
      ...DEFAULT_SETTINGS,
      openaiApiKey: "x",
      anthropicApiKey: "y",
    });
    expect(redacted.openaiApiKey).toBe("");
    expect(redacted.anthropicApiKey).toBe("");
  });
});
