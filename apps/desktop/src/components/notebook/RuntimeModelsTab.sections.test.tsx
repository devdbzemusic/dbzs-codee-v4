import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeStatus } from "@dbzs/shared";
import type { DiagnosticsIssue } from "./RuntimeModelsTab.helpers";
import { DiagnosticsSection, RuntimeModelsEmptyState, RuntimeModelsHeader } from "./RuntimeModelsTab.sections";

describe("RuntimeModelsHeader", () => {
  it("renders backend, runtime and summary information", () => {
    const status: RuntimeStatus = {
      state: "running",
      model_id: "m1",
      model_name: "coder.gguf",
      provider: "llama.cpp",
      port: 8080,
      pid: 1234,
      endpoint: "http://127.0.0.1:8080",
      message: "Runtime aktiv"
    };

    render(
      <RuntimeModelsHeader
        backendOnline
        index={{
          summary: {
            total: 4,
            gguf_total: 3,
            llama_server_ready: 2,
            ollama_ready: 1
          }
        }}
        indexError={null}
        indexLoading={false}
        loadModelIndex={vi.fn(async () => {})}
        multimodalPairCount={2}
        runtimeBusy={false}
        runtimeError={null}
        status={status}
        stopModel={vi.fn(async () => {})}
        visibleSupportArtifactCount={1}
      />
    );

    expect(screen.getByText("Lokale Modelle")).toBeInTheDocument();
    expect(screen.getByText(/Backend: aktiv/)).toBeInTheDocument();
    expect(screen.getByText(/laeuft: coder.gguf/)).toBeInTheDocument();
    expect(screen.getByText("Gesamt 4")).toBeInTheDocument();
    expect(screen.getByText("MM-Paare 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Runtime stoppen" })).toBeInTheDocument();
  });

  it("wires refresh and stop actions", () => {
    const loadModelIndex = vi.fn(async () => {});
    const stopModel = vi.fn(async () => {});

    render(
      <RuntimeModelsHeader
        backendOnline={false}
        index={null}
        indexError="Indexfehler"
        indexLoading={false}
        loadModelIndex={loadModelIndex}
        multimodalPairCount={0}
        runtimeBusy={false}
        runtimeError="Runtimefehler"
        status={{
          state: "running",
          endpoint: "http://127.0.0.1:8080",
          model_name: "vision.gguf",
          provider: "llama.cpp",
          port: 8080,
          pid: 1234,
          message: "running"
        } as RuntimeStatus}
        stopModel={stopModel}
        visibleSupportArtifactCount={0}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Index aktualisieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Runtime stoppen" }));

    expect(loadModelIndex).toHaveBeenCalled();
    expect(stopModel).toHaveBeenCalled();
    expect(screen.getByText("Modellindex: Indexfehler")).toBeInTheDocument();
    expect(screen.getByText("Runtimefehler")).toBeInTheDocument();
  });
});

describe("DiagnosticsSection", () => {
  it("renders nothing when there are no issues", () => {
    const { container } = render(<DiagnosticsSection issues={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders blocker and hint counts plus each issue's area and detail", () => {
    const issues: DiagnosticsIssue[] = [
      { id: "model:m1", severity: "error", area: "Modell", title: "broken.gguf", detail: "Datei fehlt" },
      { id: "artifact:a1", severity: "warn", area: "Hilfsartefakt", title: "mmproj-orphan.gguf", detail: "Kein Basismodell" }
    ];

    render(<DiagnosticsSection issues={issues} />);

    expect(screen.getByText("Diagnose")).toBeInTheDocument();
    expect(screen.getByText("Blockiert 1")).toBeInTheDocument();
    expect(screen.getByText("Hinweise 1")).toBeInTheDocument();
    expect(screen.getByText("broken.gguf")).toBeInTheDocument();
    expect(screen.getByText("Datei fehlt")).toBeInTheDocument();
    expect(screen.getByText("mmproj-orphan.gguf")).toBeInTheDocument();
    expect(screen.getByText("Kein Basismodell")).toBeInTheDocument();
  });
});

describe("RuntimeModelsEmptyState", () => {
  it("shows loading state before index is available", () => {
    render(<RuntimeModelsEmptyState hasAnyEntries={false} indexError={null} indexLoading />);

    expect(screen.getByText("Indexiere lokale Modelle ...")).toBeInTheDocument();
  });

  it("shows empty-state error hint after failed load", () => {
    render(
      <RuntimeModelsEmptyState
        hasAnyEntries={true}
        indexError="Backend nicht erreichbar"
        indexLoading={false}
      />
    );

    expect(screen.getByText("Modellindex konnte nicht geladen werden - siehe Fehlermeldung oben.")).toBeInTheDocument();
  });
});
