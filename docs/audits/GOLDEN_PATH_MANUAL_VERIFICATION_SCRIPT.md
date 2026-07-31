# Golden-Path — verbleibendes manuelles Ausführungsskript

Statusvokabular (projektweit): `SERVICE_VERIFIED` → `UI_VERIFIED` → `INSTALLER_VERIFIED` → `PERSONAL_STABLE`.

**Aktuelle, verbindliche Abnahmevorschrift:** `Pläne/10 DBZS_CODEE_V4_ABNAHME_TEST_PLAYBOOK.md` (SV-01…SV-09,
UI-01…UI-28, IN-01…IN-07, PS-01…PS-04). Für einen neuen Abnahmelauf zuerst
`pnpm acceptance:new-run` ausführen — legt `docs/audits/runs/<timestamp>/` mit vorbefülltem
`RUN_SUMMARY.md` (alle Test-IDs, Status `NOT_RUN`) sowie `environment.txt`/`git-status.txt` an; danach
`node scripts/generate-verification-run-json.mjs` für eine maschinenlesbare Zusammenfassung. Die Stufe
`SERVICE_VERIFIED` (SV-01…SV-09) ist automatisiert durchführbar — siehe
`docs/audits/runs/2026-07-31_21-43/RUN_SUMMARY.md` für einen echten, vollständig ausgeführten Referenzlauf.
Dieses Dokument hier bleibt für die Punkte gültig, die sich nicht automatisiert treiben lassen (harter
Abbruch + Neustart, echter Installer-Build + Installation, Wiederholung an weiteren Tagen) — inhaltlich
deckungsgleich mit UI-26, IN-01…IN-07 und PS-01 im neuen Playbook.

Dieses Dokument deckt genau die Punkte ab, die sich nicht automatisiert
treiben lassen (harter Abbruch + Neustart, echter Installer-Build +
Installation, Wiederholung an weiteren Tagen). Für die automatisiert
getriebene UI-Kette (Review/Diff/Approval/Apply/Test/Rollback,
Backup/Restore, Modellkatalog-Rescan) siehe den separaten Lauf, dessen
Ergebnis in `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md`
festgehalten ist (sobald dieser Lauf abgeschlossen ist).

## A) Harter Abbruch + Neustart + Crash-Recovery

Ziel: Kriterium "Neustart nach Abbruch erhält Zustand" (`UI_VERIFIED`).

1. App normal starten (`pnpm dev` oder gepackter Build), Workspace öffnen,
   einen Review starten und laufen lassen, bis mindestens ein Batch
   verarbeitet wurde.
2. Prozess **hart** beenden (nicht über die UI schließen):
   ```powershell
   Get-Process -Name "DBZS Code Assistant","electron" -ErrorAction SilentlyContinue | Stop-Process -Force
   ```
   (Prozessname je nach Dev- vs. gepacktem Build anpassen — mit
   `Get-Process | Where-Object { $_.MainWindowTitle -match "DBZS" }`
   den echten Namen vorab bestimmen.)
3. App neu starten, denselben Workspace öffnen.
4. Prüfen: wird der Review-/Workspace-Zustand aus `.codee/` korrekt
   wiederhergestellt (kein korrupter `review-state.json`, keine
   verwaisten Locks, App startet ohne Fehlerdialog)?
5. Ergebnis (✅/❌ + Anmerkung) in `GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md`
   nachtragen.

## B) Installer-Build + Installation + UserData-Pfad

Ziel: Kriterium "Installer-Build nutzt korrekten Pfad" (`INSTALLER_VERIFIED`).

Relevante Konfiguration: `apps/desktop/electron-builder.yml`
(`appId: de.dbzs.codee`, `productName: DBZS Code Assistant`, NSIS-Target
mit wählbarem Installationsverzeichnis + Portable-Target).

1. Release-Build erzeugen:
   ```powershell
   cd apps/desktop
   npm run release:win
   ```
   Ergebnis liegt unter `dist-release/` (NSIS-Installer + portable `.exe`).
2. NSIS-Installer auf dieser Maschine ausführen (echte Installation, nicht
   nur Portable-Variante — die UserData-Pfad-Frage betrifft primär die
   installierte Variante).
3. App aus dem Startmenü/Desktop-Verknüpfung starten (nicht aus dem
   Build-Ordner).
