# Agent Workbench UI

## Ziel

Keine Cursor-Kopie. Die Oberfläche soll vorhandene Codee-Komponenten zu einem verständlichen Arbeitsfluss verbinden.

## Grundentscheidung

Nicht noch mehr Panels in die bereits überladene rechte Spalte einbauen.

Stattdessen einen eigenen Notebook-Tab:

`Agent Workbench`

Optional später als separates Electron-Fenster.

## Bereiche

### Run Header

- Ziel
- Workspace
- Modell
- Status
- Laufzeit
- aktueller Step
- Pause
- Resume
- Stop
- Open in Editor
- optional Detach

### Plan Checklist

Jeder Step:

- Nummer
- Titel
- Status
- Rolle
- Versuche
- Abhängigkeiten
- Start-/Endzeit
- Fehlerhinweis

### Activity Stream

Filter:

- Alle
- Tools
- Dateien
- Commands
- Reviews
- Fehler

Darstellung:

- Eventtyp
- Kurztext
- Step
- Zeit
- Datei/Command
- aufklappbare Details

### Follow-up Composer

Eingabe während des Runs:

- Ergänzung
- Prioritätsänderung
- Datei ausschließen
- Step überspringen
- zuerst Tests ausführen
- Plan neu bewerten

Follow-up wird an Run gebunden, nicht als unabhängiger Chat behandelt.

### Review Dock

- Datei
- Diff
- Risiko
- Testplan
- Approve
- Reject mit Begründung
- Apply-Ergebnis
- Rollback

### Output Dock

Tabs:

- Agent
- Commands
- Tests
- Problems
- Artifacts

## Editor-Integration

- Klick auf Dateievent öffnet Datei.
- Klick auf Patch öffnet Diff.
- Apply bleibt über bestehende Safe Patch Pipeline.
- Workspace Explorer aktualisiert nach Host Action.
- Offene Editor-Tabs werden bei externer Änderung nicht still überschrieben.
- Bei Dirty File entsteht Konflikt-Review.

## Statusleiste

Minimal:

- Workspace
- Run-Status
- Step `x/y`
- Modell
- Host Executor
- letzter Command
- Fehler/Warnungen

## Bestehende Komponenten weiterverwenden

- `WorkspaceExplorer`
- `EditorTabPanel`
- `TerminalPanel`
- `JobMonitorPanel` zunächst als Legacy/Queue-Ansicht
- `ReviewGatePanel` später durch Review Dock ersetzen
- `TrajectoryMiniPanel` durch Activity Stream ablösen
- `RuntimeChatTab` für freie Chats behalten, nicht als Run-State missbrauchen
