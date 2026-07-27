import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RoutingDiagnosticsCard } from "./RoutingDiagnosticsCard";
import type { RoutingDiagnostics, RuntimeWarmupDiagnostics } from "@/types/runtimeRoutingDiagnostics";

describe("RoutingDiagnosticsCard", () => {
  const baseDiagnostics: RoutingDiagnostics = {
    decision: {
      decidedAt: new Date("2026-07-26T10:00:00Z").toISOString(),
      taskType: "coding",
      targetAgent: "coder",
      slotId: "fast_gpu",
      modelId: "test-model-id",
      modelName: "Test Model",
      reason: "Default for coding task",
      source: "automatic"
    },
    validation: {
      slotReady: true,
      slotMessage: "Ready",
      memoryAvailable: true,
      memoryMessage: "Available",
      canStart: true
    }
  };

  it("sollte eine Nachricht anzeigen, wenn keine Diagnosedaten vorhanden sind", () => {
    render(<RoutingDiagnosticsCard diagnostics={null} />);
    expect(screen.getByText("Keine Diagnosedaten verfügbar.")).toBeInTheDocument();
  });

  it("sollte eine Nachricht anzeigen, wenn keine Routing-Entscheidung vorhanden ist", () => {
    render(<RoutingDiagnosticsCard diagnostics={{ ...baseDiagnostics, decision: null }} />);
    expect(screen.getByText("Keine Diagnosedaten verfügbar.")).toBeInTheDocument();
  });

  it("sollte eine erfolgreiche Routing-Entscheidung korrekt rendern", () => {
    render(<RoutingDiagnosticsCard diagnostics={baseDiagnostics} />);
    expect(screen.getByText("Task").parentElement?.textContent).toContain("coding");
    expect(screen.getByText("Agent").parentElement?.textContent).toContain("coder");
    expect(screen.getByText("Slot").parentElement?.textContent).toContain("fast_gpu");
    expect(screen.getByText("Model").parentElement?.textContent).toContain("Test Model");
    expect(screen.getByText("Default for coding task")).toBeInTheDocument();
    expect(screen.getByText("✓ Ready")).toBeInTheDocument();
  });

  it("sollte eine 'DEGRADED'-Warnung für einen Fallback anzeigen", () => {
    const fallbackDiagnostics: RoutingDiagnostics = {
      ...baseDiagnostics,
      decision: {
        ...baseDiagnostics.decision!,
        source: "fallback"
      }
    };
    render(<RoutingDiagnosticsCard diagnostics={fallbackDiagnostics} />);
    expect(screen.getByText("DEGRADED: Fallback-Modell wird verwendet.")).toBeInTheDocument();
  });

  it("sollte Validierungsfehler anzeigen", () => {
    const validationErrorDiagnostics: RoutingDiagnostics = {
      ...baseDiagnostics,
      validation: {
        slotReady: false,
        slotMessage: "Not running",
        memoryAvailable: true,
        memoryMessage: "Available",
        canStart: false
      }
    };
    render(<RoutingDiagnosticsCard diagnostics={validationErrorDiagnostics} />);
    expect(screen.getByText(/✗ Slot \(Not running\)/)).toBeInTheDocument();
    expect(screen.getByText("✗ Blocked")).toBeInTheDocument();
  });

  it("sollte Fehlerinformationen anzeigen, wenn vorhanden", () => {
    const errorDiagnostics: RoutingDiagnostics = {
      ...baseDiagnostics,
      errorClassification: {
        errorType: "warmup_failed",
        errorMessage: "Model did not respond",
        retryable: false,
        retryCount: 1
      }
    };
    render(<RoutingDiagnosticsCard diagnostics={errorDiagnostics} />);
    expect(screen.getByText("Error:")).toBeInTheDocument();
    expect(screen.getByText("warmup_failed")).toBeInTheDocument();
    expect(screen.getByText("Model did not respond")).toBeInTheDocument();
    expect(screen.getByText(/✗ No Retry \(attempt #1\)/)).toBeInTheDocument();
  });

  it("sollte Warm-up-Diagnosedaten anzeigen, wenn vorhanden", () => {
    const warmupDiagnostics: RuntimeWarmupDiagnostics = {
      endpoint: "http://localhost:8080/v1/chat/completions",
      apiMode: "chat",
      httpStatus: 500,
      parserDecision: "Failed to parse response",
      rawResponsePreview: "{'error': 'Internal Server Error'}"
    };
    const diagnostics: RoutingDiagnostics = {
      ...baseDiagnostics,
      warmup: warmupDiagnostics
    };
    render(<RoutingDiagnosticsCard diagnostics={diagnostics} />);
    expect(screen.getByText("Warm-up Fehlerdiagnose")).toBeInTheDocument();
    expect(screen.getByText("Endpoint").parentElement?.textContent).toContain(warmupDiagnostics.endpoint);
    expect(screen.getByText("HTTP Status").parentElement?.textContent).toContain("500");
    expect(screen.getByText("Parser-Entscheidung").parentElement?.textContent).toContain(warmupDiagnostics.parserDecision);
    expect(screen.getByText(warmupDiagnostics.rawResponsePreview!)).toBeInTheDocument();
  });

  it("sollte optionale Felder nicht rendern, wenn sie nicht vorhanden sind", () => {
    render(<RoutingDiagnosticsCard diagnostics={baseDiagnostics} />);
    expect(screen.queryByText("Error:")).not.toBeInTheDocument();
    expect(screen.queryByText("Warm-up Fehlerdiagnose")).not.toBeInTheDocument();
    expect(screen.queryByText("DEGRADED: Fallback-Modell wird verwendet.")).not.toBeInTheDocument();
  });
});
