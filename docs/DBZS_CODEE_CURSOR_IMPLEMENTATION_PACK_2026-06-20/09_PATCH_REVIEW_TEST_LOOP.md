# Geschlossener Patch-, Review- und Test-Zyklus

## Problem des heutigen Zustands

Patch-Proposals, Review Gates, Safe Patch Pipeline und Tests existieren, sind aber nicht als eine verbindliche Zustandsmaschine gekoppelt.

## Zielzyklus

```text
Patch Proposal
  → Diff Preview
  → Risk Classification
  → Review Gate
  → Approve/Reject
  → HostAction apply_patch
  → Restore Point
  → Workspace Refresh
  → Project Adapter Checks
  → Result Evaluation
  → Step Complete oder Debug Step
```

## Patch Proposal

Der Agent liefert keine freien Markdown-Diffs, sondern strukturierte Änderungen:

```json
{
  "file_path": "src/example.ts",
  "operation": "modify",
  "summary": "Fehlerbehandlung ergänzen",
  "proposed_content": "...",
  "expected_before_hash": "sha256:..."
}
```

## Review Gate

Ein Gate enthält:

- Run und Step
- Datei
- Operation
- Before/After Diff
- hinzugefügte/entfernte Zeilen
- Risikostufe
- Risikofaktoren
- geplante Prüfcommands
- Modell
- Agentenrolle

## Apply

Nach Genehmigung:

1. Host prüft Workspace und Before-Hash.
2. Restore Point wird erstellt.
3. Patch wird atomar geschrieben.
4. Diff und Restore Point werden an Backend gemeldet.
5. Explorer scannt betroffene Datei/Ordner neu.
6. Event `file.modified` oder `file.created`.

## Tests

Nach Apply führt der Projektadapter mindestens aus:

- schnellster relevanter Check
- betroffener Test, falls ermittelbar
- danach breiter Projektcheck nach Konfiguration

## Fehlerfall

Bei fehlschlagendem Command:

1. stdout/stderr und strukturierte Diagnostik speichern
2. Step nicht als abgeschlossen markieren
3. neuen Debug-Step erzeugen
4. relevante Dateien gezielt lesen
5. maximal konfigurierte Retry-Anzahl
6. danach `waiting_user` oder `failed`

## Rollback

Der User kann:

- einzelne Änderung zurückrollen
- gesamten Step zurückrollen
- Run auf letzten grünen Restore Point zurücksetzen

Rollback erzeugt eigene Events und darf nicht still erfolgen.
