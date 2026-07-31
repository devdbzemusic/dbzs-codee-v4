# DBZS Codee V4 – Abnahme-Test-Playbook

**Repository:** `devdbzemusic/dbzs-codee-v4`  
**Zielversion:** `0.4.0-rc.1` → `0.4.0-personal-stable`  
**Stand:** 31.07.2026  
**Statuskette:** `SERVICE_VERIFIED` → `UI_VERIFIED` → `INSTALLER_VERIFIED` → `PERSONAL_STABLE`

---

# 1. Zweck

Dieses Playbook dient als verbindliche Abnahmevorschrift für DBZS Codee V4.

Es soll nicht nur zeigen, dass einzelne Tests grün sind, sondern dass Codee im echten Betrieb:

- startet,
- lokale Modelle verwaltet,
- Aufgaben korrekt routet,
- Dateien und Workspaces sicher verarbeitet,
- Änderungen kontrolliert anwendet,
- Fehler nachvollziehbar meldet,
- Tests ausführt,
- Rollbacks zuverlässig durchführt,
- Abstürze übersteht,
- als installierte Desktop-App funktioniert,
- über mehrere Tage reproduzierbar stabil bleibt.

Ein Test gilt nur dann als bestanden, wenn:

1. der Sollzustand erreicht wurde,
2. kein nicht erklärter Fehler im UI sichtbar ist,
3. keine kritischen Fehler in Logs oder Crash-Dateien auftauchen,
4. die geforderten Beweisartefakte gespeichert wurden.

---

# 2. Rollen

## Testleiter

Bedient Codee und dokumentiert das Ergebnis.

## Beobachter

Kontrolliert Logs, Dateisystem, Prozesse und Ergebnisartefakte.

Bei Einzelabnahme können beide Rollen von derselben Person durchgeführt werden.

---

# 3. Grundregeln

## 3.1 Keine stillen Fehler akzeptieren

Folgende Situationen gelten immer als Fehler:

- sichtbare Tool-Protokolle als Endantwort,
- angeblicher Erfolg ohne fachliche Endantwort,
- leere Antwort ohne verständliche Fehlermeldung,
- unbemerkter Modellwechsel,
- unerklärter Prozessabbruch,
- Dateiänderung ohne Diff und Freigabe,
- Teststatus ohne real ausgeführten Test,
- Rollback ohne Wiederherstellung des ursprünglichen Dateistands.

## 3.2 Testdaten sichern

Vor jedem Lauf:

```powershell
git status
git rev-parse HEAD
git branch --show-current
```

Die Ausgabe im Testprotokoll speichern.

## 3.3 Testworkspace verwenden

Empfohlener Workspace:

```text
test-fixtures/runtime-chat-tuning-lab
```

Alternativ einen separaten Testordner verwenden. Niemals zuerst an einem ungesicherten Produktivprojekt testen.

## 3.4 Logs nicht löschen

Vor dem Lauf können alte Logs archiviert werden. Aktuelle Logs dürfen erst nach abgeschlossener Auswertung gelöscht werden.

## 3.5 Ergebnisstatus

Für jeden Test nur einen dieser Werte verwenden:

- `PASS`
- `FAIL`
- `BLOCKED`
- `NOT_RUN`

---

# 4. Verzeichnis für Abnahmebeweise

Für jeden Abnahmelauf einen eigenen Ordner anlegen:

```text
docs/audits/runs/YYYY-MM-DD_HH-mm/
```

Beispiel:

```text
docs/audits/runs/2026-07-31_14-30/
```

Empfohlene Struktur:

```text
run/
├── RUN_SUMMARY.md
├── environment.txt
├── git-status.txt
├── screenshots/
├── logs/
├── diffs/
├── test-output/
├── backups/
└── crash/
```

---

# 5. Testprotokoll-Vorlage

```markdown
## Test ID

- Status:
- Datum:
- Tester:
- Commit:
- Branch:
- App-Modus: Dev / Installer / Portable
- Modell:
- Runtime-Slot:
- Workspace:

### Durchführung

1.
2.
3.

### Ist-Ergebnis

### Erwartetes Ergebnis

### Beweise

- Screenshot:
- Log:
- Diff:
- Testausgabe:

### Abweichungen

### Entscheidung

PASS / FAIL / BLOCKED
```

---

# 6. Stufe A – SERVICE_VERIFIED

