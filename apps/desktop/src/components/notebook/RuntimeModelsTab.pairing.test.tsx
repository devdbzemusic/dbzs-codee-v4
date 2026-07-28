import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IndexedModel } from "@dbzs/shared";
import {
  PairingFeedbackDetails,
  PairingProbeButton,
  PairingSelectionControls,
  type PairingUiController
} from "./RuntimeModelsTab.pairing";

const pairingCandidates: IndexedModel[] = [
  {
    id: "m1",
    name: "base-one.gguf",
    path: "/models/base-one.gguf",
    format: "gguf",
    artifact_type: "model",
    size_bytes: 1024,
    size_gb: 0.001,
    quantization: "Q4_K_M",
    backend: "llama_server",
    runtime_launcher: "llama_server",
    capabilities: ["chat"],
    modality: ["text"],
    role: null,
    recommended_use: "coding_candidate",
    compatibility: "llama_server_ready",
    runtime: {
      ctx: 4096,
      gpu_layers: 0,
      server_enabled: true,
      preferred_port: 8080,
      health_status: "unknown",
      provider: "llama_server"
    }
  },
  {
    id: "m2",
    name: "base-two.gguf",
    path: "/models/base-two.gguf",
    format: "gguf",
    artifact_type: "model",
    size_bytes: 2048,
    size_gb: 0.002,
    quantization: "Q4_K_M",
    backend: "llama_server",
    runtime_launcher: "llama_server",
    capabilities: ["chat", "code"],
    modality: ["text"],
    role: null,
    recommended_use: "primary_coding",
    compatibility: "llama_server_ready",
    runtime: {
      ctx: 8192,
      gpu_layers: 0,
      server_enabled: true,
      preferred_port: 8081,
      health_status: "unknown",
      provider: "llama_server"
    }
  }
];

function createPairingUi(overrides: Partial<PairingUiController> = {}): PairingUiController {
  return {
    pairingSelections: {},
    onSelectionChange: vi.fn(),
    pairingSaving: {},
    pairingProbing: {},
    pairingFeedback: {},
    pairingOutcome: {},
    pairingEvidence: {},
    saveManualPairing: vi.fn(async () => {}),
    probePairing: vi.fn(async () => {}),
    ...overrides
  };
}

describe("PairingFeedbackDetails", () => {
  it("renders nothing without feedback state", () => {
    const { container } = render(
      <PairingFeedbackDetails align="left" feedbackKey="artifact-1" pairingUi={createPairingUi()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders probe feedback and evidence lines", () => {
    render(
      <PairingFeedbackDetails
        align="right"
        feedbackKey="artifact-1"
        pairingUi={createPairingUi({
          pairingFeedback: { "artifact-1": "Probe abgeschlossen" },
          pairingOutcome: { "artifact-1": { label: "Probe verifiziert", tone: "ok" } },
          pairingEvidence: { "artifact-1": [{ tone: "info", text: "Gemeldete Modelle: base-one.gguf" }] }
        })}
      />
    );

    expect(screen.getByText("Probe abgeschlossen")).toBeInTheDocument();
    expect(screen.getByText("Probe verifiziert")).toBeInTheDocument();
    expect(screen.getByText("Gemeldete Modelle: base-one.gguf")).toBeInTheDocument();
  });
});

describe("PairingSelectionControls", () => {
  it("propagates selection, save and probe actions", () => {
    const pairingUi = createPairingUi();

    render(
      <PairingSelectionControls
        canProbePair
        feedbackKey="artifact-1"
        pairingCandidates={pairingCandidates}
        pairingUi={pairingUi}
        probeBaseModelId="m1"
        saveSource="catalog"
        selectedBaseModelId="m1"
        targetBadge={{ label: "Ziel base-one.gguf", tone: "ok" }}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "m2" } });
    fireEvent.click(screen.getByRole("button", { name: "Zuordnen" }));
    fireEvent.click(screen.getByRole("button", { name: "Probe" }));

    expect(pairingUi.onSelectionChange).toHaveBeenCalledWith("artifact-1", "m2");
    expect(pairingUi.saveManualPairing).toHaveBeenCalledWith("artifact-1", "m1");
    expect(pairingUi.probePairing).toHaveBeenCalledWith("artifact-1", "m1");
  });

  it("uses manual save copy for existing manual pairings", () => {
    const pairingUi = createPairingUi();

    render(
      <PairingSelectionControls
        canProbePair={false}
        feedbackKey="artifact-1"
        pairingCandidates={pairingCandidates}
        pairingUi={pairingUi}
        saveSource="manual"
        selectedBaseModelId="m1"
        targetBadge={{ label: "Ziel base-one.gguf", tone: "ok" }}
      />
    );

    expect(screen.getByRole("button", { name: "Neu zuordnen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Probe" })).toBeDisabled();
  });
});

describe("PairingProbeButton", () => {
  it("triggers runtime probe when enabled", () => {
    const pairingUi = createPairingUi();

    render(
      <PairingProbeButton
        canProbePair
        feedbackKey="artifact-1"
        pairingUi={pairingUi}
        probeBaseModelId="m2"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Probe" }));

    expect(pairingUi.probePairing).toHaveBeenCalledWith("artifact-1", "m2");
  });
});