4. Nach dem ersten Start prüfen, dass folgende Pfade korrekt und getrennt
   angelegt wurden:
   - Electron-`userData` (Settings, Workspace-State, Logs, Backups-Root):
     `%APPDATA%\DBZS Code Assistant\` — via `app.getPath("userData")`,
     siehe Referenzen in `apps/desktop/electron/main.ts`.
   - Backend-App-Data (`resolveBackendAppDataDir()` in
     `apps/desktop/electron/backupService.ts`): Standard
     `%LOCALAPPDATA%\DBZS\CodeAssistant\`, außer `DBZS_APP_DATA_DIR` ist
     gesetzt.
   - Beide Pfade dürfen sich **nicht** mit dem Dev-Pfad
     (`%TEMP%\dbzs-codee-dev-user-data` o. ä.) überschneiden.
5. Backup/Restore und einen einfachen Review-Durchlauf aus der
   installierten App heraus einmal ausführen, um zu bestätigen, dass die
   Pfade tatsächlich beschreibbar sind und nicht versehentlich auf den
   Dev-Pfad zurückfallen.
6. Deinstallation testen (NSIS-Uninstaller aus Systemsteuerung) — prüfen,
   ob Nutzerdaten unter `userData`/Backend-App-Data bewusst erhalten
   bleiben (Standardverhalten) oder ob das dokumentiert werden muss.
7. Ergebnis in `GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md` nachtragen,
   Statusstufe für diesen Punkt auf `INSTALLER_VERIFIED` heben.

## D) Sandbox-Automatisierungsversuche (2026-07-31) — Ergebnis: nicht möglich

Im Rahmen der Produktionsreife-Revision (`Pläne/09 DBZS_CODEE_V4_REPOSITORY_URTEIL_2026-07-31.md`) wurde erneut
versucht, die Punkte A/B sowie die drei neuen Fälle unten (Rollenmodell-Fallback, Crash-Correlation,
GPU-Exklusivität) in der Agent-Sandbox statt manuell zu verifizieren. Zwei technisch unterschiedliche Ansätze
wurden getestet:

1. **Bash-Hintergrundprozess / PowerShell `Start-Process` (detached)** — bereits in einer früheren Session
   zweimal gescheitert: Backend (uvicorn) und Electron werden nach ca. 2–3 Minuten Laufzeit beendet, unabhängig
   von Startmethode und unabhängig davon, ob das Modell vorher warmgeladen wurde.
2. **Windows Task Scheduler (`schtasks /create /sc once` + `/run`)** — neuer Versuch, um den Prozessbaum-Elternteil
   auf den Task-Scheduler-Dienst statt die Agent-Shell zu verlagern. Ergebnis: der gestartete Prozess wurde bereits
   nach ca. 25–30 Sekunden beendet — **schneller** als bei Methode 1 — und zeigte trotz Start über `schtasks` weiterhin
   `claude.exe` (die CLI-Harness selbst) als `ParentProcessId`. Das spricht dagegen, dass es sich um klassisches
   Job-Object-Reaping über die Prozess-Elternschaft handelt; vermutlich überwacht die Sandbox neu erzeugte Prozesse
   unabhängig vom tatsächlichen Elternprozess und beendet sie nach einem festen Zeitfenster.

Beide Techniken sind damit als nicht geeignet bestätigt. Weitere Exotik (z. B. ein echter Windows-Dienst über
`sc.exe create`) wäre der dritte Versuch und steht in keinem vernünftigen Aufwand-/Nutzen-Verhältnis mehr — die
folgenden Punkte bleiben daher manuelle Verifikation für eine reale Session mit geladenem Modell.

### D.1 Rollenmodell-Fallback-Kette

1. In den Settings ein Rollenmodell (z. B. `defaultCoderModelId`) leeren, aber ein anderes Modell in einem Slot
   laufen lassen.
2. Eine Coding-Anfrage senden — erwartet: Antwort kommt trotzdem, `selectionSource: "explicit_fallback"` sichtbar
   im Diagnose-Panel, keine harte Fehlermeldung „Rollenmodell in Settings fehlt“ mehr.
3. Anschließend auch ganz ohne laufendes Modell testen (nur installiert) — erwartet: Fallback auf installiertes
   Modell, ggf. mit kurzem Start-Delay.
4. Zuletzt: keine kompatiblen Modelle vorhanden — erwartet: klarer `role_model_missing_no_fallback`-Fehler.

### D.2 Crash-Correlation-ID

1. Eine Chat-Anfrage senden, während sie läuft den Electron-Prozess hart beenden (`Stop-Process -Force`).
2. `crash.log` (`userData/logs/crash.log`) prüfen: enthält die Zeile `activeRuns=<run-id>` mit der ID, die im
   Backend-Log (`chat()`/`chat_stream()`-Eintrittszeile) und im Frontend als „Diagnose-ID“ angezeigten Wert
   übereinstimmt.

### D.3 Vision-GPU-Exklusivität

1. `fast_gpu` mit einem Textmodell starten, dann eine Bildanfrage senden, die `vision_gpu` startet.
2. Prüfen: `fast_gpu` wird sauber gestoppt, kein gleichzeitiger GPU-Betrieb beider Slots, keine In-Flight-Anfrage
   geht dabei verloren (wird zu Ende gebracht, bevor der jeweils andere Slot gestoppt wird).

## C) Wiederholung an zwei weiteren Tagen

Ziel: Freigabekriterium für `PERSONAL_STABLE` laut
`docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md` — "vollständiger
Durchlauf aller 14 Punkte funktioniert und ist an zwei weiteren Tagen
reproduzierbar".

1. Nach erfolgreichem `UI_VERIFIED`-Durchlauf (Teil A + B + der
   automatisierte Lauf) diesen Durchlauf an zwei weiteren, nicht
   aufeinanderfolgenden Tagen wiederholen (frischer App-Start, kein
   wiederverwendeter Prozess).
2. Für jeden Wiederholungslauf ein kurzes Ergebnisprotokoll anlegen
   (Datum, welche der 14 Kriterien bestanden, welche nicht, neue Bugs).
3. Erst wenn alle drei Läufe (Erstlauf + 2 Wiederholungen) grün sind:
   Tag `DBZS Codee 0.4.0-personal-stable` setzen und Status in
   `TODO.md`/`README.md`/`HANDOVER.md` auf `PERSONAL_STABLE` heben.