Diese Tests prüfen Services und automatisierte Qualitäts-Gates ohne vollständige UI-Abnahme.

---

## SV-01 – Repository- und Abhängigkeitszustand

### Ziel

Sicherstellen, dass der Prüfstand reproduzierbar und sauber ist.

### Vorbereitung

```powershell
git status
git rev-parse HEAD
pnpm install --frozen-lockfile
cd backend
uv sync --frozen
cd ..
```

### Soll

- Installation endet ohne Fehler.
- Lockfiles werden nicht verändert.
- Keine unerklärten lokalen Änderungen.
- Backend-Umgebung ist vollständig synchronisiert.

### Beweise

- Konsolenausgabe
- `git-status.txt`
- Commit-SHA

### PASS

Alle Befehle erfolgreich, keine unbeabsichtigte Änderung.

---

## SV-02 – Vollständiges lokales CI-Gate

### Durchführung

```powershell
pnpm ci:local:win
```

### Soll

Erfolgreich:

- Dependency Sync
- Repo Health
- Contract Verification
- Typecheck
- Shared Tests
- Desktop Tests
- Capability Suite
- Backend Tests
- Desktop Build
- Packaging Smoke
- Security Regression
- Backend Smoke
- Backend Doctor
- Dependency Audit

### FAIL

- irgendein Block rot,
- übersprungener Pflichtblock,
- Prozessabbruch,
- uneindeutiger Exitcode.

### Beweise

Gesamte Konsolenausgabe nach:

```text
test-output/ci-local-win.txt
```

---

## SV-03 – TypeScript-Typecheck

```powershell
pnpm typecheck
```

### Soll

Keine TypeScript-Fehler in:

- `packages/shared`
- `apps/desktop`

### PASS

Exitcode 0.

---

## SV-04 – Backend-Testlauf

```powershell
cd backend
uv run pytest -q
```

### Soll

- keine fehlgeschlagenen Tests,
- keine unerklärten Hänger,
- bekannte Windows-Datei-Lock-Flakes separat dokumentieren und erneut prüfen.

### FAIL

Ein reproduzierbarer Testfehler gilt als FAIL, auch wenn andere Tests grün sind.

---

## SV-05 – Capability-Abnahme

```powershell
pnpm test:capabilities
```

### Soll

- Desktop Capability Suite vollständig grün,
- Backend Capability-, Scenario- und Tuning-Lab-Tests grün.

### Beweis

Komplette Testausgabe.

---

## SV-06 – Contract-Parität

```powershell
pnpm contracts:verify
```

### Ziel

Prüfen, ob gemeinsame TypeScript-, JSON- und Python-Verträge synchron sind.

### Besonders prüfen

- Runtime-Slot-IDs,
- Task-Typen,
- Settings-Felder,
- Modellrollen,
- API-Schemas.

### PASS

Keine Contract-Drift.

---

## SV-07 – Security Regression

```powershell
pnpm --filter @dbzs/desktop exec vitest run `
  electron/workspacePathGuard.test.ts `
  electron/commandExecutionService.test.ts
```

### Soll

- absolute Pfade werden abgewiesen,
- `..`-Traversal wird abgewiesen,
- führende Workspace-Slashes werden kontrolliert normalisiert,
- Befehlsausführung bleibt auf erlaubte Prozesse beschränkt.

---

## SV-08 – Packaging Smoke

```powershell
pnpm smoke:packaging
```

### Soll

- Backend-Paket wird erzeugt,
- benötigte Dateien sind enthalten,
- keine Entwicklungsartefakte werden fälschlich vorausgesetzt.

---

## SV-09 – Backend Smoke und Doctor

```powershell
pnpm smoke:backend
pnpm doctor:backend
```

### Soll

- Backend startet,
- Health-Endpunkte antworten,
- Runtime-Abhängigkeiten werden erkannt,
- Diagnose meldet keine kritischen Blocker.

---

# 7. Stufe B – UI_VERIFIED

Diese Tests müssen in einer echten interaktiven Desktop-Session durchgeführt werden.

App-Start:

```powershell
pnpm dev
```

---

## UI-01 – App-Start und Grundzustand

### Durchführung

1. App starten.
2. Hauptfenster abwarten.
3. Runtime-, Chat-, Modelle- und Settings-Bereich öffnen.
4. Fenster schließen und erneut starten.

### Soll

