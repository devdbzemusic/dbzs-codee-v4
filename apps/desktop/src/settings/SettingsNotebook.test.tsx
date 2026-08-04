import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import { SettingsNotebook } from "./SettingsNotebook";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { useSettingsDraftStore } from "./settingsDraftStore";
import { useSettingsStore } from "@/stores/settingsStore";

describe("SettingsNotebook", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      settingsRevision: 0,
      roleModelConfiguredAt: null,
      backendHealth: null,
      backendStartupStatus: null,
      diagnostics: null,
      isLoading: false,
      error: null,
      loadInitialState: vi.fn(async () => {}),
      updateSettings: vi.fn(async () => true),
      patchSettings: vi.fn(async () => true),
      loadDiagnostics: vi.fn(async () => null),
      setBackendStartupStatus: vi.fn(),
      setError: vi.fn(),
      refreshBackendHealth: vi.fn(async () => false)
    });
    useModelIndexStore.setState({
      index: null,
      isLoading: false,
      error: null,
      primaryCodingModel: null,
      loadModelIndex: vi.fn(async () => {})
    });
    useSettingsDraftStore.setState({
      draft: {},
      fieldErrors: {},
      saving: false,
      saveError: null,
      setDraftField: vi.fn(),
      clearDraftField: vi.fn(),
      discardDraft: vi.fn(),
      applyDraft: vi.fn(async () => true),
      dirtyCount: () => 0
    });
    window.dbzs = {
      ...(window.dbzs ?? {}),
      reloadBackend: vi.fn(async () => ({ status: "ok", port: 8876 }))
    };
  });

  it("renders the offline banner and category navigation when the backend is unavailable", () => {
    render(<SettingsNotebook compact />);

    expect(screen.getByText("Backend nicht erreichbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Backend prüfen \/ neu laden/i })).toBeInTheDocument();
    expect(screen.getByText("Reale Settings-Felder")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Diagnostics/i })).toBeInTheDocument();
  });

  it("filters settings through the search field and switches categories", () => {
    render(<SettingsNotebook compact={false} />);

    fireEvent.change(screen.getByRole("searchbox", { name: /Settings suchen und filtern/i }), {
      target: { value: "theme" }
    });
    fireEvent.click(screen.getByRole("tab", { name: /Appearance/i }));

    expect(screen.getByText(/Treffer in dieser Kategorie/i)).toBeInTheDocument();
    expect(screen.getByText("Reale Settings-Felder")).toBeInTheDocument();
  });
});
