# Migration und Kompatibilität

## Ziel

Kein Big-Bang-Rewrite. Vorhandene brauchbare Module werden eingebunden oder schrittweise ersetzt.

## Job-Spooler

Beibehalten als Queue-Eingang.

Änderung:

- Job kann optional `agent_run_id` referenzieren.
- `run-once` bleibt während Migration erhalten.
- Neuer Workbench-Run kann aus einem Job erzeugt werden.
- Jobstatus wird aus Runstatus synchronisiert.

## AgentRunnerService

Nicht sofort löschen.

Phase:

1. Extrahiere LLM-/Patch-Helfer.
2. Neuer Worker verwendet gemeinsame Helfer.
3. `run-once` wird Legacy-Fassade.
4. Erst nach E2E-Abnahme als deprecated markieren.

## ContextPackService

Beibehalten für Initialübersicht.

Nicht mehr als alleiniger Kontext.

Ergänzen durch:

- gezielte Suche
- Zeilenbereiche
- On-demand File Reads
- Context Budget
- Step-bezogene Context Selection

## OrchestrationService

Toolhandler teilweise wiederverwenden.

Statische `prepare_context()`-Dekomposition nicht als finalen Planner behandeln.

## AutonomousLoopController

Persistenzideen wiederverwenden, aber in `AgentRunService` integrieren.

Nicht parallel als zweite State Machine weiterführen.

## AutonomousSessionPanel

Nach Workbench-Einführung:

- nur noch Legacy-Hinweis
- keine direkte Patch-Anwendung
- keine eigene lokale Queue
- später entfernen

## ReviewGateService

Beibehalten.

Erweitern um:

- `run_id`
- `step_id`
- `file_change_id`
- geplanter Command-Check
- Ergebnisverknüpfung

## Trajectories

ATIF-light Events während Migration unterstützen.

Neue AgentEvents sind Quelle der Wahrheit.

Optionaler Adapter schreibt ausgewählte neue Events zusätzlich in die bestehende Trajectory-Tabelle.

## PatchPipelineService

Beibehalten und als einzigen Desktop-Schreibweg verwenden.

Erweitern um:

- Before-Hash-Prüfung
- atomare Writes
- Resultat mit Added/Removed Lines
- Konflikterkennung bei Dirty Editor Tabs

## TestAgentStore / Safe Commands

Safe Command Infrastruktur beibehalten.

Command-Auswahl wird durch Project Adapter erweitert.

## OperationsNotebook

Neuen Tab `agent-workbench` ergänzen.

Bestehende Tabs nicht entfernen.

## Datenmigration

- neue Tabellen additiv
- keine bestehenden Tabellen löschen
- `schema_version`
- Migrationen idempotent
- Backup der lokalen SQLite-Dateien vor erster Migration