- kein weißes Fenster,
- kein blockierender Fehlerdialog,
- Navigation funktioniert,
- Backend-Verbindung wird korrekt angezeigt,
- Zustand wird nach Neustart sinnvoll wiederhergestellt.

### Beweise

- Screenshot Hauptfenster
- Backend-Log
- Electron-Log

---

## UI-02 – Workspace öffnen

### Durchführung

1. Testworkspace auswählen.
2. Dateibaum öffnen.
3. mehrere Dateien anzeigen.
4. Workspace schließen und erneut öffnen.

### Soll

- korrekter Root-Pfad,
- keine Dateien außerhalb des Workspaces sichtbar,
- Zustand nach Neustart erhalten,
- keine verwaisten Locks.

---

## UI-03 – Modellkatalog-Rescan

### Durchführung

1. Runtime Models öffnen.
2. aktuellen Modellstand notieren.
3. Rescan starten.
4. Abschluss abwarten.
5. Modellanzahl und Metadaten prüfen.

### Soll

- Scan endet kontrolliert,
- keine Duplikate,
- ungültige Runtime-Pfade werden erkannt,
- vorhandene Modelle bleiben korrekt indexiert,
- Support-Artefakte werden verständlich getrennt.

### Aktueller Referenzwert

Auf dem bekannten System wurden zuletzt etwa 364 Modelle erkannt. Der Wert ist nur Plausibilitätsreferenz, kein starres PASS-Kriterium.

---

## UI-04 – Modellstart und Modellstopp

### Durchführung

1. kleines Text-/Coding-Modell auswählen.
2. vorgesehenen Slot starten.
3. Health-Status beobachten.
4. Modell stoppen.
5. erneut starten.

### Soll

- Statusfolge nachvollziehbar,
- Port korrekt,
- PID/Prozess korrekt zugeordnet,
- Stop beendet den richtigen Prozess,
- Neustart funktioniert ohne verwaisten Prozess.

---

## UI-05 – Modellwechsel-Stabilität

### Ziel

Den bekannten möglichen Absturz nach Modellwechsel untersuchen.

### Durchführung

1. kleines Modell starten.
2. eine kurze Chat-Aufgabe ausführen.
3. auf `qwen2.5-coder-7b-instruct` oder ein vergleichbares größeres Modell wechseln.
4. erneut eine Aufgabe ausführen.
5. mindestens fünf Minuten beobachten.
6. zurück auf das kleine Modell wechseln.
7. dritten Chat-Auftrag ausführen.

### Soll

- App bleibt aktiv,
- Backend bleibt aktiv,
- alter Modellprozess wird sauber beendet oder bewusst resident gehalten,
- neuer Slot wird korrekt aktiv,
- kein Crash,
- keine verlorene Unterhaltung,
- keine falsche Modellanzeige.

### FAIL

- Desktop oder Backend beendet sich,
- UI friert ein,
- Chat bleibt dauerhaft ohne Abschluss,
- Modellstatus widerspricht realen Prozessen.

### Pflichtbeweise

- Runtime-Log
- Crash-Log
- Prozessliste vor/nach Wechsel
- Screenshots
- genaue Zeitstempel

---

## UI-06 – Einfacher Chat

### Prompt

```text
Erkläre in drei kurzen Punkten, welche Aufgabe dieses Testprojekt erfüllt.
```

### Soll

- verständliche Antwort,
- keine Tool-Markups,
- kein JSON-Protokoll,
- Antwort gehört zum ausgewählten Modell,
- Run wird als erfolgreich beendet.

---

## UI-07 – Fortsetzungsverständnis

### Durchführung

1. normale Aufgabe stellen.
2. danach nur schreiben:

```text
weiter
```

3. anschließend:

```text
genau so
```

### Soll

- Codee erkennt die Fortsetzung,
- kein unnötiger Kontextverlust,
- keine neue themenfremde Aufgabe,
- Antwort schließt sinnvoll an.

---

## UI-08 – Statusfrage

### Prompt

```text
Wie weit bist du?
```

### Soll

Codee antwortet als Statusanfrage und startet keine neue Codeanalyse.

---

## UI-09 – Tool-Call-Finalisierung

### Prompt

```text
Zähle alle GGUF-Dateien im geöffneten Workspace.
```

### Soll

- Tool-Aufruf wird ausgeführt,
- Tool-Ergebnis wird verarbeitet,
- sichtbare Endantwort enthält eine verständliche Zahl oder Erklärung,
- kein roher `<CODEE_TOOL_CALL>`-Block,
- kein Erfolgsstatus bei leerer Endantwort.

