# DBZS Codee V4 – Verifikation persönlicher Produktivbetrieb

**Repository:** `devdbzemusic/dbzs-codee-v4`  
**Prüfdatum:** 2026-07-28  
**Geprüfter HEAD:** `934d907650b75855bd5d6487fa5ceaa850ac5a64`

## Urteil

Die zentralen Maßnahmen für deinen persönlichen Produktivbetrieb wurden umgesetzt und nach `main` gemergt.

**Status: PERSONAL-RC – bereit für die reale Abnahme auf deinem Windows-System.**

Noch nicht bewiesen ist nur der vollständige tägliche Golden Path in der laufenden Desktop-App.

## Verifiziert umgesetzt

- `project_local_strict` als tatsächlicher lokaler Standardpfad
- vereinheitlichte Review-Ausschlüsse
- Ausschluss von `.codee`, `.cache`, `playwright-report`, `test-results`, `*.log` und `.env`
- Schließung eines Approval-Bypasses
- Absicherung der `dbzs:fs:*`-IPC-Handler
- Schließung eines `.env`-Lese-Bypasses
- lokaler Backup-/Restore-Service
- Crash-Logging für `uncaughtException`, `unhandledRejection` und `will-quit`
- Runtime-Chat-Umbau auf conversation-first
- Tests für Backup, Restore, Aufbewahrung und Fälligkeit
- Desktop-Typecheck, betroffene Vitest-/Pytest-Suites und Electron-Build laut PR erfolgreich

## Noch offen

Der Pull Request nennt den manuellen Golden-Path-Test ausdrücklich als noch nicht durchgeführt.

Damit musst du real prüfen:

- [ ] App startet zehnmal fehlerfrei
- [ ] Projekt lässt sich öffnen und bleibt gespeichert
- [ ] lokales Modell verbindet sich
- [ ] Chat beantwortet eine Projektfrage
- [ ] Full-Repository-Review läuft durch
- [ ] `.codee`, `.env`, Logs und Builds fehlen im Inventory
- [ ] Änderung wird zuerst als Diff gezeigt
- [ ] Änderung verlangt Freigabe
- [ ] Änderung lässt sich anwenden
- [ ] Tests lassen sich starten
- [ ] Rollback oder Restore-Point funktioniert
- [ ] Backup und Restore funktionieren
- [ ] Neustart nach Abbruch erhält den Zustand

## Startbefehle

```powershell
git checkout main
git pull
pnpm install
cd backend
uv sync
cd ..
pnpm ci:local:win
pnpm dev
```

## Freigabekriterium

Wenn der Ablauf vollständig funktioniert und an zwei weiteren Tagen reproduzierbar bleibt:

```text
DBZS Codee 0.4.0-personal-stable
```

## Fazit

Die bisherigen Kernblocker wurden tatsächlich bearbeitet. Der verbleibende Schritt ist keine große Entwicklungsphase mehr, sondern die reale Abnahme auf deinem Rechner.
