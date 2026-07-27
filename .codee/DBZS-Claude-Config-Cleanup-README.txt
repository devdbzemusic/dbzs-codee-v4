DBZS Claude Code Config Cleanup – Kurzanleitung

1. PowerShell im gewünschten Ordner öffnen.
2. Nur prüfen:
   .\DBZS-Claude-Config-Cleanup.ps1

3. Sichere Standardbereinigung zunächst simulieren:
   .\DBZS-Claude-Config-Cleanup.ps1 -Mode Standard -WhatIf

4. Standardbereinigung ausführen:
   .\DBZS-Claude-Config-Cleanup.ps1 -Mode Standard

Modi:
- Audit: Nur anzeigen, nichts ändern.
- Minimal: Logs, Debug- und temporäre Daten entfernen.
- Standard: Zusätzlich lokale Sitzungsverläufe entfernen; Einstellungen bleiben erhalten.
- FullReset: Einstellungen entfernen. Erfordert -ConfirmFullReset.

Kompletter Reset einschließlich globalem Status/Anmeldung:
.\DBZS-Claude-Config-Cleanup.ps1 -Mode FullReset -IncludeAuth -ConfirmFullReset

Projektbezogene Konfiguration mit einbeziehen:
.\DBZS-Claude-Config-Cleanup.ps1 -Mode FullReset -ProjectPath "D:\dev\mein-projekt" -ConfirmFullReset

Das Script erstellt vor Änderungen automatisch ein Backup unter:
%USERPROFILE%\Documents\Claude-Code-Backups
