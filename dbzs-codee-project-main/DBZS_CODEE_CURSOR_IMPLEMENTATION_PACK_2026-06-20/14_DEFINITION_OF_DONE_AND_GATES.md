# Definition of Done und Gates

## Globales DoD

Eine Phase ist nur abgeschlossen, wenn:

1. Implementierung vollständig ist.
2. Keine Platzhalter- oder Fake-Erfolgspfade vorhanden sind.
3. Fehlerpfade getestet sind.
4. Dokumentation dem echten Code entspricht.
5. bestehende Tests weiterhin grün sind.
6. neue Tests grün sind.
7. Migration rückwärtskompatibel ist.
8. keine Secrets geloggt werden.
9. Workspace-Sandbox erhalten bleibt.
10. Abschlussbericht geänderte Dateien und offene Punkte nennt.

## Gate 3A — Backbone

- Run CRUD
- Step CRUD
- State Transitions
- SQLite Migration
- API registriert
- Recovery-Markierung
- Unit Tests

## Gate 3B — Event und Worker

- Event sequence
- SSE reconnect
- ein Worker
- Pause/Resume/Cancel
- kein Renderer-State als Quelle der Wahrheit
- Read-only Demo-Run

## Gate 3C — Tools

- list/search/read
- Workspace-Sandbox
- Tool Call Persistenz
- Tool Events
- Context Budget
- keine direkten Writes

## Gate 3D — Adapter und Host Actions

- mindestens Node, Python, Rust
- Gradle und CMake als nächste Adapter
- sichere Command IDs
- Host Action Claim/Complete/Fail
- Idempotenz

## Gate 3E — Closed Loop

- Patch Proposal
- Review Gate
- Apply mit Restore Point
- Tests real ausgeführt
- Debug-Step bei Fehler
- Rollback
- keine Auto-Apply-Umgehung

## Gate 3F — Workbench

- Runliste
- Plan
- Activity Stream
- Review Dock
- Output
- Editor Jump
- Live SSE
- verständliche Fehlerzustände

## Gate 3G — Daily Use

- Follow-up
- Plan Revision
- Restart Resume
- Crash Recovery
- drei erfolgreiche Acceptance-Runs
- ein absichtlicher Fehlerlauf mit Recovery
