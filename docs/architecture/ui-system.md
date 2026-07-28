# UI-System

## Statusregeln

- `starting` oder `live`: UI kommuniziert aktiven Start, nicht Bereitschaft.
- `ready`: System ist verwendbar.
- `degraded`: Kernfunktion verfuegbar, aber mit klarer Einschraenkung.
- `failed`: blockierender Fehler oder unsicherer Zustand.

## UI-Prinzipien

- Statusfarben muessen denselben technischen Zustand ueberall gleich abbilden.
- Diagnostics erklaeren immer:
  - was fehlgeschlagen ist
  - was noch sicher funktioniert
  - welche naechste Aktion empfohlen wird
- Expertenflaechen duerfen Hauptaufgaben nicht verdecken.

## Primitive

- `StatusPill`
- Panel-Header
- Collapse-/Resize-Handle
- Placeholder-/Diagnostics-Infobox

## Guided UX

Die priorisierten Kernfluesse sind:

1. Boot/Start
2. Runtime Chat
3. Repository Review
4. Patch Approval
5. Workspace/Model Discovery

## Runtime Chat

- Der Composer ist die primaere Eingabeflaeche und darf auch ohne Textprompt sendefaehig sein,
  wenn verwertbare Dateianhaenge vorhanden sind.
- Attachment-UX bleibt typbasiert, nicht featurebasiert:
  Bilder, Text/Code, PDF und ZIP teilen denselben Anhaengefluss.
- Vorschauen muessen vor dem Senden sichtbar und einzeln entfernbar sein.
- Nicht-bildliche Anhaenge duerfen keine Vision-Blockade simulieren; nur echte Bildpayloads markieren Bildbedarf.