### FAIL

- Tool-Hülle sichtbar,
- Lauf wird erfolgreich markiert, obwohl keine Endantwort existiert,
- Roh-JSON wird unkommentiert als Antwort angezeigt.

---

## UI-10 – Unvollständiger Agentenlauf

### Durchführung

Einen Fall provozieren, bei dem das Modell nach einem Tool-Ergebnis keine brauchbare Endantwort erzeugt.

### Soll

Der Lauf endet verständlich mit beispielsweise:

- `empty_final_answer`
- `agent_loop_incomplete`

und nicht still mit `success`.

---

## UI-11 – Folgeaktionen

### Durchführung

1. normale Chat-Antwort erzeugen.
2. Block „Vorgeschlagene Folgeaktionen“ prüfen.
3. `Nächste Schritte` anklicken.
4. Planungsantwort erzeugen.
5. prüfen, ob `Plan umsetzen` angeboten wird.
6. Fehlerfall erzeugen.
7. prüfen, ob `Erneut versuchen` oder `Ergebnis prüfen` erscheint.

### Soll

- Aktionen nur an der letzten Assistentenantwort aktiv,
- während laufender Antwort deaktiviert,
- keine Vermischung mit Patch-Approval,
- Aktion löst den erwarteten Prompt aus.

---

## UI-12 – Text- und Code-Dateianhang

### Testdateien

- `.md`
- `.json`
- `.js`
- `.ts`
- `.tsx`
- `.py`
- `.txt`

### Durchführung

1. mehrere Dateien anhängen.
2. Vorschau prüfen.
3. eine Datei vor dem Senden entfernen.
4. ohne zusätzlichen Text senden.
5. Inhalt zusammenfassen lassen.

### Soll

- nur verbliebene Dateien werden gesendet,
- Dateiinhalt korrekt als Kontext,
- keine binären Zeichensalate,
- Dateiname und Typ sichtbar,
- Limits verständlich angezeigt.

---

## UI-13 – PDF-Anhang

### Durchführung

1. normales PDF anhängen.
2. Inhalt zusammenfassen lassen.
3. leeres oder gesperrtes PDF testen.
4. großes PDF testen.

### Soll

- lokaler Textextrakt,
- verständliche Fehlermeldung bei nicht lesbarem PDF,
- keine App-Blockade,
- Begrenzung oder Trunkierung sichtbar.

---

## UI-14 – ZIP-Anhang

### Durchführung

1. kleines Quellcode-ZIP anhängen.
2. Inventar prüfen.
3. Analyse starten.
4. ZIP mit großen oder nicht unterstützten Dateien testen.
5. ZIP mit verschachtelten Pfaden testen.

### Soll

- temporäres sicheres Entpacken,
- nur erlaubte Text-/Code-Dateien werden inline verarbeitet,
- Pfad-Traversal ist ausgeschlossen,
- Limits werden angezeigt,
- Temp-Dateien werden bereinigt.

---

## UI-15 – Bildanhang und Vision-Gating

### Durchführung

1. Bild anhängen.
2. Bildanalyse anfordern.
3. anschließend nur ein PDF oder ZIP anhängen.

### Soll

- Vision-Flag nur bei echtem Bildpayload,
- Dokumente lösen kein falsches Vision-Routing aus,
- Bildanalyse wird nur an kompatibles Modell geroutet oder verständlich blockiert.

---

## UI-16 – Rollenmodell-Auflösung

### Durchführung

1. `defaultCoderModelId` entfernen oder ungültig setzen.
2. Coding-Auftrag starten.
3. dasselbe mit Reviewer-Rolle wiederholen.

### Sollziel für Produktionsreife

1. explizites Rollenmodell,
2. kompatibles laufendes Modell,
3. kompatibles installiertes Modell,
4. Auswahlassistent.

### Aktueller erwarteter Befund

Ein harter Fehler „Rollenmodell in Settings fehlt“ ist als offene Produktlücke zu dokumentieren.

---

## UI-17 – Repository Review ohne Findings

### Durchführung

1. kleinen sauberen Datei-Batch prüfen lassen.
2. Review starten.
3. Ergebnis beobachten.

### Soll

- Modell kann `[]` liefern,
- kein `no_json_array`,
- kein unnötiger Heuristik-Fallback,
- Review endet kontrolliert mit „keine Findings“.

