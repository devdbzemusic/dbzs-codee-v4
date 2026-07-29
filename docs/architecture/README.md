# DBZS Architektur

Dieses Verzeichnis ist die aktive Architekturquelle fuer DBZS. Es ersetzt keine Incident- oder Hand-over-Dokumente, sondern beschreibt die dauerhaft gueltigen Strukturen:

- Modulgrenzen
- Vertragsbereiche
- UI-System
- Performance-Hotspots

## Aktive Architekturbausteine

- [module-boundaries.md](module-boundaries.md)
- [contracts.md](contracts.md)
- [ui-system.md](ui-system.md)
- [performance-hotspots.md](performance-hotspots.md)

## Aktuelle Schwerpunktbereiche

- Runtime Chat als conversation-first Arbeitsflaeche mit sekundaeren Diagnoseflaechen
- generische Runtime-Chat-Dateianhaenge statt bildspezifischer Sonderstrecke
- additive Shared-/Backend-Vertraege fuer Routing, Runtime-Probe und Attachment-Aufbereitung
- klare Trennung zwischen Desktop-UI, Electron-IO/IPC und Python-Backend-Aufbereitung

## Leitlinie fuer Dateianhaenge

Runtime-Chat-Dateianhaenge folgen einer dreistufigen Verantwortung:

1. Renderer: Auswahl, Preview, Entfernen, Turn-Metadaten
2. Electron/Main-Service: Datei-Dialog, lokales Lesen einfacher Typen, Weitergabe schwerer Faelle
3. Backend: PDF-/ZIP-Aufbereitung, Text-Extraktion, Limitierung, Temp-Cleanup

Archivierte Alttexte unter `docs/archive/` bleiben Historie. Neue Architekturentscheidungen werden hier gepflegt.
