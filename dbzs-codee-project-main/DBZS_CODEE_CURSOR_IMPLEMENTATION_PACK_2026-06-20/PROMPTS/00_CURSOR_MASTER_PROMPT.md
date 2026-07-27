# Cursor Master Instructions — Division By Zeros (DBZS) Codee

Du arbeitest im Repository `devdbzemusic/dbzs-codee-project`.

## Ziel

Codee soll zu einer persönlich nutzbaren, lokalen Entwicklungsumgebung werden, die Sourcecode-Projekte sicher analysieren, planen, ändern, testen und iterativ reparieren kann.

Cursor ist hier nur das Implementationswerkzeug. Es soll weder Cursor-UI noch Cursor-Produktlogik kopiert werden.

## Einsatzrahmen

- ein Benutzer
- ein lokaler Windows-Rechner
- Electron + React
- FastAPI
- SQLite
- lokale Modelle mit optionalem Cloud-Fallback
- supervised mode als Standard

Nicht bauen:

- Auth
- Multi-User
- Team Collaboration
- verteilte Worker
- Enterprise-Telemetrie
- öffentliche Cloud-Infrastruktur

## Vor jeder Änderung

Lies mindestens:

- `README.md`
- `HANDOVER.md`
- `LATER_TODO.MD`
- relevanten Phasenprompt
- alle dort genannten Source-Dateien

Prüfe vorhandene Implementierung. Erfinde keine parallele Architektur.

## Bestehende Bausteine, die erhalten werden sollen

- Job-Spooler
- AgentRunnerService als Legacy-Fassade
- ContextPackService
- ReviewGateService
- Trajectories
- PatchPipelineService
- FileChangeService
- RestorePointService
- Safe Commands
- WorkspaceExplorer
- EditorTabPanel
- Runtime Provider
- SSE-Infrastruktur

## Harte Regeln

1. Nur die aktuelle Phase umsetzen.
2. Keine UI vor dem Backendkern.
3. Keine direkte Dateiänderung aus LLM-Antwort.
4. Keine beliebigen Shell-Kommandos.
5. Kein Auto-Apply.
6. Keine flüchtige Renderer-Map als Workflow-Quelle.
7. Migrationen additiv und idempotent.
8. Bestehende APIs nicht unnötig brechen.
9. Tests und Dokumentation aktualisieren.
10. Nicht ausgeführte Tests als `NOT RUN` ausweisen.

## Abschluss

Berichte:

- geänderte Dateien
- Architekturentscheidungen
- Datenmigration
- Tests
- offene Punkte
- Risiken
