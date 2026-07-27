# Tool Runtime und Host Bridge

## Ziel

Der Agent darf nicht einfach Shell und Dateisystem frei bedienen. Er arbeitet über klar definierte Tools.

## Read-only-Tools im Backend

### filesystem.list

- Workspace-Grenze
- relative Pfade
- Limits
- Ignore-Regeln

### filesystem.search

- Dateiname
- Glob
- Textsuche
- Symbol-/Indexsuche, falls verfügbar

### filesystem.read

- Byte-Limit
- Zeilenbereich
- Textdateien
- binäre Dateien ablehnen

### project.detect

- Projektadapter erkennen
- Markerdateien
- Module
- empfohlene Commands

### git.status / git.diff

Nur lesend und über vorhandenen sicheren Git-Service.

## Privilegierte Host-Tools

Diese laufen ausschließlich über Electron Main:

- filesystem.apply_patch
- filesystem.rename
- filesystem.delete
- command.run
- command.cancel
- git.create_branch
- git.commit
- workspace.refresh

## Host Executor

Neue Renderer-/Service-Komponente:

```text
apps/desktop/src/services/agentHostExecutor.ts
```

Aufgaben:

1. offene Host Actions abholen oder per SSE empfangen
2. passende `window.dbzs`-Bridge aufrufen
3. Ergebnis an Backend melden
4. keine Aktion doppelt ausführen
5. bei App-Schließung laufende Action sauber markieren

## Backend-Endpunkte

```text
GET  /agent-workbench/host-actions/next?executor_id=desktop-primary
POST /agent-workbench/host-actions/{id}/claim
POST /agent-workbench/host-actions/{id}/complete
POST /agent-workbench/host-actions/{id}/fail
```

## Sicherheitsregeln

- Pfade immer relativ zum Workspace speichern.
- Vor Host-Aufruf erneut gegen aktiven Workspace auflösen.
- Hash des erwarteten Before-Contents prüfen.
- Bei Hash-Mismatch neue Review-Anforderung statt Überschreiben.
- Commands nur per Adapter-Allowlist.
- Keine PowerShell- oder Shell-Strings aus LLM-Antworten direkt ausführen.
- Keine Secrets im Activity Stream.
- Maximal eine schreibende Host Action gleichzeitig.
