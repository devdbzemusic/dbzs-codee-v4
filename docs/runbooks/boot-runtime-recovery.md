# Boot / Runtime Recovery

## Backend startet nicht

- Backend-Status und Port pruefen
- Boot-Diagnose exportieren
- Backend-Logs und `backendReadinessProbe` vergleichen
- Danach Safe Mode oder Backend-Neustart

## Warm-up leer

- Warm-up-Diagnostik inklusive Rohantwort pruefen
- `reasoning_content`, Streaming-Events und `stderrTail` vergleichen
- Resident-Fallback pruefen

## Resident-Fallback greift

- degradierte Fortsetzung klar anzeigen
- Slot, Modell und Fallback-Grund dokumentieren
- keine stille Umschreibung des Routing-Ergebnisses

## Retry erschoepft

- letzten Fehlercode und Retry-Historie ausgeben
- Workspace wiederherstellen
- Safe Mode als empfohlene Recovery anzeigen

## Safe Mode

- Workspace-Wiederherstellung nur minimal
- Runtime-/Modellabhaengige Schritte ueberspringen
- Diagnoseexport anbieten
