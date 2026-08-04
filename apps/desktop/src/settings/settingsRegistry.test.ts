import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@dbzs/shared";
import {
  SETTINGS_REGISTRY,
  getSettingDefinition,
  userTunableSettings,
} from "./settingsRegistry";
import { validatePatch, validateSettingValue } from "./settingsValidation";

describe("settings contract registry", () => {
  it("covers every DEFAULT_SETTINGS key that is user-facing or classified", () => {
    const registryKeys = new Set(SETTINGS_REGISTRY.map((entry) => entry.key));
    expect(registryKeys.has("timeoutStreamIdleSeconds")).toBe(true);
    expect(registryKeys.has("timeoutCpuSafeStreamIdleSeconds")).toBe(true);
    expect(registryKeys.has("defaultUtilityModelId")).toBe(true);
    expect(getSettingDefinition("timeoutCpuSafeStreamIdleSeconds")?.category).toBe("runtime");
    expect(getSettingDefinition("chatRuntimeSlot")?.control).toBe("readonly");
    expect(getSettingDefinition("codingRuntimePort")?.classification).toBe(
      "read_only_diagnostic",
    );
  });

  it("renders utility and orchestrator model settings as model selectors", () => {
    expect(getSettingDefinition("defaultUtilityModelId")?.control).toBe("model_select");
    expect(getSettingDefinition("defaultOrchestratorModelId")?.control).toBe("model_select");
  });

  it("requires user_tunable entries to declare a consumer", () => {
    for (const entry of userTunableSettings()) {
      expect(entry.consumerDescription.trim().length).toBeGreaterThan(0);
      expect(entry.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("validates idle unload bounds", () => {
    const def = getSettingDefinition("idleUnloadWorkModelsMinutes");
    expect(def).toBeTruthy();
    expect(validateSettingValue(def!, 10)).toBeNull();
    expect(validateSettingValue(def!, 241)).toMatch(/Maximum/);
    expect(validateSettingValue(def!, -1)).toMatch(/Minimum/);
  });

  it("rejects invalid patch values", () => {
    const errors = validatePatch({
      idleUnloadWorkModelsMinutes: 999,
      editorFontSize: 8,
    });
    expect(errors.idleUnloadWorkModelsMinutes).toBeTruthy();
    expect(errors.editorFontSize).toBeTruthy();
  });

  it("marks orphaned settings as readonly", () => {
    expect(getSettingDefinition("autoSave")?.control).toBe("readonly");
    expect(getSettingDefinition("runtimeChatUseBroker")?.control).toBe("readonly");
    expect(getSettingDefinition("agentExecutionEnabled")?.control).toBe("readonly");
    expect(getSettingDefinition("autoStartVisionRuntime")?.control).toBe("readonly");
    expect(getSettingDefinition("autoStartVisionRuntime")?.classification).toBe("orphaned");
  });

  it("promotes defaultVisionModelId once the broker actually consumes it (Vision-Broker-Routing)", () => {
    expect(getSettingDefinition("defaultVisionModelId")?.control).toBe("model_select");
    expect(getSettingDefinition("defaultVisionModelId")?.classification).toBe("user_tunable");
  });

  it("keeps shared defaults aligned for critical fields", () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(1);
    expect(DEFAULT_SETTINGS.idleUnloadWorkModelsMinutes).toBe(10);
    expect(DEFAULT_SETTINGS.conversationControlV2).toBe(true);
    expect(DEFAULT_SETTINGS.modelsPath.replace(/\\/g, "/")).toBe("D:/Models");
  });
});
