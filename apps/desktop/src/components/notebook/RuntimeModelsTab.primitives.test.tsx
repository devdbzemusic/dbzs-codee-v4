import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProbeEvidencePanel, SummaryBadge, ToneBadge } from "./RuntimeModelsTab.primitives";

describe("ToneBadge", () => {
  it("renders label and optional title", () => {
    render(
      <ToneBadge title="Hilfetext" tone="ok">
        Verifiziert
      </ToneBadge>
    );

    const badge = screen.getByText("Verifiziert");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", "Hilfetext");
  });
});

describe("SummaryBadge", () => {
  it("renders compact summary content", () => {
    render(<SummaryBadge tone="info">Gesamt 4</SummaryBadge>);

    expect(screen.getByText("Gesamt 4")).toBeInTheDocument();
  });
});

describe("ProbeEvidencePanel", () => {
  it("renders outcome, feedback and evidence rows", () => {
    render(
      <ProbeEvidencePanel
        align="left"
        evidence={[
          { tone: "ok", text: "Basis-Endpoint: ok" },
          { tone: "info", text: "Gemeldete Modelle: base-one.gguf" }
        ]}
        feedback="Probe abgeschlossen"
        outcome={{ label: "Probe verifiziert", tone: "ok" }}
      />
    );

    expect(screen.getByText("Probe verifiziert")).toBeInTheDocument();
    expect(screen.getByText("Probe abgeschlossen")).toBeInTheDocument();
    expect(screen.getByText("Basis-Endpoint: ok")).toBeInTheDocument();
    expect(screen.getByText("Gemeldete Modelle: base-one.gguf")).toBeInTheDocument();
  });
});
