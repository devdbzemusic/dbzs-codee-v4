# Project AGENTS.md – DBZS Repository

## Projektidentität

Dieses Repository gehört zum DBZS-Ökosystem.
DBZS bedeutet immer:

Division By Zeros (DBZS)

Nicht anders schreiben.
Nicht als Dragon Ball Z interpretieren.

## Projektziel

Arbeite immer im Sinne des bestehenden Projekts.
Vor jeder Änderung:
- Lies README.md, falls vorhanden.
- Lies ARCHITECTURE.md, falls vorhanden.
- Lies TODO.md / ROADMAP.md / DEV_LOG.md, falls vorhanden.
- Suche nach vorhandenen Patterns im Code.

Wenn Dokumentation fehlt oder veraltet ist:
- Nicht raten.
- Code als Wahrheit prüfen.
- Dokumentation gezielt ergänzen oder korrigieren.

## Änderungsprinzip

Keine großen Umbauten ohne Auftrag.

Bevorzugte Reihenfolge:
1. Bug verstehen.
2. Minimalen Fix finden.
3. Tests/Checks ergänzen.
4. Dokumentation aktualisieren.
5. Ergebnis erklären.

Nicht erlaubt:
- Ganze Module neu schreiben, wenn ein lokaler Fix reicht.
- UI-Design ungefragt verändern.
- Feature-Scope aufblasen.
- Fake-Implementierungen als fertig verkaufen.
- TODOs verstecken, ohne sie zu dokumentieren.

## Architekturregeln

Trenne sauber:
- UI
- State
- Domain-Logik
- Engine/Runtime
- IO/Persistenz
- Provider/Adapter
- Tests
- Dokumentation

Bei neuen Features:
- Erst existierende Architektur prüfen.
- Dann passende Stelle wählen.
- Keine Parallelstruktur bauen, wenn es bereits ein System gibt.

## Logging / Observability

Bei komplexen Abläufen:
- Verständliche Logs einbauen.
- Fehlerkontext loggen.
- Keine Secrets loggen.
- Debug-Ausgaben abschaltbar halten.

Wichtige Logs:
- Start/Stop von Runtime-Komponenten
- Modell-/Audio-/Device-Auswahl
- Ladefehler
- Build-/Config-Probleme
- Unerwartete Zustände

## Tests

Wenn Tests vorhanden sind:
- Relevante Tests ausführen.
- Bei Featureänderungen Tests ergänzen.
- Bei Bugfix Regressionstest ergänzen, wenn sinnvoll.

Wenn keine Tests vorhanden sind:
- Keine große Test-Infrastruktur erzwingen.
- Einen kleinen sinnvollen Test vorschlagen oder ergänzen, wenn es leicht möglich ist.

## Dokumentation

Bei jeder größeren Änderung prüfen:
- README.md
- ARCHITECTURE.md
- TODO.md
- DEV_LOG.md
- TESTING.md

Neue Dokumentation soll:
- Deutsch sein
- Kurz, aber konkret sein
- Befehle enthalten, wenn relevant
- Risiken und offene Punkte nennen

## UI-Regeln

Bestehende Optik behalten.
Bei DBZS Neon UI:
- Dunkler Hintergrund
- Klare Kontraste
- Neon-Akzente sparsam und funktional
- Keine unlesbaren Glow-Effekte
- Bedienbarkeit vor Effekt

Bei Android:
- Touch-Zonen groß genug
- Keine Desktop-UI 1:1 übernehmen
- Performance beachten
- Landscape/Portrait bewusst behandeln

## Audio-Regeln

Bei Audio-Projekten:
- Audio Engine nicht durch UI blockieren.
- Timing und Clock ernst nehmen.
- Pattern, Scene, Track, Voice, FX, Mixer und Transport getrennt halten.
- FX-Routing nachvollziehbar dokumentieren.
- Jede Änderung am Audio-Pfad vorsichtig erklären.

## Abschlussbericht

Am Ende jeder Codex-Aufgabe exakt diese Abschnitte liefern:

### Ergebnis
Was wurde erreicht?

### Dateien
Welche Dateien wurden geändert?

### Tests / Checks
Welche Befehle wurden ausgeführt?
Was war das Ergebnis?

### Noch offen
Was ist noch nicht gelöst?

### Empfehlung
Was ist der nächste konkrete Schritt?
