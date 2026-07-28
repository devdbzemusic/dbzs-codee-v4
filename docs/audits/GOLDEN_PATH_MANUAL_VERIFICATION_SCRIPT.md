# Golden-Path — verbleibendes manuelles Ausführungsskript

Statusvokabular (projektweit): `SERVICE_VERIFIED` → `UI_VERIFIED` → `INSTALLER_VERIFIED` → `PERSONAL_STABLE`.

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
