import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SafeModeOverlay } from "./SafeModeOverlay";

// Mock der Electron Preload API
const mockDbzsApi = {
  restartApp: vi.fn()
};

describe("SafeModeOverlay", () => {
  beforeEach(() => {
    // @ts-expect-error - Mocking window object
    global.window = { dbzs: mockDbzsApi };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const testError = {
    phase: "filesystem-check",
    message: "Modellverzeichnis konnte nicht gelesen werden."
  };

  it("sollte den Titel und die allgemeinen Informationen korrekt rendern", () => {
    render(<SafeModeOverlay error={testError} />);
    expect(screen.getByText("Safe Mode Aktiv")).toBeInTheDocument();
    expect(screen.getByText(/Die Anwendung konnte nicht vollständig gestartet werden/)).toBeInTheDocument();
  });

  it("sollte die spezifische Fehlerphase und -nachricht anzeigen", () => {
    render(<SafeModeOverlay error={testError} />);
    expect(screen.getByText("Fehler in Phase:")).toBeInTheDocument();
    expect(screen.getByText(testError.phase)).toBeInTheDocument();
    expect(screen.getByText(testError.message)).toBeInTheDocument();
  });

  it("sollte einen Neustart-Button rendern", () => {
    render(<SafeModeOverlay error={testError} />);
    const restartButton = screen.getByRole("button", { name: "Anwendung neu starten" });
    expect(restartButton).toBeInTheDocument();
  });

  it("sollte die restartApp-Funktion aufrufen, wenn der Button geklickt wird", () => {
    render(<SafeModeOverlay error={testError} />);
    const restartButton = screen.getByRole("button", { name: "Anwendung neu starten" });
    fireEvent.click(restartButton);
    expect(mockDbzsApi.restartApp).toHaveBeenCalledOnce();
  });
});
