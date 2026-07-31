# Abnahme-Checkliste

Stand: 2026-07-31

Ziel: fokussierter Abnahme-Sprint fuer DBZS Codee V4 auf dem Weg von `SERVICE_VERIFIED` zu mehr `UI_VERIFIED` beziehungsweise `INSTALLER_VERIFIED`.

## Abendplan

1. **Absturz nach Modellwechsel reproduzieren**
   - App sauber mit `start-dev.ps1` starten
   - kleines Modell aktiv nutzen
   - auf `qwen2.5-coder-7b-instruct` wechseln
   - direkt danach eine echte Chat- oder Review-Aktion ausloesen
   - bei Absturz sofort `crash.log`, Backend-Log, `run_id` und `activeRuns` sichern
   - Erfolgskriterium:
     - entweder Absturz reproduziert mit klarer Korrelation
     - oder sauber dokumentiert: auf aktuellem Stand nicht reproduzierbar

2. **Echten Golden Path komplett durchziehen**
   - Aufgabe senden
   - Aenderung als Diff erzeugen lassen
   - Approval geben
   - Patch anwenden
   - Tests aus Codee starten
   - Rollback ausloesen
   - Erfolgskriterium:
     - Tests wurden wirklich aus der UI gestartet
     - Rollback stellt den Originalzustand nachweisbar wieder her

3. **Workflow-Audit-Smoke mit echtem Modell**
   - Beispielanfrage wie `Zaehle alle GGUF Modelle im Workspace`
   - auf sichtbare Endantwort achten
   - pruefen, dass kein roher `<CODEE_TOOL_CALL>`-Block im Chat landet
   - pruefen, dass Tool-Result-Nachrichten eingeklappt erscheinen
   - Erfolgskriterium:
     - echte natuerlichsprachliche Antwort oder ehrlicher Failure, aber kein stilles Fake-`success`

4. **Chat-Folgeaktionen manuell pruefen**
   - normale Chat-Antwort
   - `Naechste Schritte`
   - `Vertiefen`
   - Fehlerfall provozieren und `Erneut versuchen` / `switch_model` pruefen
   - sicherstellen, dass nur die letzte Assistentenantwort aktive Aktionen zeigt

5. **Dateianhaenge komplett durchspielen**
   - je ein Bild, `md`, `json`, `pdf`, `zip`, `py`
   - Mehrfachauswahl
   - `Strg+V`
   - Senden ohne zusaetzlichen Prompt
   - ZIP-/PDF-Hinweise beobachten
   - Erfolgskriterium:
     - Vorschau stimmt
     - Payload wird sinnvoll uebernommen
     - keine falschen Vision-Flags bei Nicht-Bild-Dateien

6. **Modellkatalog-Rescan am Ende**
   - Rescan im Model Control Center
   - pruefen, dass Modelle und Runtime-Pfade sauber erscheinen

7. **Nur wenn 1 bis 6 sauber sind: Installer-Slice**
   - gepackten Build testen
   - `backupService.ts`-Userdata-Pfad im echten Installer-Kontext pruefen

## Kompakte Abhakliste

- [ ] App mit `start-dev.ps1` starten
- [ ] Pruefen, dass Backend gesund ist und die App normal hochkommt
- [ ] Kleines Modell nutzen, dann auf `qwen2.5-coder-7b-instruct` wechseln
- [ ] Direkt danach Chat- oder Review-Aktion ausloesen
- [ ] Falls Absturz: `crash.log`, Backend-Log, `run_id`, `activeRuns` sichern

- [ ] Einen echten Coding-/Patch-Flow starten
- [ ] Diff anzeigen lassen
- [ ] Approval geben
- [ ] Patch anwenden lassen
- [ ] Tests aus Codee starten
- [ ] Rollback ausloesen
- [ ] Pruefen, dass der Ursprungszustand wirklich wiederhergestellt ist

- [ ] Workspace-Datei-/Tool-Anfrage testen, z. B. `Zaehle alle GGUF Modelle im Workspace`
- [ ] Pruefen: kein roher `<CODEE_TOOL_CALL>` im Chat
- [ ] Pruefen: Tool-Result-Nachrichten sind eingeklappt
- [ ] Pruefen: ehrlicher Failure statt stilles Fake-`success`, falls keine Endantwort entsteht

- [ ] Normale Chat-Antwort erzeugen
- [ ] Pruefen: nur die letzte Assistentenantwort zeigt Folgeaktionen
- [ ] `Naechste Schritte` klicken
- [ ] `Vertiefen` testen
- [ ] Fehlerfall provozieren und `Erneut versuchen` pruefen
- [ ] `switch_model` pruefen
- [ ] Gegencheck: Patch-/Review-Freigaben optisch unveraendert

- [ ] Dateianhaenge testen: Bild, `md`, `json`, `py`, `pdf`, `zip`
- [ ] Mehrfachauswahl testen
- [ ] `Strg+V` testen
- [ ] Senden ohne zusaetzlichen Text testen
- [ ] Pruefen: Vorschau stimmt
- [ ] Pruefen: PDF-/ZIP-Hinweise sinnvoll
- [ ] Pruefen: keine falschen Vision-Flags bei Nicht-Bild-Dateien

- [ ] Modellkatalog-Rescan ausloesen
- [ ] Pruefen: keine veralteten Runtime-Pfade sichtbar
- [ ] Pruefen: Modelle erscheinen weiterhin sauber und vollstaendig

- [ ] Wenn 1 bis 33 sauber sind: Installer-Build separat pruefen
- [ ] Backup-/Restore-Pfad im echten Installer-Kontext verifizieren

## Startbefehle

```powershell
git status
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```
