# Abnahme-Checkliste 1 Seite

Stand: Freitag, 31.07.2026

Projekt: DBZS Codee V4
Ziel: fokussierter Live-Abnahmelauf Richtung `UI_VERIFIED` / `INSTALLER_VERIFIED`

## Vorbereitung

- [ ] `git status` kurz pruefen
- [ ] App mit `powershell -ExecutionPolicy Bypass -File .\start-dev.ps1` starten
- [ ] Pruefen: Backend gesund, App startet normal, Projekt ist geladen

## Block A - Modellwechsel / Absturz

- [ ] Kleines Modell aktiv nutzen
- [ ] Auf `qwen2.5-coder-7b-instruct` wechseln
- [ ] Direkt danach Chat- oder Review-Aktion ausloesen
- [ ] Falls Absturz: `crash.log`, Backend-Log, `run_id`, `activeRuns` sichern
- [ ] Ergebnis notieren: reproduzierbar / nicht reproduzierbar

## Block B - Echter Golden Path

- [ ] Coding-/Patch-Flow starten
- [ ] Diff anzeigen lassen
- [ ] Approval geben
- [ ] Patch anwenden lassen
- [ ] Tests aus Codee starten
- [ ] Rollback ausloesen
- [ ] Pruefen: Originalzustand ist wiederhergestellt

## Block C - Workflow-/Tool-Finalisierung

- [ ] Anfrage wie `Zaehle alle GGUF Modelle im Workspace` testen
- [ ] Pruefen: kein roher `<CODEE_TOOL_CALL>` im Chat
- [ ] Pruefen: Tool-Result-Nachrichten sind eingeklappt
- [ ] Pruefen: kein stilles Fake-`success`

## Block D - Folgeaktionen

- [ ] Normale Chat-Antwort erzeugen
- [ ] Pruefen: nur letzte Assistentenantwort zeigt aktive Folgeaktionen
- [ ] `Naechste Schritte` testen
- [ ] `Vertiefen` testen
- [ ] Fehlerfall provozieren und `Erneut versuchen` testen
- [ ] `switch_model` testen
- [ ] Gegencheck: Patch-/Review-Freigaben optisch unveraendert

## Block E - Dateianhaenge

- [ ] Bild testen
- [ ] `md` oder `json` testen
- [ ] `py` oder `ts` testen
- [ ] `pdf` testen
- [ ] `zip` testen
- [ ] Mehrfachauswahl testen
- [ ] `Strg+V` testen
- [ ] Senden ohne Text testen
- [ ] Pruefen: Vorschau, Hinweise und Vision-Gating sind korrekt

## Block F - Modellkatalog

- [ ] Modellkatalog-Rescan ausloesen
- [ ] Pruefen: keine veralteten Runtime-Pfade sichtbar
- [ ] Pruefen: Modelle erscheinen sauber und vollstaendig

## Block G - Nur wenn alles davor stabil ist

- [ ] Installer-Build separat pruefen
- [ ] Backup-/Restore-Pfad im echten Installer-Kontext verifizieren

## Kurzprotokoll

- Datum:
- Tester:
- Branch/Commit:
- Modelle:
- Absturz reproduziert:
- Golden Path komplett:
- Folgeaktionen ok:
- Dateianhaenge ok:
- Rescan ok:
- Installer getestet:
- Offene Bugs:
- Naechster Schritt:
