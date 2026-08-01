# DBZS Codee v4 – Workspace Explorer Arbeitsbasis

Repository: `devdbzemusic/dbzs-codee-v4`
Arbeitszweig: `main`

## Gefundene Hauptkomponente

`apps/desktop/src/components/WorkspaceExplorer.tsx`

Die Komponente enthält bereits:

- rekursiven Tree-Aufbau
- Ordner-vor-Dateien-Sortierung
- Ein-/Ausklappen
- Kontextmenü-Grundlage
- Mehrfachauswahl
- Drag & Drop
- Inline-Umbenennen
- Suche und Dateitypfilter
- Git-Status-Badges
- angeheftete und zuletzt verwendete Dateien
- Hover-Vorschau
- Auto-Refresh

## Auffälligkeit

Im Repository existiert offenbar zusätzlich eine zweite, verschachtelte Projektkopie:

`dbzs-codee-project-main/apps/desktop/src/components/WorkspaceExplorer.tsx`

Diese Doppelstruktur sollte geprüft und bereinigt werden, weil sie:

- Code-Suche und Navigation verfälscht
- versehentliche Änderungen an der falschen Datei begünstigt
- Builds, Tests und Wartung unnötig erschwert

## Empfohlene Umsetzung für den Explorer

1. Baumdarstellung visuell neu strukturieren:
   - eindeutige Einrückungslinien
   - konsistente Ordnerpfeile
   - Dateityp-Icons statt langer Textchips
   - klar getrennte Zeilen für Ordner und Dateien
   - abgeschnittene Namen mit Tooltip
   - optionale Ordner-Komprimierung wie `src/components/ui`

2. Kontextmenü vollständig ausbauen:
   - Neue Datei
   - Neuer Ordner
   - Öffnen
   - Im System-Explorer anzeigen
   - Pfad kopieren
   - Relativen Pfad kopieren
   - Umbenennen
   - Verschieben
   - Duplizieren
   - Löschen
   - Terminal hier öffnen
   - Suche im Ordner
   - Git-Aktionen
   - Zu Codee-Kontext hinzufügen
   - Aus Codee-Kontext entfernen
   - Mit Codee analysieren
   - Review starten
   - Datei erklären
   - Tests erzeugen
   - Refactoring vorschlagen
   - Abhängigkeiten anzeigen

3. Architektur härten:
   - TreeNode und TreeBuilder aus der React-Komponente auslagern
   - Dateioperationen in einen zentralen WorkspaceCommandService verschieben
   - Kontextmenü-Aktionen über ein Command-Registry-System registrieren
   - Berechtigungs- und Sicherheitsprüfung zentralisieren
   - große Verzeichnisse virtualisieren
   - Dateisystemänderungen ereignisbasiert statt per 10-Sekunden-Polling synchronisieren

## Nächster sinnvoller Schritt

Zuerst die tatsächliche aktive Projektwurzel und die doppelte Repository-Struktur klären. Danach den Workspace Explorer gezielt refaktorieren, ohne die vorhandenen Funktionen erneut zu bauen.
