import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityRail, RAIL_REGISTRY } from "./ActivityRail";

describe("ActivityRail", () => {
  it("renders the navigation registry and dispatches rail selections", () => {
    const onSelect = vi.fn();
    render(<ActivityRail activeItem="workspace" branchLabel="dev" onSelect={onSelect} />);

    for (const entry of RAIL_REGISTRY) {
      expect(screen.getByRole("button", { name: `${entry.label} (Ctrl+${entry.shortcut})` })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "Model Lab (Ctrl+7)" }));
    expect(onSelect).toHaveBeenCalledWith("model-lab");
    expect(screen.getByTitle("Branch: dev")).toBeInTheDocument();
  });

  it("shows badge counts and caps large values at 99+", () => {
    render(
      <ActivityRail
        activeItem="chat"
        badges={{ chat: 3, jobs: 120 }}
        branchLabel="feature/refactor"
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByLabelText("3 Einträge")).toBeInTheDocument();
    expect(screen.getByLabelText("120 Einträge")).toHaveTextContent("99+");
  });
});