---

## UI-18 – Repository Review mit echten Findings

### Vorbereitung

Bewusst einen kleinen ungefährlichen Fehler in einer Testdatei erzeugen, zum Beispiel:

- unbenutzte Variable,
- falscher Rückgabewert,
- fehlende Nullprüfung.

### Durchführung

1. Review starten.
2. Finding öffnen.
3. Datei und Zeile prüfen.
4. Schweregrad und Beschreibung kontrollieren.

### Soll

- echte LLM-Findings,
- richtige Datei,
- plausible Zeile,
- verständliche Begründung,
- keine Halluzination nicht vorhandener Dateien.

---

## UI-19 – Diff-Erzeugung

### Prompt

```text
Ändere die Testfunktion so, dass sie bei leerer Eingabe einen klaren Fehler zurückgibt.
```

### Soll

- Änderungsvorschlag erscheint als Diff,
- Original und Änderung nachvollziehbar,
- keine Datei wird vor Freigabe verändert,
- Pfad liegt im Workspace.

---

## UI-20 – Approval Gate

### Durchführung

1. Diff erzeugen.
2. zunächst ablehnen.
3. Dateisystem prüfen.
4. erneut erzeugen.
5. freigeben.

### Soll

- Ablehnung verändert keine Datei,
- Freigabe wendet exakt den angezeigten Diff an,
- keine zusätzliche versteckte Änderung.

---

## UI-21 – Patch Apply

### Durchführung

1. Patch freigeben.
2. Datei extern oder über Git-Diff prüfen.

```powershell
git diff -- path\to\file
```

### Soll

- Inhalt entspricht exakt dem freigegebenen Diff,
- Encoding bleibt korrekt,
- keine Nebenänderungen,
- Restore Point wird erzeugt.

---

## UI-22 – Tests nach Patch

### Durchführung

1. Patch anwenden.
2. passende Tests über Codee starten.
3. Konsolenausgabe und Status prüfen.

### Soll

- realer Testprozess wird gestartet,
- exakter Befehl ist nachvollziehbar,
- Exitcode wird korrekt ausgewertet,
- Ausgabe wird nicht nur simuliert,
- grün/rot entspricht echter Testausgabe.

---

## UI-23 – Fehlgeschlagener Test

### Vorbereitung

Absichtlich eine Änderung einbringen, die einen vorhandenen Test brechen lässt.

### Soll

- Codee meldet FAIL,
- betroffener Test sichtbar,
- keine falsche Erfolgsmeldung,
- Rollback wird angeboten oder klar erreichbar.

---

## UI-24 – Rollback

### Durchführung

1. fehlgeschlagenen Patch zurückrollen.
2. Datei mit Original vergleichen.
3. Tests erneut starten.

### Soll

- ursprünglicher Inhalt vollständig wiederhergestellt,
- keine Reständerung,
- Tests wieder grün,
- Restore Point bleibt nachvollziehbar dokumentiert.

### Pflichtbeweise

- Diff vor Patch
- Diff nach Patch
- Diff nach Rollback
- Testausgabe vor/nach Rollback

---

## UI-25 – Backup und Restore

### Durchführung

1. Backup auslösen.
2. Backup-Verzeichnis prüfen.
3. kontrollierte Workspace- oder Setting-Änderung durchführen.
4. Restore starten.
5. Zustand vergleichen.

### Soll

- Backup vollständig,
- Restore stellt erwarteten Zustand wieder her,
- keine Pfadverwechslung zwischen Electron-UserData und Backend-AppData.

---

## UI-26 – Crash-Recovery

### Durchführung

1. Workspace öffnen.
2. Review starten.
3. mindestens einen Batch abwarten.
4. Prozess hart beenden:

```powershell
Get-Process -Name "DBZS Code Assistant","electron" -ErrorAction SilentlyContinue |
  Stop-Process -Force
```

5. App neu starten.
6. Workspace wieder öffnen.

### Soll

- App startet ohne Fehlerdialog,
- `.codee/`-Zustand nicht korrupt,
- keine verwaisten Locks,
- Review-/Workspace-Zustand sinnvoll wiederhergestellt oder klar als abgebrochen markiert.

---

## UI-27 – Runtime-Prozessverlust

### Durchführung

1. Modell starten.
2. laufenden Modellprozess extern beenden.
3. UI beobachten.
4. neue Anfrage senden.

### Soll

