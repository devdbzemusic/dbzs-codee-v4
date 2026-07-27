"""Heuristic plan generation from run goal."""

from __future__ import annotations

from app.agent_workbench.models import PlanStepInput


def generate_plan_from_goal(goal: str) -> list[PlanStepInput]:
    """Build a simple multi-step plan without LLM."""
    goal_lower = goal.lower()
    steps: list[PlanStepInput] = [
        PlanStepInput(
            title="Projektstruktur analysieren",
            description="Workspace und Projekttyp erkunden.",
            role="researcher",
        ),
        PlanStepInput(
            title="Kontext sammeln",
            description="Relevante Dateien lesen und Git-Status prüfen.",
            role="researcher",
            depends_on=["1"],
        ),
    ]

    if any(kw in goal_lower for kw in ("fix", "bug", "fehler", "repair")):
        steps.append(
            PlanStepInput(
                title="Fehler beheben",
                description=f"Ziel: {goal}",
                role="coder",
                depends_on=["2"],
            )
        )
        steps.append(
            PlanStepInput(
                title="Fix verifizieren",
                description="Tests und Checks ausführen.",
                role="tester",
                depends_on=["3"],
            )
        )
    elif any(kw in goal_lower for kw in ("test", "prüf", "verify")):
        steps.append(
            PlanStepInput(
                title="Tests ausführen",
                description=f"Ziel: {goal}",
                role="tester",
                depends_on=["2"],
            )
        )
    else:
        steps.append(
            PlanStepInput(
                title="Änderung umsetzen",
                description=f"Ziel: {goal}",
                role="coder",
                depends_on=["2"],
            )
        )
        steps.append(
            PlanStepInput(
                title="Ergebnis prüfen",
                description="Review und Tests.",
                role="reviewer",
                depends_on=["3"],
            )
        )

    return steps


def demo_readonly_steps() -> list[PlanStepInput]:
    """Three read-only demo steps for integration tests (phase 3B)."""
    return [
        PlanStepInput(
            title="Demo: Workspace auflisten",
            description="Listet Workspace-Inhalt (read-only).",
            role="researcher",
        ),
        PlanStepInput(
            title="Demo: Projekt erkennen",
            description="Erkennt Projektadapter (read-only).",
            role="researcher",
            depends_on=["1"],
        ),
        PlanStepInput(
            title="Demo: Git-Status",
            description="Liest Git-Status (read-only).",
            role="researcher",
            depends_on=["2"],
        ),
    ]
