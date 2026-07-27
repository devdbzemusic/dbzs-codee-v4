# Cursor Auftrag — Phase 3C: Context Retrieval und sichere Read-only-Tools

## Voraussetzung

3A und 3B sind grün.

## Ziel

Der Worker soll Projekte gezielt untersuchen können, statt nur einen kleinen statischen Context Pack in einen Prompt zu pressen.

## Bestehendes verwenden

- `backend/app/context_pack/service.py`
- `backend/app/orchestration/service.py`
- bestehende Workspace-Sandbox
- vorhandene Code-Index-Ideen im Desktop, soweit sinnvoll übertragbar

## Tools

- `filesystem.list`
- `filesystem.search`
- `filesystem.read`
- `project.detect`
- `git.status`
- `git.diff`

## Anforderungen

Jeder Tool Call:

- persistiert in `agent_tool_calls`
- mit Run und Step verknüpft
- erzeugt Start/Output/Complete/Fail Events
- besitzt Limits
- validiert Workspace
- liefert strukturiertes Ergebnis

## Context Budget

Einführen:

- maximales Gesamtbudget pro Step
- maximales Dateibudget
- Zeilenbereiche
- Deduplizierung
- Priorität für aktive/betroffene Dateien
- Context Summary

`ContextPackService` bleibt Initialübersicht, nicht alleiniger Kontext.

## LLM-Integration

Ein Step darf das Modell iterativ Tools anfordern lassen.

Kein freier Shell-Zugang.

Strukturierte Tool Requests validieren.

## Tests

- Path Traversal
- Binary File
- Byte/Line Limits
- Search Limits
- Tool Persistence
- Eventfolge
- Context Budget
- Modell fordert unbekanntes Tool an