- Slot erkennt Prozessverlust,
- UI zeigt nicht weiter „läuft“,
- verständliche Recovery-Möglichkeit,
- kein endloser Chat-Spinner.

---

## UI-28 – Backend-Prozessverlust

### Durchführung

1. App starten.
2. Backend-Prozess extern beenden.
3. UI beobachten.
4. Recovery testen.

### Soll

- Verbindungsausfall sichtbar,
- keine stillen Requests,
- Backend kann kontrolliert neu gestartet oder die App sauber neu gestartet werden,
- Logs enthalten Ursache.

---

# 8. Stufe C – INSTALLER_VERIFIED

Diese Tests müssen mit einem echten Windows-Installer erfolgen.

---

## IN-01 – Release-Build

```powershell
cd apps/desktop
npm run release:win
```

### Soll

Unter `dist-release/` entstehen:

- NSIS-Installer
- Portable EXE

### FAIL

- Build benötigt Dev-Dateien außerhalb des Pakets,
- unsignalisierter Fehler,
- fehlendes Backend-Paket.

---

## IN-02 – Neuinstallation

### Durchführung

1. vorhandene Testinstallation entfernen.
2. NSIS-Installer starten.
3. Installationsziel wählen.
4. Installation abschließen.
5. App über Startmenü starten.

### Soll

- Installation vollständig,
- Verknüpfung funktioniert,
- App startet ohne Dev-Umgebung,
- Backend startet mit.

---

## IN-03 – UserData- und AppData-Pfade

### Erwartete Pfade

Electron:

```text
%APPDATA%\DBZS Code Assistant\
```

Backend:

```text
%LOCALAPPDATA%\DBZS\CodeAssistant\
```

### Soll

- beide Pfade existieren,
- beide sind beschreibbar,
- keine Nutzung des Dev-Pfads,
- keine Überschneidung mit `%TEMP%\dbzs-codee-dev-user-data`.

---

## IN-04 – Installer Golden Path

In der installierten App durchführen:

1. Workspace öffnen.
2. Modell scannen.
3. Modell starten.
4. Chat senden.
5. Review starten.
6. Diff erzeugen.
7. Patch freigeben.
8. Test starten.
9. Rollback durchführen.
10. Backup und Restore testen.

### Soll

Alle Kernfunktionen funktionieren ohne Quellrepo oder Dev-Server.

---

## IN-05 – Portable Build

### Durchführung

1. Portable EXE in separaten Ordner kopieren.
2. starten.
3. Workspace und Modell konfigurieren.
4. beenden und erneut starten.

### Soll

- Start ohne Installation,
- klar definierte Datenablage,
- keine Kollision mit installierter Version,
- Zustand wird erwartungsgemäß gespeichert.

---

## IN-06 – Update über bestehende Installation

### Durchführung

1. ältere Testversion installieren.
2. Einstellungen und Workspace-Zustand erzeugen.
3. neuere Version darüber installieren.
4. App starten.

### Soll

- Einstellungen erhalten,
- Schema-Migration kontrolliert,
- kein Datenverlust,
- vor Migration Backup oder Restore-Möglichkeit.

---

## IN-07 – Deinstallation

### Durchführung

1. App deinstallieren.
2. Installationsordner prüfen.
3. UserData und Backend-AppData prüfen.
4. dokumentieren, was erhalten bleibt.

### Soll

- Programmdateien entfernt,
- Nutzerdaten gemäß dokumentierter Strategie erhalten oder bewusst entfernt,
- keine laufenden Prozesse,
- kein kaputter Autostart.

---

# 9. Stufe D – PERSONAL_STABLE

`PERSONAL_STABLE` ist keine einmalige Testausgabe, sondern ein Nutzungsnachweis.

---

## PS-01 – Drei vollständige Läufe

Ein kompletter Abnahmelauf muss stattfinden:

- Erstlauf,
- Wiederholung an einem weiteren Tag,
- zweite Wiederholung an einem weiteren, möglichst nicht direkt folgenden Tag.

Jeder Lauf beginnt mit frischem App- und Backend-Start.

---

## PS-02 – Pflichtumfang je Lauf

Mindestens:

- App-Start
- Workspace
- Modellscan
- Modellstart
- Modellwechsel
- Chat
- Tool-Call
- Repository Review
- Diff
- Approval
- Patch
- Tests
- Rollback
- Backup/Restore
- Neustart

---

## PS-03 – Alltagsnutzung

