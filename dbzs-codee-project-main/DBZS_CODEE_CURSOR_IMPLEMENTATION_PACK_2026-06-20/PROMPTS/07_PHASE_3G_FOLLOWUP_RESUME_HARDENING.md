# Cursor Auftrag — Phase 3G: Follow-up, Resume und Hardening

## Voraussetzung

3A–3F sind grün.

## Ziel

Codee wird für den persönlichen Alltag belastbar.

## Follow-ups

Ein Follow-up gehört zu einem Run.

Beispiele:

- Datei ausschließen
- Reihenfolge ändern
- zusätzlichen Test verlangen
- Step überspringen
- Plan neu erzeugen
- keine Cloud verwenden

Backend speichert und verarbeitet Follow-ups zwischen sicheren Checkpoints.

## Plan Revision

- verbleibende Steps ändern
- abgeschlossene Steps nicht still umschreiben
- Event `plan.revised`
- User sieht Diff des Plans

## Recovery

- Backend-Neustart
- Electron-Neustart
- Runtime-Ausfall
- Host Action unterbrochen
- Command Prozess beendet
- SSE-Verlust

Keine Action doppelt ausführen.

## Abschlussbericht

Automatisch erzeugen:

- Ziel
- Plan
- ausgeführte Steps
- gelesene Dateien
- geänderte Dateien
- Diffs
- Restore Points
- Commands
- Tests
- Fehler und Retries
- verwendetes Modell
- offene Punkte

## Abnahme

Führe das Daily-Use-Szenario aus `03_TARGET_WORKFLOW_AND_READINESS.md` dreimal aus.

Ein Testlauf muss absichtlich unterbrochen und fortgesetzt werden.

Status in README/HANDOVER nur nach realer Abnahme auf „daily usable“ setzen.
