import { describe, expect, it, beforeEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import { SettingField } from "./SettingField";
import { getSettingDefinition } from "./settingsRegistry";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSettingsDraftStore } from "./settingsDraftStore";

describe("SettingField", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      settingsRevision: 0,
      roleModelConfiguredAt: null,
      backendHealth: null,
      backendStartupStatus: null,
      diagnostics: null,
      isLoading: false,
      error: null
    });
    useSettingsDraftStore.setState({
      draft: {},
      fieldErrors: {},
      saving: false,
      saveError: null
    });
    window.dbzs = {
      getAppInfo: vi.fn(),
      getBackendHealth: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      patchSettings: vi.fn(),
      getSettingsDiagnostics: vi.fn(),
      openFileDialog: vi.fn(),
      saveFile: vi.fn(),
      getModelIndex: vi.fn(),
      getRuntimeStatus: vi.fn(),
      startRuntimeModel: vi.fn(),
      stopRuntimeModel: vi.fn(),
      sendRuntimeChat: vi.fn(),
      listAgents: vi.fn(),
      getAgent: vi.fn(),
      createAgent: vi.fn(),
      updateAgent: vi.fn(),
      startAgent: vi.fn(),
      stopAgent: vi.fn(),
      deleteAgent: vi.fn(),
      listAgentLogs: vi.fn(),
      listProjectMemory: vi.fn(),
      upsertProjectMemory: vi.fn(),
      deleteProjectMemory: vi.fn(),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      analyzeDocs: vi.fn(),
      generateDocs: vi.fn()
    } as unknown as typeof window.dbzs;
  });

  it("keeps select changes in the local draft while the backend is offline", () => {
    const definition = getSettingDefinition("theme");
    expect(definition).toBeTruthy();
    if (!definition) {
      return;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<SettingField definition={definition} />);
    });

    const select = container.querySelector("select");
    expect(select).toBeTruthy();
    if (!(select instanceof HTMLSelectElement)) {
      root.unmount();
      container.remove();
      return;
    }

    act(() => {
      select.value = "light";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(useSettingsDraftStore.getState().draft.theme).toBe("light");
    expect(window.dbzs.patchSettings).not.toHaveBeenCalled();

    root.unmount();
    container.remove();
  });

  it("renders model_lab_select options and commits immediately on change", () => {
    const definition = getSettingDefinition("defaultEmbeddingModelId");
    expect(definition).toBeTruthy();
    if (!definition) {
      return;
    }
    useSettingsStore.setState((state) => ({
      ...state,
      backendHealth: { status: "ok", app: "DBZS Code Assistant", version: "0.4.0-rc.1" }
    }));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <SettingField
          definition={definition}
          modelLabOptionsByKey={{
            defaultEmbeddingModelId: [
              { id: "bundle-1", label: "bge-small-en", disabled: false },
              { id: "bundle-2", label: "incomplete-bundle", disabled: true }
            ]
          }}
        />
      );
    });

    const select = container.querySelector("select");
    expect(select).toBeTruthy();
    if (!(select instanceof HTMLSelectElement)) {
      root.unmount();
      container.remove();
      return;
    }
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "bundle-1", "bundle-2"]);

    act(() => {
      select.value = "bundle-1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(window.dbzs.patchSettings).toHaveBeenCalledWith({
      baseRevision: 0,
      changes: { defaultEmbeddingModelId: "bundle-1" }
    });

    root.unmount();
    container.remove();
  });

  it("looks up modelLabOptionsByKey per field and does not mix embedding/reranker options", () => {
    const definition = getSettingDefinition("defaultRerankerModelId");
    expect(definition).toBeTruthy();
    if (!definition) {
      return;
    }
    useSettingsStore.setState((state) => ({
      ...state,
      backendHealth: { status: "ok", app: "DBZS Code Assistant", version: "0.4.0-rc.1" }
    }));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <SettingField
          definition={definition}
          modelLabOptionsByKey={{
            defaultEmbeddingModelId: [{ id: "embed-bundle", label: "bge-small-en", disabled: false }],
            defaultRerankerModelId: [{ id: "rerank-bundle", label: "bge-reranker", disabled: false }]
          }}
        />
      );
    });

    const select = container.querySelector("select");
    expect(select).toBeTruthy();
    if (!(select instanceof HTMLSelectElement)) {
      root.unmount();
      container.remove();
      return;
    }
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "rerank-bundle"]);

    root.unmount();
    container.remove();
  });
});