Zusätzlich mindestens eine reale kleine Entwicklungsaufgabe durchführen:

- Fehler analysieren,
- Änderung planen,
- Änderung anwenden,
- Tests ausführen,
- Ergebnis kontrollieren.

### Soll

Codee unterstützt den Arbeitsfluss ohne manuelle Reparatur seiner eigenen Runtime.

---

## PS-04 – Freigabekriterien

`PERSONAL_STABLE` nur setzen, wenn:

- kein offener P0-Fehler,
- Modellwechsel stabil,
- drei vollständige Läufe grün,
- Installer Golden Path grün,
- Patch/Test/Rollback real grün,
- Crash-Recovery grün,
- keine kritische Contract-Drift,
- Statusdokumente synchron,
- bekannte Einschränkungen dokumentiert.

---

# 10. Abbruchkriterien

Ein Abnahmelauf muss sofort gestoppt und als FAIL markiert werden bei:

- möglichem Datenverlust,
- Änderung außerhalb des Workspaces,
- unfreigegebener Patch-Anwendung,
- falschem Restore,
- wiederholtem App-/Backend-Crash,
- Prozess startet unkontrolliert mehrfach,
- Sicherheitsverletzung durch Pfad-Traversal,
- Tests werden als ausgeführt angezeigt, obwohl kein Prozess lief.

---

# 11. Fehlerklassifikation

## P0 – Blocker

- Datenverlust
- Sicherheitsproblem
- unkontrollierte Dateiänderung
- reproduzierbarer Crash im Kernpfad
- Rollback funktioniert nicht
- falscher Erfolgsstatus bei fehlender Ausführung

## P1 – Hoch

- Modellwechsel instabil
- Installer-Kernfunktion defekt
- Review oder Patch-Pipeline nicht zuverlässig
- Rollenmodell kann nicht automatisch aufgelöst werden
- Backup oder Restore nur teilweise funktionsfähig

## P2 – Mittel

- UI-Unklarheit
- schlechte Fehlermeldung
- Folgeaktion falsch
- Dokumentationsdrift
- Diagnosebeweis unvollständig

## P3 – Niedrig

- kosmetische Abweichung
- Layoutfehler ohne Funktionsverlust
- nicht blockierende Warnung

---

# 12. Abschlussbericht

## Gesamtstatus

```markdown
# Abnahmebericht DBZS Codee V4

- Datum:
- Commit:
- Version:
- App-Modus:
- Tester:

## Ergebnisse

- SERVICE_VERIFIED:
- UI_VERIFIED:
- INSTALLER_VERIFIED:
- PERSONAL_STABLE:

## Teststatistik

- PASS:
- FAIL:
- BLOCKED:
- NOT_RUN:

## Offene P0

## Offene P1

## Freigabeentscheidung

- [ ] nicht freigegeben
- [ ] für weitere interne Tests freigegeben
- [ ] UI_VERIFIED
- [ ] INSTALLER_VERIFIED
- [ ] PERSONAL_STABLE

## Begründung
```

---

# 13. Empfohlene Reihenfolge für den nächsten Lauf

1. `SV-01` bis `SV-09`
2. `UI-01` bis `UI-05`
3. `UI-06` bis `UI-18`
4. `UI-19` bis `UI-25`
5. `UI-26` bis `UI-28`
6. `IN-01` bis `IN-07`
7. drei `PERSONAL_STABLE`-Läufe

---

# 14. Produktionsreife-Erweiterungen

Um dieses Playbook später weitgehend automatisch auszuführen, sollte Codee zusätzlich erhalten:

- maschinenlesbare `verification-run.json`,
- durchgängige Run-/Correlation-ID,
- automatischen Screenshot-Hook an Testmeilensteinen,
- Export eines Diagnosepakets,
- Process-Supervisor-Telemetrie,
- automatische Vorher-/Nachher-Hashes für Patch und Rollback,
- Installer-E2E auf sauberer Windows-VM,
- Release-Gate, das nur signierte Abnahmeprotokolle akzeptiert,
- Dashboard mit Status pro Test-ID,
- automatische Synchronisation von `README.md`, `TODO.md`, `HANDOVER.md` und `STATUS_TODAY.md`.

---

# Schlussregel

Ein grüner Unit-Test beweist eine Komponente.  
Ein grüner Golden Path beweist den Ablauf.  
Drei grüne reale Läufe beweisen persönliche Stabilität.
