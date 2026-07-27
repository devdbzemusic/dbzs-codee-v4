# Phase 3H - Live-LLM Acceptance Run

- **Status:** IMPLEMENTIERT – LIVE-ABNAHME AUSSTEHEND
- **Datum:** 2026-06-21
- **Provider:** `llama.cpp`
- **Modell-ID:** `Llama-3.2-3B-CodeReactor.Q8-0`
- **Modell-Endpoint:** `http://127.0.0.1:8091`
- **Acceptance-Projekt:** `fixtures/agent-workbench-live-acceptance`

---

## 1. Übersicht

Der E2E-Workflow zwischen der Agent Workbench und dem echten GGUF-Modell wurde implementiert und abgesichert. Es findet kein stiller Rückfall auf Mocks oder Simulationen statt, wenn im Live-Modus gestartet wird.

## 2. Erzeugte Artefakte und Proof Bundle

Alle Details zu den Runs, ausgeführten Befehlen, Testoutputs und File Change Proposals werden in `artifacts/agent-workbench-live/<run-id>/` persistiert:

- `run-summary.json`
- `events.jsonl`
- `run-report.md`
